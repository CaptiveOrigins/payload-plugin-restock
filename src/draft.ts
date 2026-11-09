import type { CollectionSlug, Payload, Where } from 'payload'

import type { ID, ResolvedRestock } from './types.js'
import { asInternal, idOf, list, num, restockOf, round, sameID, sys, transaction, type Doc, type Req } from './util.js'

/** What a site needs of one Kitting supply (crossing `kitting-restock`). */
export type SupplyNeed = { item: ID; name: string; unit: string; suggested: number; why: string; supplier: ID | null }

const OPEN = ['approved', 'ordered', 'partly-received']

/**
 * Packs to order: enough to cover `needed` (in the supply's unit), at least the minimum, never part
 * of a pack. Pure, so it can be tested with known numbers.
 */
export function packsFor(needed: number, packSize: number, minimumPacks = 1): number {
  if (!(needed > 0) || !(packSize > 0)) return 0
  return Math.max(Math.ceil(round(needed / packSize, 9)), Math.max(1, Math.floor(minimumPacks)))
}

/** Among a supply's supplier items: preferred ones first, then the cheapest per unit, then any priced, then the rest. */
export function pickItem(items: Doc[]): Doc | null {
  const active = items.filter((i) => i.active !== false)
  const pool = active.some((i) => i.preferred !== false) ? active.filter((i) => i.preferred !== false) : active
  const perUnit = (i: Doc) => (num(i.price) === null ? Infinity : (i.price as number) / ((num(i.packSize) ?? 1) || 1))
  return [...pool].sort((a, b) => perUnit(a) - perUnit(b))[0] ?? null
}

/** What Kitting says to buy: its `restockNeeds` (0.2+), or its below-level list (0.1). */
export async function kittingNeeds(payload: Payload, req: Req, scope: ID | null): Promise<SupplyNeed[]> {
  const kitting = (await import('@captiveorigins/payload-plugin-kitting').catch(() => null)) as Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!kitting) throw new Error('Restock: Kitting is configured but its package can’t be loaded.')
  if (typeof kitting.restockNeeds === 'function') return kitting.restockNeeds(payload, { scope: scope ?? undefined, req })
  const k = payload.config.custom?.kitting as { scopeField?: string }
  const report = (await kitting.stockReport(payload, { req })) as { rows: Doc[] }
  return report.rows
    .filter((r) => !r.retired && r.below && (!k?.scopeField || scope === null || sameID(r.scope, scope)))
    .map((r) => ({
      item: r.id,
      name: r.name,
      unit: r.unit,
      suggested: r.suggestedReorder,
      why: `below its level (${r.onHand} of ${r.lowStockLevel} ${r.unit})`,
      supplier: r.supplier?.id ?? null,
    }))
}

export type DraftResult = {
  created: { id: ID; number: string; supplier: ID; lines: number }[]
  added: { id: ID; number: string; supplier: ID; lines: number }[]
  /** Needs with no supplier item to buy them from. */
  unmatched: { item: ID; name: string; suggested: number; unit: string; why: string }[]
  /** Needs already covered by open orders. */
  covered: { item: ID; name: string; why: string }[]
}

/**
 * Draft purchase orders from what the site needs, one draft per supplier. Quantities are rounded up
 * to whole packs and minimums, after taking off what's already on approved or ordered orders. An
 * open draft for a supplier is added to (lines for new items only), never overwritten. Nothing is
 * approved or ordered: a person does that.
 */
export async function draftOrders(payload: Payload, options: { scope?: ID | null; req?: Req } = {}): Promise<DraftResult> {
  const o = restockOf(payload)
  const scope = options.scope ?? null
  if (o.scopeField && scope === null) throw new Error(`Restock: say which ${o.scopeField} to draft orders for.`)
  return transaction(payload, options.req, async (req) => {
    const scoped: Where[] = o.scopeField ? [{ [o.scopeField]: { equals: scope } }] : []
    const result: DraftResult = { created: [], added: [], unmatched: [], covered: [] }
    // What's already coming, per supplier item, in packs.
    const open = (await payload.find({ collection: o.orders as CollectionSlug, where: { and: [{ status: { in: OPEN } }, ...scoped] }, ...list, req })).docs as Doc[]
    const incoming = new Map<string, number>()
    for (const order of open)
      for (const l of (order.lines ?? []) as Doc[]) incoming.set(String(idOf(l.item)), (incoming.get(String(idOf(l.item))) ?? 0) + Math.max((num(l.packs) ?? 0) - (num(l.receivedPacks) ?? 0), 0))

    const wanted: { item: Doc; packs: number; why: string }[] = []
    if (o.kitting) {
      const items = (await payload.find({ collection: o.items as CollectionSlug, where: { and: [{ kittingItem: { exists: true } }, ...scoped] }, ...list, req })).docs as Doc[]
      for (const need of await kittingNeeds(payload, req, scope)) {
        const candidates = items.filter((i) => sameID(i.kittingItem, need.item))
        const bySupplier = candidates.filter((i) => need.supplier !== null && sameID(i.supplier, need.supplier))
        const item = pickItem(bySupplier.length ? bySupplier : candidates)
        if (!item) {
          result.unmatched.push({ item: need.item, name: need.name, suggested: need.suggested, unit: need.unit, why: need.why })
          continue
        }
        const coming = candidates.reduce((t, c) => t + (incoming.get(String(c.id)) ?? 0) * ((num(c.packSize) ?? 1) || 1), 0)
        const stillNeeded = round(need.suggested - coming)
        if (stillNeeded <= 0) {
          result.covered.push({ item: need.item, name: need.name, why: `${need.why}; already on order` })
          continue
        }
        const packs = packsFor(stillNeeded, num(item.packSize) ?? 1, num(item.minimumPacks) ?? 1)
        wanted.push({ item, packs, why: `${need.why}${coming > 0 ? `; ${round(coming)} ${need.unit} already on order` : ''}; ${round(stillNeeded)} ${need.unit} in packs of ${item.packSize}` })
      }
    } else if (o.needs) {
      for (const n of await o.needs({ payload, req, scope })) {
        const item = (await payload.findByID({ collection: o.items as CollectionSlug, id: n.supplierItem, ...sys, joins: false, disableErrors: true, req })) as Doc | null
        if (!item || (o.scopeField && !sameID(item[o.scopeField], scope))) continue
        const packs = Math.max(Math.ceil((n.packs ?? 0) - (incoming.get(String(item.id)) ?? 0)), 0)
        if (packs > 0) wanted.push({ item, packs: Math.max(packs, num(item.minimumPacks) ?? 1), why: n.why ?? 'from your app' })
      }
    }

    const bySupplier = new Map<string, typeof wanted>()
    for (const w of wanted) bySupplier.set(String(idOf(w.item.supplier)), [...(bySupplier.get(String(idOf(w.item.supplier))) ?? []), w])
    for (const [supplierID, lines] of bySupplier) {
      const draft = ((await payload.find({ collection: o.orders as CollectionSlug, where: { and: [{ status: { equals: 'draft' } }, { supplier: { equals: supplierID } }, ...scoped] }, sort: '-updatedAt', limit: 1, ...list, req })).docs as Doc[])[0]
      if (draft) {
        const have = new Set(((draft.lines ?? []) as Doc[]).map((l) => String(idOf(l.item))))
        const fresh = lines.filter((l) => !have.has(String(l.item.id)))
        if (!fresh.length) continue
        await asInternal(req, () =>
          payload.update({
            collection: o.orders as CollectionSlug,
            id: draft.id,
            data: { lines: [...((draft.lines ?? []) as Doc[]).map((l) => ({ ...l, item: idOf(l.item) })), ...fresh.map((l) => ({ item: l.item.id, packs: l.packs, why: l.why }))] } as never,
            ...sys,
            req,
          }),
        )
        result.added.push({ id: draft.id, number: String(draft.number), supplier: draft.supplier, lines: fresh.length })
      } else {
        const doc = (await asInternal(req, () =>
          payload.create({
            collection: o.orders as CollectionSlug,
            data: { supplier: supplierID, status: 'draft', lines: lines.map((l) => ({ item: l.item.id, packs: l.packs, why: l.why })), ...(o.scopeField ? { [o.scopeField]: scope } : {}) } as never,
            ...sys,
            req,
          }),
        )) as Doc
        result.created.push({ id: doc.id, number: String(doc.number), supplier: supplierID as unknown as ID, lines: lines.length })
      }
    }
    return result
  })
}

