import { mongooseAdapter } from '@payloadcms/db-mongodb'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { buildConfig, getPayload, type Access, type CollectionConfig, type Field, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { draftOrders, orderOutputs, restockPlugin } from '../src/index.js'

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
          overrides: { suppliers: withTenant, items: withTenant, orders: withTenant, settings: withTenant },
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

describe('ways to place an order', () => {
  it('gives quick-order lines, an email draft and product links', async () => {
    const supplier = await create('suppliers', {
      tenant: siteA.id,
      name: 'Example Packaging Co',
      email: 'orders@example.com',
      orderMethod: 'quick-order',
      orderUrl: 'https://supplies.example.com/quick-order',
      quickOrderMaxLines: 1,
      orderNotes: 'Account EX-0000 (made up).',
    })
    const a = await create('supplier-items', { tenant: siteA.id, supplier: supplier.id, sku: 'H-101', name: 'Box, "small", made up', packName: 'bundle of 25', packSize: 25, price: 20, productUrl: 'https://supplies.example.com/H-101' })
    const b = await create('supplier-items', { tenant: siteA.id, supplier: supplier.id, sku: '=CMD()', name: 'Tape, made up', packSize: 1, productUrl: 'javascript:alert(1)' })
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: a.id, packs: 3 }, { item: b.id, packs: 2 }] }, as(staffA))
    const out = await orderOutputs(payload, po.id)
    expect(out.quickOrder).toBe('H-101, 3\n=CMD(), 2')
    expect(out.quickOrderWarning).toMatch(/takes 1 lines at a time; this order has 2/)
    expect(out.email.to).toBe('orders@example.com')
    expect(out.email.body).toContain('- 3 × H-101 Box, "small", made up (bundle of 25) at $20.00')
    expect(out.email.body).toContain('Estimated total: $60.00 (some prices to confirm)')
    expect(out.email.body).toContain('Account EX-0000 (made up).')
    expect(out.email.mailto).toMatch(/^mailto:orders%40example\.com\?subject=Purchase%20order%20PO-/)
    expect(out.lines.map((l) => l.url)).toEqual(['https://supplies.example.com/H-101', null])
    // With a space separator and no limit.
    await update('suppliers', supplier.id, { quickOrderSeparator: 'space', quickOrderMaxLines: null })
    const spaced = await orderOutputs(payload, po.id)
    expect([spaced.quickOrder.split('\n')[0], spaced.quickOrderWarning]).toEqual(['H-101 3', null])
  })
})

describe('receiving without Kitting', () => {
  it('records what arrived, for people who manage that site only', async () => {
    const { supplier, mailer } = await supplierWithItems(siteA)
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: mailer.id, packs: 2 }] }, as(staffA))
    await update('purchase-orders', po.id, { status: 'approved' }, as(buyerA))
    await update('purchase-orders', po.id, { status: 'ordered' }, as(buyerA))
    const endpoint = payload.config.endpoints.find((e) => e.path === '/restock/receive')!
    const call = (user: Doc | null, body: Doc) => endpoint.handler({ payload, user: user && { ...user, collection: 'users' }, json: async () => body } as never) as Promise<Response>
    expect((await call(null, { order: po.id, lines: [{ line: 0, packs: 1 }] })).status).toBe(401)
    expect((await call(viewerA, { order: po.id, lines: [{ line: 0, packs: 1 }] })).status).toBe(403)
    expect((await call(staffB, { order: po.id, lines: [{ line: 0, packs: 1 }] })).status).toBe(403)
    expect((await call(staffA, { order: po.id, lines: [{ line: 0, packs: 0.5 }] })).status).toBe(400)
    const ok = await call(staffA, { order: po.id, lines: [{ line: 0, packs: 2 }], note: 'all fine' })
    expect([ok.status, (await ok.json()).status]).toEqual([200, 'received'])
    const order = await get('purchase-orders', po.id)
    expect(order.history.at(-1)).toMatchObject({ to: 'received', note: 'Received 2 × S-0001. all fine' })
    expect(String(order.history.at(-1).by)).toBe(String(staffA.id))
  })
})

describe('the Console’s cart API', () => {
  it('lists approved orders and records the cart, for people who may place orders, and changes nothing else', async () => {
    const { supplier, mailer } = await supplierWithItems(siteA)
    const approved = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: mailer.id, packs: 2 }] }, as(staffA))
    await update('purchase-orders', approved.id, { status: 'approved' }, as(buyerA))
    const draft = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, lines: [{ item: mailer.id, packs: 5 }] }, as(staffA))
    const list = payload.config.endpoints.find((e) => e.path === '/restock/cart/orders')!
    const cart = payload.config.endpoints.find((e) => e.path === '/restock/cart')!
    const get_ = (user: Doc | null, scope: unknown) =>
      list.handler({ payload, user: user && { ...user, collection: 'users' }, searchParams: new URLSearchParams(scope ? { scope: String(scope) } : {}) } as never) as Promise<Response>
    const post = (user: Doc | null, body: Doc) => cart.handler({ payload, user: user && { ...user, collection: 'users' }, json: async () => body } as never) as Promise<Response>

    expect((await get_(null, siteA.id)).status).toBe(401)
    expect((await get_(staffA, siteA.id)).status).toBe(403) // may draft, may not place
    expect((await get_(staffB, siteA.id)).status).toBe(403)
    const ok = await get_(buyerA, siteA.id)
    const orders = (await ok.json()).orders as Doc[]
    expect(orders.map((x) => x.id)).toContain(approved.id)
    expect(orders.map((x) => x.id)).not.toContain(draft.id)
    expect(orders.find((x) => x.id === approved.id)).toMatchObject({ quickOrder: 'S-0001, 2', cartStatus: null })

    expect((await post(staffA, { order: approved.id, status: 'filled' })).status).toBe(403)
    expect((await post(buyerA, { order: approved.id, status: 'failed' })).status).toBe(400) // needs a reason
    expect((await post(buyerA, { order: approved.id, status: 'bought' })).status).toBe(400)
    expect((await post(buyerA, { order: draft.id, status: 'filled' })).status).toBe(400)
    expect((await post(buyerA, { order: approved.id, status: 'filled', note: 'all 2 lines in the cart' })).status).toBe(200)
    const after = await get('purchase-orders', approved.id)
    expect(after).toMatchObject({ status: 'approved', cartStatus: 'filled', cartNote: 'all 2 lines in the cart' })
    expect(after.lines.map((l: Doc) => l.packs)).toEqual([2])
    expect(after.history.at(-1).note).toBe('Cart filled: all 2 lines in the cart')
    // Nobody can set the cart status through an ordinary save.
    await update('purchase-orders', approved.id, { cartStatus: 'failed', cartNote: 'x' }, as(buyerA))
    expect((await get('purchase-orders', approved.id)).cartStatus).toBe('filled')
  })
})

describe('exports: CSV, JSON and PDF', () => {
  it('builds every export from one document, with the site’s own buyer details, for people who may read the order', async () => {
    const supplier = await create('suppliers', { tenant: siteA.id, name: 'Example Packaging Co', email: 'orders@example.com' })
    const item = await create('supplier-items', { tenant: siteA.id, supplier: supplier.id, sku: 'S-0100', name: 'Mailer, “padded”, made up', packName: 'bundle of 25', packSize: 25, price: 18.4 })
    const free = await create('supplier-items', { tenant: siteA.id, supplier: supplier.id, sku: 'S-0101', name: 'Sample, made up', packSize: 1 })
    await create('restock-settings', {
      tenant: siteA.id,
      organizationName: 'Example Organization',
      shipTo: { name: 'Attn: Receiving', line1: '1 Example Way', city: 'Exampleton', region: 'EX', postalCode: '00000', country: 'USA' },
      contactName: 'Pat Example',
      terms: 'Net 30. Deliveries weekdays 9 to 4.',
      paperSize: 'A4',
    }, as(staffA))
    await expect(create('restock-settings', { tenant: siteA.id, organizationName: 'Again' }, as(staffA))).rejects.toThrow(/already exist/)
    const po = await create('purchase-orders', { tenant: siteA.id, supplier: supplier.id, notes: 'Please label boxes with the order number.', lines: [{ item: item.id, packs: 4 }, { item: free.id, packs: 1 }] }, as(staffA))
    await update('purchase-orders', po.id, { status: 'approved' }, as(buyerA))

    const endpoint = payload.config.endpoints.find((e) => e.path === '/restock/order/:id/:format')!
    const call = (user: Doc | null, format: string) => endpoint.handler({ payload, user: user && { ...user, collection: 'users' }, routeParams: { id: po.id, format } } as never) as Promise<Response>
    expect((await call(null, 'pdf')).status).toBe(401)
    expect((await call(staffB, 'pdf')).status).toBe(403)
    expect((await call(staffA, 'xls')).status).toBe(400)

    const json = await (await call(viewerA, 'json')).json()
    expect(json).toMatchObject({
      schema: 'restock.purchase-order',
      version: 1,
      number: po.number,
      status: 'approved',
      buyer: { organization: 'Example Organization', shipTo: ['Attn: Receiving', '1 Example Way', 'Exampleton, EX 00000', 'USA'], billTo: ['Attn: Receiving', '1 Example Way', 'Exampleton, EX 00000', 'USA'] },
      supplier: { name: 'Example Packaging Co', email: 'orders@example.com' },
      totals: { subtotal: 73.6, complete: false },
      approvedBy: 'buyer-a@example.com',
      paperSize: 'A4',
    })
    expect(json.lines[0]).toEqual({ sku: 'S-0100', description: 'Mailer, “padded”, made up', quantity: 4, soldAs: 'bundle of 25', packSize: 25, unitPrice: 18.4, lineTotal: 73.6, receivedQuantity: 0, productUrl: null })

    const csvRes = await call(viewerA, 'csv')
    expect(csvRes.headers.get('content-disposition')).toMatch(/filename="PO-\d{4}-Example-Packaging-Co\.csv"/)
    const csvBytes = new Uint8Array(await csvRes.arrayBuffer())
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // a byte-order mark, so Excel reads it as UTF-8
    const csv = new TextDecoder().decode(csvBytes)
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      'Supplier item number,Description,Quantity,Sold as,Pack size,Unit price (USD),Line total (USD)',
      'S-0100,"Mailer, “padded”, made up",4,bundle of 25,25,18.4,73.6',
      'S-0101,"Sample, made up",1,each,1,,',
    ])

    const pdfRes = await call(viewerA, 'pdf')
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf')
    const bytes = new Uint8Array(await pdfRes.arrayBuffer())
    const raw = Buffer.from(bytes).toString('latin1')
    expect(raw.startsWith('%PDF-1.7')).toBe(true)
    // Tagged for screen readers: a structure tree, marked content, a language and a title shown in the window.
    for (const marker of ['/StructTreeRoot', '/Marked true', '/Lang (en-US)', '/DisplayDocTitle true', '/Table', '/TH', '/H1']) expect(raw).toContain(marker)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: bytes, useSystemFonts: false }).promise
    const page = await pdf.getPage(1)
    expect(Math.round(page.view[2]!)).toBe(595) // A4 width in points
    const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
    for (const expected of ['Example Organization', `Purchase order ${po.number}`, 'Example Packaging Co', 'Attn: Receiving', 'S-0100', '$73.60', 'some prices to be confirmed', 'Approved by buyer-a@example.com', 'Net 30.', 'page 1 of 1'])
      expect(text).toContain(expected)
  })
})
