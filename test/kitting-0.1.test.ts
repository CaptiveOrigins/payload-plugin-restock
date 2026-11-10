import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type CollectionConfig, type Field, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { draftOrders, restockPlugin } from '../src/index.js'

// Kitting 0.1 had no `restockNeeds`; Restock then works from Kitting's stock report. This file hides
// `restockNeeds` from the installed Kitting to check that path still drafts the same orders.
vi.mock('@captiveorigins/payload-plugin-kitting', async (original) => {
  const { restockNeeds: _hidden, ...rest } = await original<Record<string, unknown>>()
  return { ...rest, restockNeeds: undefined }
})
const { kittingPlugin } = await import('@captiveorigins/payload-plugin-kitting')

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

let payload: Payload
let mongo: MongoMemoryReplSet
const tenantField: Field = { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true }
const withTenant = (c: CollectionConfig): CollectionConfig => ({ ...c, fields: [tenantField, ...c.fields] })
const create = (collection: string, data: Doc) => payload.create({ collection: collection as never, data: data as never, depth: 0 }) as Promise<Doc>

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  payload = await getPayload({
    config: await buildConfig({
      secret: 'test-secret-not-for-production',
      telemetry: false,
      typescript: { autoGenerate: false },
      db: mongooseAdapter({ url: mongo.getUri('restock-kitting-01'), ensureIndexes: true }),
      collections: [{ slug: 'tenants', fields: [{ name: 'name', type: 'text' }] }, { slug: 'users', auth: true, fields: [] }],
      admin: { user: 'users' },
      plugins: [
        kittingPlugin({
          scopeField: 'tenant',
          overrides: { items: withTenant, suppliers: withTenant, movements: withTenant, recipes: withTenant, lots: withTenant, units: withTenant, requests: withTenant, boxes: withTenant, postage: withTenant, settings: withTenant },
        }),
        restockPlugin({ overrides: { items: withTenant, orders: withTenant, settings: withTenant } }),
      ],
    }),
  })
}, 180_000)

afterAll(async () => {
  await payload?.destroy()
  await mongo?.stop()
})

describe('with a Kitting that has no restockNeeds (0.1)', () => {
  it('drafts from Kitting’s below-level list, for this site only, in whole packs', async () => {
    const kitting = await import('@captiveorigins/payload-plugin-kitting')
    expect(typeof kitting.restockNeeds).toBe('undefined')
    const site = await create('tenants', { name: 'Site' })
    const other = await create('tenants', { name: 'Other site' })
    const lab = await create('suppliers', { tenant: site.id, name: 'Example Lab Supply' })
    // 40 on hand, level 100, reorder 500 → 500 needed; packs of 200, so 3 packs.
    const swab = await create('supply-items', { tenant: site.id, name: 'Swab', unit: 'each', openingStock: 40, lowStockLevel: 100, reorderQuantity: 500, supplier: lab.id })
    const swabItem = await create('supplier-items', { tenant: site.id, supplier: lab.id, kittingItem: swab.id, sku: 'SW-200', name: 'Swabs, made up', packSize: 200, price: 30 })
    await create('supply-items', { tenant: site.id, name: 'Gloves', unit: 'each', openingStock: 1, lowStockLevel: 10 })
    await create('supply-items', { tenant: other.id, name: 'Other swab', unit: 'each', openingStock: 0, lowStockLevel: 100 })

    const r = await draftOrders(payload, { scope: site.id })
    expect(r.created).toHaveLength(1)
    const po = (await payload.findByID({ collection: 'purchase-orders' as never, id: r.created[0]!.id as string, depth: 0 })) as Doc
    expect(po.lines.map((l: Doc) => [String(l.item), l.packs])).toEqual([[String(swabItem.id), 3]])
    expect(r.unmatched.map((u) => u.name)).toEqual(['Gloves'])
    expect(r.unmatched[0]!.why).toMatch(/below its level/)
  })
})
