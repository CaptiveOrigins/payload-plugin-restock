import { kittingPlugin } from '@captiveorigins/payload-plugin-kitting'
import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type CollectionConfig, type Field, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { draftOrders, restockPlugin } from '../src/index.js'

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
