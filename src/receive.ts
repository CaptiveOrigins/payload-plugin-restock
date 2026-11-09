import type { CollectionSlug, Payload } from 'payload'

import type { ID } from './types.js'
import { asInternal, idOf, num, restockOf, RestockError, round, sys, transaction, userID, type Doc, type Req } from './util.js'

export type ReceiveLine = {
  /** The line's position on the order (0 first), or its supplier item. */
  line?: number
  item?: ID
  /** Whole packs that arrived. */
  packs: number
  lotNumber?: string | null
  expiresOn?: string | null
}

export type ReceiveResult = {
  status: 'partly-received' | 'received'
  received: { sku: string; packs: number; stock: { item: ID; quantity: number; unit: string } | null }[]
}

const RECEIVABLE = ['ordered', 'partly-received']

/**
 * Record what arrived on an order, in one transaction. With Kitting, each line linked to a supply
 * adds stock there as a `received` movement (with its lot and use-by date), so Kitting's checks,
 * lots and alerts all apply. More than was ordered is refused; the order becomes partly received or
 * received.
 */
export async function receiveOrder(payload: Payload, orderID: ID, lines: ReceiveLine[], options: { req?: Req; note?: string } = {}): Promise<ReceiveResult> {
  const o = restockOf(payload)
  if (!lines.length) throw new RestockError('noLines', 'Say what arrived.')
  return transaction(payload, options.req, async (req) => {
    const order = (await payload.findByID({ collection: o.orders as CollectionSlug, id: orderID, ...sys, joins: false, disableErrors: true, req })) as Doc | null
    if (!order) throw new RestockError('notFound', 'That order doesn’t exist.', 404)
    if (!RECEIVABLE.includes(order.status)) throw new RestockError('status', `Only ordered orders can be received; ${order.number} is ${order.status}.`)
    const orderLines: Doc[] = ((order.lines ?? []) as Doc[]).map((l) => ({ ...l, item: idOf(l.item), receivedPacks: num(l.receivedPacks) ?? 0 }))
    const kitting = o.kitting ? (payload.config.custom?.kitting as { movements: string; items: string } | undefined) : undefined
    const result: ReceiveResult = { status: 'received', received: [] }
    for (const r of lines) {
      const index = r.line ?? orderLines.findIndex((l) => String(l.item) === String(r.item))
      const line = orderLines[index]
      if (!line) throw new RestockError('line', 'That line isn’t on this order.')
      if (!(Number.isInteger(r.packs) && r.packs > 0)) throw new RestockError('packs', 'Receive a whole number of packs, 1 or more.')
      const item = (await payload.findByID({ collection: o.items as CollectionSlug, id: line.item!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
      if (!item) throw new RestockError('lineItem', 'An item on this order no longer exists.')
      const left = (num(line.packs) ?? 0) - line.receivedPacks
      if (r.packs > left) throw new RestockError('tooMany', `${item.sku}: ${left} pack${left === 1 ? '' : 's'} still to come, not ${r.packs}. Record extra stock in your stock system instead.`)
      line.receivedPacks += r.packs
      let stock: ReceiveResult['received'][number]['stock'] = null
      const supply = idOf(item.kittingItem)
      if (kitting && supply !== null) {
        const s = (await payload.findByID({ collection: kitting.items as CollectionSlug, id: supply, ...sys, joins: false, disableErrors: true, req })) as Doc | null
        if (!s) throw new RestockError('supply', `${item.sku} is linked to a supply that no longer exists.`)
        const quantity = round(r.packs * ((num(item.packSize) ?? 1) || 1))
        // Through Kitting's own movements: its access check (for a signed-in person), lots and alerts apply.
        await payload.create({
          collection: kitting.movements as CollectionSlug,
          data: {
            item: supply,
            kind: 'received',
            quantity,
            unit: s.unit,
            lotNumber: r.lotNumber || undefined,
            expiresOn: r.expiresOn || undefined,
            reference: [order.number, order.orderReference].filter(Boolean).join(' / '),
            reason: `Received on ${order.number} (${r.packs} × ${item.sku})`,
          } as never,
          ...sys,
          req,
        })
        stock = { item: supply, quantity, unit: String(s.unit) }
      }
      result.received.push({ sku: String(item.sku), packs: r.packs, stock })
    }
    const done = orderLines.every((l) => l.receivedPacks >= (num(l.packs) ?? 0))
    result.status = done ? 'received' : 'partly-received'
    const by = userID(o, req)
    const history = [
      ...((order.history ?? []) as Doc[]),
      { at: new Date().toISOString(), by, from: order.status, to: result.status, note: [`Received ${result.received.map((x) => `${x.packs} × ${x.sku}`).join(', ')}`, options.note].filter(Boolean).join('. ') },
    ]
    await asInternal(req, () =>
      payload.update({
        collection: o.orders as CollectionSlug,
        id: order.id,
        data: { status: result.status, lines: orderLines, history } as never,
        ...sys,
        req,
      }),
    )
    return result
  })
}
