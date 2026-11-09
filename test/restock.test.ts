import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Access, type CollectionConfig, type Field, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { draftOrders, restockPlugin } from '../src/index.js'

// Made-up suppliers, items, sites and people throughout. No real account numbers or prices.
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let hostNeeds: { supplierItem: unknown; packs: number; why?: string }[] = []
let mongo: MongoMemoryReplSet
const ids = (v: unknown) => ((v as unknown[]) ?? []).map((t) => (t && typeof t === 'object' ? String((t as Doc).id) : String(t)))
/** Staff manage their sites, buyers may also approve, viewers only read. */
const siteAccess =
  (roles: string[]): Access =>
  ({ req }) => {
    const u = req.user as Doc | null
    if (!u) return false
    if (u.role === 'admin') return true
    if (!roles.includes(u.role)) return false
    return { tenant: { in: ids(u.tenants) } }
  }
const tenantField: Field = { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true }
const withTenant = (c: CollectionConfig): CollectionConfig => ({ ...c, fields: [tenantField, ...c.fields] })

let siteA: Doc, siteB: Doc
let staffA: Doc, buyerA: Doc, viewerA: Doc, staffB: Doc
const as = (u: Doc) => ({ user: { ...u, collection: 'users' }, overrideAccess: false })
const create = (collection: string, data: Doc, extra: Doc = {}) => payload.create({ collection: collection as never, data: data as never, depth: 0, ...extra }) as Promise<Doc>
const update = (collection: string, id: unknown, data: Doc, extra: Doc = {}) => payload.update({ collection: collection as never, id: id as string, data: data as never, depth: 0, ...extra }) as Promise<Doc>
const get = (collection: string, id: unknown) => payload.findByID({ collection: collection as never, id: id as string, depth: 0 }) as Promise<Doc>

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('restock'), ensureIndexes: true }),
      collections: [
        { slug: 'tenants', fields: [{ name: 'name', type: 'text' }] },
        { slug: 'users', auth: true, fields: [{ name: 'role', type: 'text' }, { name: 'tenants', type: 'relationship', relationTo: 'tenants', hasMany: true }] },
      ],
      admin: { user: 'users' },
      plugins: [
        restockPlugin({
          scopeField: 'tenant',
          access: { manage: siteAccess(['staff', 'buyer']), approve: siteAccess(['buyer']), read: siteAccess(['staff', 'buyer', 'viewer']) },
          overrides: { suppliers: withTenant, items: withTenant, orders: withTenant },
          needs: async ({ scope }) => (String(scope) === String(siteA?.id) ? (hostNeeds as never) : []),
        }),
      ],
    }),
  })
  siteA = await create('tenants', { name: 'Site A' })
  siteB = await create('tenants', { name: 'Site B' })
  const user = (email: string, role: string, tenants: Doc[]) => create('users', { email, password: 'a-long-test-password', role, tenants: tenants.map((t) => t.id) })
  staffA = await user('staff-a@example.com', 'staff', [siteA])
  buyerA = await user('buyer-a@example.com', 'buyer', [siteA])
  viewerA = await user('viewer-a@example.com', 'viewer', [siteA])
  staffB = await user('staff-b@example.com', 'staff', [siteB])
}, 180_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

async function supplierWithItems(site: Doc) {
  const supplier = await create('suppliers', { tenant: site.id, name: 'Example Packaging Co', orderMethod: 'quick-order', orderUrl: 'https://supplies.example.com/quick-order' })
  const mailer = await create('supplier-items', { tenant: site.id, supplier: supplier.id, sku: 'S-0001', name: 'Poly mailer, made up', packName: 'pack of 100', packSize: 100, minimumPacks: 2, price: 12.5 })
  const label = await create('supplier-items', { tenant: site.id, supplier: supplier.id, sku: 'S-0002', name: 'Label roll, made up', packName: 'roll', packSize: 500 })
  return { supplier, mailer, label }
}

describe('purchase orders', () => {
  it('numbers orders per site, snapshots prices and totals, and keeps a history', async () => {
    const { supplier, mailer, label } = await supplierWithItems(siteA)
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: mailer.id, packs: 3 }, { item: label.id, packs: 1 }] }, as(staffA))
    expect(po).toMatchObject({ status: 'draft', estimatedTotal: 37.5, totalComplete: false })
    expect(po.number).toMatch(/^PO-\d{4}$/)
    expect(po.lines[0].unitPrice).toBe(12.5)
    expect(po.history.map((h: Doc) => [h.from, h.to, String(h.by)])).toEqual([['new', 'draft', String(staffA.id)]])
    const next = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id }, as(staffA))
    expect(Number(next.number.slice(3))).toBe(Number(po.number.slice(3)) + 1)
    // Another site starts its own numbering.
    const b = await supplierWithItems(siteB)
    expect((await create('purchase-orders', { tenant: siteB.id, supplier: b.supplier.id }, as(staffB))).number).toBe('PO-0001')
  })

  it('moves draft → approved → ordered by hand, refuses the rest, and freezes lines after the draft', async () => {
    const { supplier, mailer } = await supplierWithItems(siteA)
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: mailer.id, packs: 2 }] }, as(staffA))
    await expect(create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, status: 'ordered' }, as(staffA))).rejects.toThrow(/starts as a draft/)
    // Staff may draft but not approve; a buyer may approve.
    await expect(update('purchase-orders', po.id, { status: 'approved' }, as(staffA))).rejects.toThrow(/can’t approve/)
    await expect(update('purchase-orders', po.id, { status: 'received' }, as(buyerA))).rejects.toThrow(/by hand/)
    const approved = await update('purchase-orders', po.id, { status: 'approved', statusNote: 'checked' }, as(buyerA))
    expect(approved.status).toBe('approved')
    const frozen = await update('purchase-orders', po.id, { lines: [{ item: mailer.id, packs: 99 }] }, as(buyerA))
    expect(frozen.lines[0].packs).toBe(2)
    const ordered = await update('purchase-orders', po.id, { status: 'ordered', orderReference: 'EX-123' }, as(buyerA))
    expect(ordered).toMatchObject({ status: 'ordered', orderReference: 'EX-123' })
    expect(String(ordered.orderedBy)).toBe(String(buyerA.id))
    expect(ordered.history.map((h: Doc) => h.to)).toEqual(['draft', 'approved', 'ordered'])
    expect(ordered.history[1].note).toBe('checked')
    // Not deletable once it's more than a draft; cancelling keeps the history.
    await expect(payload.delete({ collection: 'purchase-orders' as never, id: po.id, ...as(buyerA) })).rejects.toThrow(/Only drafts/)
    expect((await update('purchase-orders', po.id, { status: 'cancelled', statusNote: 'supplier out of stock' }, as(staffA))).status).toBe('cancelled')
    await expect(update('purchase-orders', po.id, { status: 'draft' }, as(buyerA))).rejects.toThrow(/by hand/)
  })

  it('refuses lines from another supplier or site, and packs that aren’t whole', async () => {
    const { supplier, mailer } = await supplierWithItems(siteA)
    const other = await supplierWithItems(siteA)
    const b = await supplierWithItems(siteB)
    const make = (lines: Doc[]) => create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines }, as(staffA))
    await expect(make([{ item: other.mailer.id, packs: 1 }])).rejects.toThrow(/another supplier/)
    await expect(make([{ item: b.mailer.id, packs: 1 }])).rejects.toThrow()
    await expect(make([{ item: mailer.id, packs: 1.5 }])).rejects.toThrow(/whole number/)
    await expect(create('purchase-orders', { tenant: siteA.id, supplier: b.supplier.id }, as(staffA))).rejects.toThrow(/another tenant/)
    await expect(create('supplier-items', { tenant: siteA.id, supplier: b.supplier.id, sku: 'X', name: 'x' }, as(staffA))).rejects.toThrow(/another tenant/)
  })

  it('keeps each site’s suppliers and orders to itself, and lets viewers only read', async () => {
    const { supplier } = await supplierWithItems(siteA)
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id }, as(staffA))
    for (const collection of ['suppliers', 'supplier-items', 'purchase-orders']) {
      const mine = (await payload.find({ collection: collection as never, ...as(staffA), pagination: false, depth: 0 })).docs as Doc[]
      expect(mine.every((d) => String(d.tenant) === String(siteA.id))).toBe(true)
      expect((await payload.find({ collection: collection as never, ...as(viewerA), pagination: false, depth: 0 })).docs.length).toBe(mine.length)
      expect(((await payload.find({ collection: collection as never, ...as(staffB), pagination: false, depth: 0 })).docs as Doc[]).every((d) => String(d.tenant) === String(siteB.id))).toBe(true)
      await expect(payload.find({ collection: collection as never, overrideAccess: false })).rejects.toThrow()
    }
    await expect(update('purchase-orders', po.id, { notes: 'x' }, as(viewerA))).rejects.toThrow()
    await expect(update('purchase-orders', po.id, { notes: 'x' }, as(staffB))).rejects.toThrow()
    await expect(create('suppliers', { tenant: siteA.id, name: 'Viewer’s supplier' }, as(viewerA))).rejects.toThrow()
  })
})

describe('drafting without Kitting', () => {
  it('drafts from the host’s own needs, at least the minimum, one draft per supplier', async () => {
    const { supplier, mailer, label } = await supplierWithItems(siteA)
    hostNeeds = [
      { supplierItem: mailer.id, packs: 1, why: 'shop says low' }, // minimum is 2
      { supplierItem: label.id, packs: 3 },
    ]
    const r = await draftOrders(payload, { scope: siteA.id })
    const mine = r.created.filter((c) => String(c.supplier) === String(supplier.id))
    expect(mine).toHaveLength(1)
    const po = await get('purchase-orders', mine[0]!.id)
    expect((po.lines as Doc[]).map((l) => [String(l.item), l.packs, l.why])).toEqual([
      [String(mailer.id), 2, 'shop says low'],
      [String(label.id), 3, 'from your app'],
    ])
    await expect(draftOrders(payload, {})).rejects.toThrow(/say which tenant/)
    hostNeeds = []
  })
})

describe('drafting over HTTP', () => {
  it('drafts only for people who manage that site', async () => {
    await supplierWithItems(siteA)
    const endpoint = payload.config.endpoints.find((e) => e.path === '/restock/draft')!
    const call = (user: Doc | null, scope: unknown) => endpoint.handler({ payload, user: user && { ...user, collection: 'users' }, json: async () => ({ scope }) } as never) as Promise<Response>
    expect((await call(null, siteA.id)).status).toBe(401)
    expect((await call(viewerA, siteA.id)).status).toBe(403)
    expect((await call(staffB, siteA.id)).status).toBe(403)
    expect((await call(staffA, undefined)).status).toBe(400)
    expect((await call(staffA, siteA.id)).status).toBe(200)
  })
})
