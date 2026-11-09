import type { CollectionBeforeChangeHook, CollectionBeforeDeleteHook, CollectionConfig, CollectionSlug, Field, PayloadRequest } from 'payload'

import type { ResolvedRestock } from './types.js'
import { allows, idOf, INTERNAL, num, RestockError, round, sameID, sys, userID, type Doc } from './util.js'

const ORDER_METHODS = [
  { label: 'Quick-order page (paste model numbers)', value: 'quick-order' },
  { label: 'Upload a CSV', value: 'csv' },
  { label: 'Email a purchase order', value: 'email' },
  { label: 'Their website, item by item', value: 'website' },
  { label: 'Phone', value: 'phone' },
]

/** Ordering fields, added to an existing suppliers collection or to Restock's own. */
export const orderingFields = (): Field[] => [
  {
    type: 'collapsible',
    label: 'Ordering',
    fields: [
      { name: 'orderMethod', type: 'select', label: 'How they take orders', options: ORDER_METHODS, defaultValue: 'website' },
      {
        type: 'row',
        fields: [
          { name: 'orderUrl', type: 'text', label: 'Order page', admin: { width: '50%', description: 'For example their quick-order or bulk-order page.' } },
          { name: 'minimumOrderValue', type: 'number', min: 0, label: 'Minimum order value', admin: { width: '50%' } },
        ],
      },
      {
        name: 'orderNotes',
        type: 'textarea',
        label: 'Ordering notes',
        admin: { description: 'Account number, who to address, shipping notes. Never passwords or card numbers: Restock never stores them.' },
      },
    ],
  },
]

export function suppliersCollection(o: ResolvedRestock): CollectionConfig {
  return {
    slug: o.suppliers,
    labels: { singular: 'Supplier', plural: 'Suppliers' },
    admin: { group: o.adminGroup, useAsTitle: 'name', defaultColumns: ['name', 'orderMethod', 'email', 'leadTimeDays'] },
    access: { read: o.read, create: o.manage, update: o.manage, delete: o.manage },
    fields: [
      { name: 'name', type: 'text', required: true, label: 'Name' },
      {
        type: 'row',
        fields: [
          { name: 'email', type: 'email', label: 'Order email', admin: { width: '50%' } },
          { name: 'phone', type: 'text', label: 'Phone', admin: { width: '50%' } },
        ],
      },
      { name: 'website', type: 'text', label: 'Website' },
      { name: 'leadTimeDays', type: 'number', min: 0, label: 'Usual days to deliver' },
      ...orderingFields(),
      { name: 'notes', type: 'textarea', label: 'Notes' },
    ],
  }
}

/** Every link inside one site, on every write path. */
async function sameScope(req: PayloadRequest, o: ResolvedRestock, scope: unknown, collection: string, id: unknown, what: string) {
  if (!o.scopeField || idOf(id) === null) return
  const doc = (await req.payload.findByID({ collection: collection as CollectionSlug, id: idOf(id)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  if (!doc) throw new RestockError('notFound', `${what} doesn’t exist.`)
  if (!sameID(doc[o.scopeField], scope)) throw new RestockError('scope', `${what} belongs to another ${o.scopeField}.`)
}

export function itemsCollection(o: ResolvedRestock, kittingItems: string | null): CollectionConfig {
  const beforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
    const scope = o.scopeField ? (data[o.scopeField] ?? originalDoc?.[o.scopeField]) : undefined
    const supplier = data.supplier !== undefined ? data.supplier : originalDoc?.supplier
    if (idOf(supplier) === null) throw new RestockError('supplierRequired', 'Choose the supplier.')
    await sameScope(req, o, scope, o.suppliers, supplier, 'That supplier')
    if (kittingItems && data.kittingItem !== undefined) await sameScope(req, o, scope, kittingItems, data.kittingItem, 'That supply')
    const sku = String(data.sku ?? originalDoc?.sku ?? '').trim()
    if (!sku) throw new RestockError('sku', 'Give the supplier’s item or model number.')
    data.sku = sku
    if (data.price !== undefined && data.price !== originalDoc?.price && data.priceSeenOn === undefined) data.priceSeenOn = new Date().toISOString()
    return data
  }
  return {
    slug: o.items,
    labels: { singular: 'Supplier item', plural: 'Supplier items' },
    admin: {
      group: o.adminGroup,
      useAsTitle: 'title',
      defaultColumns: ['title', 'supplier', 'packSize', 'price', 'priceSeenOn'],
      description: 'What you buy from each supplier: their item or model number, pack, minimum and price.',
    },
    access: { read: o.read, create: o.manage, update: o.manage, delete: o.manage },
    hooks: {
      beforeChange: [
        beforeChange,
        ({ data, originalDoc }) => {
          data.title = `${data.sku ?? originalDoc?.sku ?? ''}: ${data.name ?? originalDoc?.name ?? ''}`
          return data
        },
      ],
    },
    fields: [
      { name: 'title', type: 'text', admin: { hidden: true } },
      { name: 'supplier', type: 'relationship', relationTo: o.suppliers as CollectionSlug, required: true, label: 'Supplier' },
      {
        type: 'row',
        fields: [
          { name: 'sku', type: 'text', required: true, label: 'Item or model number', admin: { width: '40%', description: 'Exactly as the supplier writes it, for example S-1234.' } },
          { name: 'name', type: 'text', required: true, label: 'Description', admin: { width: '60%' } },
        ],
      },
      {
        type: 'row',
        fields: [
          { name: 'packName', type: 'text', label: 'Sold as', defaultValue: 'each', admin: { width: '34%', description: 'For example: box of 100, case of 6, each.' } },
          { name: 'packSize', type: 'number', required: true, defaultValue: 1, min: 0.000001, label: 'How many in one', admin: { width: '33%', description: 'In the unit you use it in.' } },
          { name: 'minimumPacks', type: 'number', min: 1, defaultValue: 1, label: 'Minimum order (packs)', admin: { width: '33%' } },
        ],
      },
      {
        type: 'row',
        fields: [
          { name: 'price', type: 'number', min: 0, label: `Price of one (${o.currency})`, admin: { width: '50%' } },
          { name: 'priceSeenOn', type: 'date', label: 'Price seen on', admin: { width: '50%', date: { pickerAppearance: 'dayOnly' } } },
        ],
      },
      { name: 'productUrl', type: 'text', label: 'Product page' },
      ...(kittingItems
        ? [
            {
              name: 'kittingItem',
              type: 'relationship' as const,
              relationTo: kittingItems as CollectionSlug,
              label: 'Supply it restocks',
              admin: { description: 'The Kitting supply this item becomes when it arrives. Then Restock suggests how many to order, and receiving adds the stock.' },
            },
          ]
        : []),
      {
        name: 'preferred',
        type: 'checkbox',
        defaultValue: true,
        label: 'Use this one when drafting orders',
        admin: { position: 'sidebar', description: 'When a supply has items from several suppliers, drafts use the preferred one (the cheapest per unit if several are).' },
      },
      { name: 'active', type: 'checkbox', defaultValue: true, label: 'Still sold', admin: { position: 'sidebar' } },
      { name: 'notes', type: 'textarea', label: 'Notes' },
    ],
  }
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Approved',
  ordered: 'Ordered',
  'partly-received': 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
}

/** What a person may change a status to by hand. Receiving moves orders on through `receiveOrder`. */
const BY_HAND: Record<string, string[]> = {
  draft: ['approved', 'cancelled'],
  approved: ['draft', 'ordered', 'cancelled'],
  ordered: ['cancelled'],
  'partly-received': [],
  received: [],
  cancelled: [],
}

export function ordersCollection(o: ResolvedRestock): CollectionConfig {
  const beforeChange: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
    const internal = Boolean(req.context?.[INTERNAL])
    const scope = o.scopeField ? (data[o.scopeField] ?? originalDoc?.[o.scopeField]) : undefined
    const supplier = data.supplier !== undefined ? data.supplier : originalDoc?.supplier
    if (idOf(supplier) === null) throw new RestockError('supplierRequired', 'Choose the supplier.')
    if (operation === 'update' && !sameID(supplier, originalDoc?.supplier)) throw new RestockError('supplier', 'An order can’t move to another supplier. Start a new one.')
    await sameScope(req, o, scope, o.suppliers, supplier, 'That supplier')

    const from = (originalDoc?.status ?? null) as string | null
    const to = (data.status ?? from ?? 'draft') as string
    if (!internal) {
      if (operation === 'create' && to !== 'draft') throw new RestockError('status', 'A new order starts as a draft.')
      if (operation === 'update' && to !== from) {
        if (!BY_HAND[from!]?.includes(to)) throw new RestockError('status', `A ${STATUS_LABELS[from!]?.toLowerCase()} order can’t be made ${STATUS_LABELS[to]?.toLowerCase() ?? to} by hand.`)
        // Signed-in people need approve access; trusted server code (no user, access overridden) doesn't.
        if ((to === 'approved' || to === 'ordered') && req.user && !(await allows(req, o.approve, o.orders, originalDoc!.id))) throw new RestockError('forbidden', 'You can’t approve or place orders here.', 403)
      }
      // Lines change only while it's a draft. Receiving and cart status change through Restock.
      if (operation === 'update' && from !== 'draft') data.lines = originalDoc?.lines
      for (const f of ['received', 'cartStatus', 'cartNote', 'cartAt', 'history', 'number']) if (operation === 'update') data[f] = originalDoc?.[f]
    }
    data.status = to
    if (operation === 'create') {
      data.history = []
      data.number = await nextNumber(req, o, scope)
    }
    if (to !== from) {
      const by = userID(o, req)
      data.history = [...((data.history ?? originalDoc?.history ?? []) as Doc[]), { at: new Date().toISOString(), by, from: from ?? 'new', to, note: data.statusNote ?? null }]
      if (to === 'ordered') {
        data.orderedAt = new Date().toISOString()
        data.orderedBy = by
      }
    }
    delete data.statusNote

    // Lines: each one this supplier's item, on this site; prices snapshot from the item when empty.
    const lines = (data.lines ?? []) as Doc[]
    let total = 0
    let complete = true
    for (const line of lines) {
      if (idOf(line.item) === null) throw new RestockError('lineItem', 'Choose the item for each line.')
      const item = (await req.payload.findByID({ collection: o.items as CollectionSlug, id: idOf(line.item)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
      if (!item) throw new RestockError('lineItem', 'An item on this order no longer exists.')
      if (!sameID(item.supplier, supplier)) throw new RestockError('lineSupplier', `${item.sku} is sold by another supplier.`)
      if (o.scopeField && !sameID(item[o.scopeField], scope)) throw new RestockError('scope', `${item.sku} belongs to another ${o.scopeField}.`)
      const packs = num(line.packs)
      if (packs === null || !Number.isInteger(packs) || packs < 1) throw new RestockError('packs', `Order a whole number of packs of ${item.sku}, 1 or more.`)
      if (line.unitPrice === undefined || line.unitPrice === null) line.unitPrice = num(item.price)
      if (num(line.unitPrice) === null) complete = false
      else total += packs * (line.unitPrice as number)
      line.receivedPacks = num(line.receivedPacks) ?? 0
    }
    data.estimatedTotal = round(total, 2)
    data.totalComplete = complete
    return data
  }
  const beforeDelete: CollectionBeforeDeleteHook = async ({ id, req }) => {
    if (req.context?.[INTERNAL]) return
    const doc = (await req.payload.findByID({ collection: o.orders as CollectionSlug, id, ...sys, joins: false, disableErrors: true, req })) as Doc | null
    if (doc && doc.status !== 'draft') throw new RestockError('keep', 'Only drafts can be deleted. Cancel an order instead, so its history stays.')
  }
  return {
    slug: o.orders,
    labels: { singular: 'Purchase order', plural: 'Purchase orders' },
    admin: {
      group: o.adminGroup,
      useAsTitle: 'number',
      defaultColumns: ['number', 'supplier', 'status', 'estimatedTotal', 'updatedAt'],
      description: 'What to buy from one supplier. Restock drafts them; a person checks, approves and places the order. Nothing is ever bought for you.',
    },
    defaultSort: '-updatedAt',
    access: { read: o.read, create: o.manage, update: o.manage, delete: o.manage },
    hooks: { beforeChange: [beforeChange], beforeDelete: [beforeDelete] },
    indexes: [{ fields: o.scopeField ? ['number', o.scopeField] : ['number'], unique: true }],
    fields: [
      { name: 'number', type: 'text', label: 'Order number', admin: { readOnly: true, position: 'sidebar' } },
      { name: 'supplier', type: 'relationship', relationTo: o.suppliers as CollectionSlug, required: true, label: 'Supplier' },
      {
        name: 'status',
        type: 'select',
        required: true,
        defaultValue: 'draft',
        label: 'Status',
        options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ label, value })),
        admin: { position: 'sidebar', description: 'Draft → approved → ordered → received. Lines can be changed only in a draft.' },
      },
      { name: 'statusNote', type: 'text', virtual: true, label: 'Note for this change', admin: { position: 'sidebar' } },
      {
        name: 'lines',
        type: 'array',
        label: 'Lines',
        labels: { singular: 'Line', plural: 'Lines' },
        fields: [
          {
            type: 'row',
            fields: [
              {
                name: 'item',
                type: 'relationship',
                relationTo: o.items as CollectionSlug,
                required: true,
                label: 'Item',
                admin: { width: '40%' },
                filterOptions: ({ data }) => (idOf(data?.supplier) === null ? false : { supplier: { equals: idOf(data.supplier) } }),
              },
              { name: 'packs', type: 'number', required: true, min: 1, label: 'Packs', admin: { width: '20%' } },
              { name: 'unitPrice', type: 'number', min: 0, label: 'Price of one', admin: { width: '20%', description: 'Empty: the item’s price.' } },
              { name: 'receivedPacks', type: 'number', defaultValue: 0, label: 'Received', admin: { width: '20%', readOnly: true } },
            ],
          },
          { name: 'why', type: 'text', label: 'Why', admin: { readOnly: true, description: 'What Restock based the quantity on.' } },
          { name: 'note', type: 'text', label: 'Note' },
        ],
      },
      {
        type: 'row',
        fields: [
          { name: 'estimatedTotal', type: 'number', label: `Estimated total (${o.currency})`, admin: { readOnly: true, width: '50%' } },
          { name: 'totalComplete', type: 'checkbox', label: 'Every line has a price', admin: { readOnly: true, width: '50%' } },
        ],
      },
      { name: 'orderReference', type: 'text', label: 'Supplier’s order number', admin: { description: 'From their confirmation, once ordered.' } },
      { name: 'orderedAt', type: 'date', label: 'Ordered', admin: { readOnly: true, position: 'sidebar', date: { pickerAppearance: 'dayAndTime' } } },
      { name: 'orderedBy', type: 'relationship', relationTo: o.userSlug as CollectionSlug, label: 'Ordered by', admin: { readOnly: true, position: 'sidebar' } },
      {
        type: 'collapsible',
        label: 'Cart (Captive Origins Console)',
        admin: { initCollapsed: true, condition: (d) => Boolean(d?.cartStatus) },
        fields: [
          {
            name: 'cartStatus',
            type: 'select',
            label: 'Cart',
            options: [
              { label: 'Filled, waiting for a person to check out', value: 'filled' },
              { label: 'Couldn’t fill it', value: 'failed' },
            ],
            admin: { readOnly: true },
          },
          { name: 'cartNote', type: 'text', label: 'Cart note', admin: { readOnly: true } },
          { name: 'cartAt', type: 'date', label: 'Cart updated', admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } } },
        ],
      },
      {
        name: 'history',
        type: 'array',
        label: 'History',
        admin: { readOnly: true, initCollapsed: true },
        fields: [
          {
            type: 'row',
            fields: [
              { name: 'at', type: 'date', label: 'When', admin: { width: '30%', date: { pickerAppearance: 'dayAndTime' } } },
              { name: 'by', type: 'relationship', relationTo: o.userSlug as CollectionSlug, label: 'Who', admin: { width: '25%' } },
              { name: 'from', type: 'text', label: 'From', admin: { width: '15%' } },
              { name: 'to', type: 'text', label: 'To', admin: { width: '15%' } },
            ],
          },
          { name: 'note', type: 'text', label: 'Note' },
        ],
      },
      { name: 'notes', type: 'textarea', label: 'Notes' },
    ],
  }
}

/** PO-0001, PO-0002… per site, after the highest so far. A unique index catches two drafts made at the same moment. */
async function nextNumber(req: PayloadRequest, o: ResolvedRestock, scope: unknown): Promise<string> {
  const last = (await req.payload.find({ collection: o.orders as CollectionSlug, where: o.scopeField ? { [o.scopeField]: { equals: idOf(scope) } } : {}, sort: '-number', limit: 1, ...sys, req }))
    .docs[0] as Doc | undefined
  const n = Number(String(last?.number ?? 'PO-0').replace(/^PO-/, '')) || 0
  return `PO-${String(n + 1).padStart(4, '0')}`
}
