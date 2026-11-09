import { kittingPlugin } from '@captiveorigins/payload-plugin-kitting'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type CollectionConfig, type Field, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { draftOrders, receiveOrder, restockPlugin } from '../src/index.js'

// Restock with Kitting (from npm), on its own database. Made-up sites, suppliers and supplies.
type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let mongo: MongoMemoryReplSet
const tenantField: Field = { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true }
const withTenant = (c: CollectionConfig): CollectionConfig => ({ ...c, fields: [tenantField, ...c.fields] })
let site: Doc, other: Doc
const create = (collection: string, data: Doc) => payload.create({ collection: collection as never, data: data as never, depth: 0 }) as Promise<Doc>
const get = (collection: string, id: unknown) => payload.findByID({ collection: collection as never, id: id as string, depth: 0 }) as Promise<Doc>

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('restock-kitting'), ensureIndexes: true }),
      collections: [{ slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }, { slug: 'users', auth: true, fields: [] }],
      admin: { user: 'users' },
      plugins: [
        kittingPlugin({
          scopeField: 'tenant',
          overrides: { items: withTenant, suppliers: withTenant, movements: withTenant, recipes: withTenant, lots: withTenant, units: withTenant, requests: withTenant, boxes: withTenant, postage: withTenant },
        }),
        restockPlugin({ overrides: { items: withTenant, orders: withTenant } }),
      ],
    }),
  })
  site = await create('tenants', { name: 'Site' })
  other = await create('tenants', { name: 'Other site' })
}, 180_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('with Kitting', () => {
  it('shares Kitting’s supplier list instead of making a second one', async () => {
    const supplier = await create('suppliers', { tenant: site.id, name: 'Example Lab Supply', orderMethod: 'quick-order', orderUrl: 'https://supplies.example.com/quick' })
    expect(supplier.orderMethod).toBe('quick-order')
    expect(payload.config.collections.filter((c) => c.slug === 'suppliers')).toHaveLength(1)
  })

  it('drafts one order per supplier from what’s below level, in whole packs and minimums, minus what’s on order', async () => {
    const lab = await create('suppliers', { tenant: site.id, name: 'Example Lab Supply' })
    const pack = await create('suppliers', { tenant: site.id, name: 'Example Packaging' })
    // Swabs: 40 on hand, level 100, reorder 500 → 500 needed; packs of 200, so 3 packs.
    const swab = await create('supply-items', { tenant: site.id, name: 'Swab', unit: 'each', openingStock: 40, lowStockLevel: 100, reorderQuantity: 500, supplier: lab.id })
    // Mailers: 10 on hand, level 50, no reorder quantity → 40 needed; packs of 25 with a minimum of 4.
    const mailer = await create('supply-items', { tenant: site.id, name: 'Mailer', unit: 'each', openingStock: 10, lowStockLevel: 50, supplier: pack.id })
    // Gloves: below level, but no supplier item to buy them from.
    await create('supply-items', { tenant: site.id, name: 'Gloves', unit: 'each', openingStock: 1, lowStockLevel: 10 })
    // Plenty of tubes: nothing to buy.
    await create('supply-items', { tenant: site.id, name: 'Tube', unit: 'each', openingStock: 900, lowStockLevel: 100 })
    const swabItem = await create('supplier-items', { tenant: site.id, supplier: lab.id, kittingItem: swab.id, sku: 'SW-200', name: 'Swabs, made up', packName: 'bag of 200', packSize: 200, price: 30 })
    // A dearer swab elsewhere is never picked.
    await create('supplier-items', { tenant: site.id, supplier: pack.id, kittingItem: swab.id, sku: 'SW-X', name: 'Dear swabs', packSize: 100, price: 90, preferred: false })
    const mailerItem = await create('supplier-items', { tenant: site.id, supplier: pack.id, kittingItem: mailer.id, sku: 'M-25', name: 'Mailers, made up', packName: 'bundle of 25', packSize: 25, minimumPacks: 4 })
    // Another site's needs never show up here.
    await create('supply-items', { tenant: other.id, name: 'Other swab', unit: 'each', openingStock: 0, lowStockLevel: 100 })

    const r = await draftOrders(payload, { scope: site.id })
    expect(r.created).toHaveLength(2)
    const orders = await Promise.all(r.created.map((c) => get('purchase-orders', c.id)))
    const lines = Object.fromEntries(orders.flatMap((po) => (po.lines as Doc[]).map((l) => [String(l.item), l.packs])))
    expect(lines).toEqual({ [String(swabItem.id)]: 3, [String(mailerItem.id)]: 4 })
    expect(orders.every((po) => po.status === 'draft' && String(po.tenant) === String(site.id))).toBe(true)
    expect(r.unmatched.map((u) => u.name)).toEqual(['Gloves'])

    // Drafting again adds nothing new to the open drafts.
    const again = await draftOrders(payload, { scope: site.id })
    expect([again.created.length, again.added.length]).toEqual([0, 0])

    // Once the swab order is approved, it counts as on order: no new swab line.
    const swabOrder = orders.find((po) => String(po.supplier) === String(lab.id))!
    await payload.update({ collection: 'purchase-orders' as never, id: swabOrder.id, data: { status: 'approved' } as never })
    const third = await draftOrders(payload, { scope: site.id })
    expect(third.created).toHaveLength(0)
    expect(third.covered.map((c) => c.name)).toEqual(['Swab'])
  })
})

describe('receiving into Kitting', () => {
  it('adds stock (with lots) through Kitting, refuses more than ordered, and moves the order on', async () => {
    const lab = await create('suppliers', { tenant: site.id, name: 'Example Lab Supply (receiving)' })
    const tube = await create('supply-items', { tenant: site.id, name: 'Receiving tube', unit: 'each', openingStock: 10, trackLots: true, openingLotNumber: 'OLD' })
    const glove = await create('supply-items', { tenant: site.id, name: 'Receiving glove', unit: 'each', openingStock: 0 })
    const tubeItem = await create('supplier-items', { tenant: site.id, supplier: lab.id, kittingItem: tube.id, sku: 'T-100', name: 'Tubes, made up', packName: 'rack of 100', packSize: 100 })
    const gloveItem = await create('supplier-items', { tenant: site.id, supplier: lab.id, kittingItem: glove.id, sku: 'G-50', name: 'Gloves, made up', packSize: 50 })
    const po = await create('purchase-orders', { tenant: site.id, supplier: lab.id, lines: [{ item: tubeItem.id, packs: 3 }, { item: gloveItem.id, packs: 1 }] })
    await expect(receiveOrder(payload, po.id, [{ line: 0, packs: 1 }])).rejects.toThrow(/Only ordered orders/)
    await payload.update({ collection: 'purchase-orders' as never, id: po.id, data: { status: 'approved' } as never })
    await payload.update({ collection: 'purchase-orders' as never, id: po.id, data: { status: 'ordered', orderReference: 'EX-77' } as never })

    const first = await receiveOrder(payload, po.id, [{ line: 0, packs: 2, lotNumber: 'L-NEW', expiresOn: '2099-01-01T00:00:00.000Z' }])
    expect(first).toMatchObject({ status: 'partly-received', received: [{ sku: 'T-100', packs: 2, stock: { quantity: 200, unit: 'each' } }] })
    expect((await get('supply-items', tube.id)).onHand).toBe(210)
    const lots = ((await payload.find({ collection: 'supply-lots' as never, where: { item: { equals: tube.id } }, depth: 0 })).docs as Doc[]).map((l) => [l.lotNumber, l.onHand])
    expect(lots).toEqual(expect.arrayContaining([['L-NEW', 200]]))
    const movement = ((await payload.find({ collection: 'supply-movements' as never, where: { item: { equals: tube.id } }, sort: '-createdAt', limit: 1, depth: 0 })).docs as Doc[])[0]!
    expect(movement).toMatchObject({ kind: 'received', change: 200 })
    expect(movement.reference).toMatch(/^PO-\d{4} \/ EX-77$/)

    await expect(receiveOrder(payload, po.id, [{ line: 0, packs: 2 }])).rejects.toThrow(/1 pack still to come, not 2/)
    expect((await get('supply-items', tube.id)).onHand).toBe(210) // nothing written by the refusal
    const done = await receiveOrder(payload, po.id, [{ line: 0, packs: 1 }, { item: gloveItem.id, packs: 1 }])
    expect(done.status).toBe('received')
    expect((await get('supply-items', glove.id)).onHand).toBe(50)
    const order = await get('purchase-orders', po.id)
    expect(order.lines.map((l: Doc) => l.receivedPacks)).toEqual([3, 1])
    expect(order.history.map((h: Doc) => h.to)).toEqual(['draft', 'approved', 'ordered', 'partly-received', 'received'])
    await expect(receiveOrder(payload, po.id, [{ line: 1, packs: 1 }])).rejects.toThrow(/Only ordered orders/)
  })
})
