import type { CollectionSlug, Payload } from 'payload'

import type { ID } from './types.js'
import { csvField } from './outputs.js'
import { idOf, num, restockOf, RestockError, round, sys, type Doc, type Req } from './util.js'

/**
 * A purchase order as one plain, documented object: the JSON export, and what the CSV, the printable
 * page and the PDF are all made from, so they never disagree. Format: docs/purchase-order-json.md.
 */
export type PurchaseOrderDocument = {
  schema: 'restock.purchase-order'
  version: 1
  id: ID
  number: string
  status: string
  /** ISO date: when it was approved, else when it was created. */
  date: string
  currency: string
  buyer: {
    organization: string | null
    shipTo: string[]
    billTo: string[]
    contact: { name: string | null; email: string | null; phone: string | null }
  }
  supplier: { name: string; email: string | null; phone: string | null; website: string | null; orderUrl: string | null }
  lines: {
    sku: string
    description: string
    /** How many of what it's sold as (packs). */
    quantity: number
    soldAs: string
    /** How many are in one, in the unit it's used in. */
    packSize: number
    unitPrice: number | null
    lineTotal: number | null
    receivedQuantity: number
    productUrl: string | null
  }[]
  totals: { subtotal: number; complete: boolean }
  approvedBy: string | null
  orderedBy: string | null
  supplierOrderReference: string | null
  notes: string | null
  terms: string | null
  paperSize: 'LETTER' | 'A4'
}

const addressLines = (a: Doc | null | undefined): string[] => {
  if (!a) return []
  const cityLine = [a.city, [a.region, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [a.name, a.line1, a.line2, cityLine, a.country].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean)
}

const http = (v: unknown) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

async function personName(payload: Payload, userSlug: string, id: unknown, req: Req): Promise<string | null> {
  if (idOf(id) === null) return null
  const user = (await payload.findByID({ collection: userSlug as CollectionSlug, id: idOf(id)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  if (!user) return null
  return str(user.name) ?? str([user.firstName, user.lastName].filter(Boolean).join(' ')) ?? str(user.email)
}

/** Build the document for an order. Reads with access overridden: callers check the person may read it. */
export async function purchaseOrderDocument(payload: Payload, orderID: ID, options: { req?: Req } = {}): Promise<PurchaseOrderDocument> {
  const o = restockOf(payload)
  const req = options.req ?? {}
  const order = (await payload.findByID({ collection: o.orders as CollectionSlug, id: orderID, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  if (!order) throw new RestockError('notFound', 'That order doesn’t exist.', 404)
  const supplier = (await payload.findByID({ collection: o.suppliers as CollectionSlug, id: idOf(order.supplier)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  const scope = o.scopeField ? idOf(order[o.scopeField]) : null
  const settings = (
    await payload.find({ collection: o.settings as CollectionSlug, where: o.scopeField ? { [o.scopeField]: { equals: scope } } : {}, limit: 1, ...sys, joins: false, req })
  ).docs[0] as Doc | undefined
  const lines: PurchaseOrderDocument['lines'] = []
  for (const l of (order.lines ?? []) as Doc[]) {
    const item = (await payload.findByID({ collection: o.items as CollectionSlug, id: idOf(l.item)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
    if (!item) continue
    const quantity = num(l.packs) ?? 0
    const unitPrice = num(l.unitPrice)
    lines.push({
      sku: String(item.sku),
      description: String(item.name ?? ''),
      quantity,
      soldAs: String(item.packName || 'each'),
      packSize: num(item.packSize) ?? 1,
      unitPrice,
      lineTotal: unitPrice === null ? null : round(unitPrice * quantity, 2),
      receivedQuantity: num(l.receivedPacks) ?? 0,
      productUrl: http(item.productUrl),
    })
  }
  const history = (order.history ?? []) as Doc[]
  const approval = [...history].reverse().find((h) => h.to === 'approved' && h.from !== 'approved')
  const shipTo = addressLines(settings?.shipTo)
  return {
    schema: 'restock.purchase-order',
    version: 1,
    id: order.id,
    number: String(order.number),
    status: String(order.status),
    date: String(approval?.at ?? order.createdAt ?? new Date().toISOString()),
    currency: o.currency,
    buyer: {
      organization: str(settings?.organizationName),
      shipTo,
      billTo: settings?.billToSame === false ? addressLines(settings?.billTo) : shipTo,
      contact: { name: str(settings?.contactName), email: str(settings?.contactEmail), phone: str(settings?.contactPhone) },
    },
    supplier: { name: String(supplier?.name ?? ''), email: str(supplier?.email), phone: str(supplier?.phone), website: http(supplier?.website), orderUrl: http(supplier?.orderUrl) },
    lines,
    totals: { subtotal: round(lines.reduce((t, l) => t + (l.lineTotal ?? 0), 0), 2), complete: lines.every((l) => l.unitPrice !== null) },
    approvedBy: approval ? await personName(payload, o.userSlug, approval.by, req) : null,
    orderedBy: await personName(payload, o.userSlug, order.orderedBy, req),
    supplierOrderReference: str(order.orderReference),
    notes: str(order.notes),
    terms: str(settings?.terms),
    paperSize: settings?.paperSize === 'A4' ? 'A4' : 'LETTER',
  }
}

/**
 * CSV for Excel and Numbers: a byte-order mark so accents survive, CRLF line ends, one line per item.
 * Columns: supplier item number, description, quantity, sold as, pack size, unit price, line total.
 */
export function purchaseOrderCSV(d: PurchaseOrderDocument): string {
  const head = ['Supplier item number', 'Description', 'Quantity', 'Sold as', 'Pack size', `Unit price (${d.currency})`, `Line total (${d.currency})`]
  const rows = d.lines.map((l) => [l.sku, l.description, l.quantity, l.soldAs, l.packSize, l.unitPrice ?? '', l.lineTotal ?? ''])
  return '﻿' + [head, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n'
}

export const money = (n: number | null, currency: string) => (n === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n))
export const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
