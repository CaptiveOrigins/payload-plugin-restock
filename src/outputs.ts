import type { CollectionSlug, Payload } from 'payload'

import type { ID } from './types.js'
import { idOf, num, restockOf, RestockError, round, sys, type Doc, type Req } from './util.js'

export type OutputLine = { sku: string; name: string; packs: number; packName: string; unitPrice: number | null; lineTotal: number | null; url: string | null }

export type OrderOutputs = {
  number: string
  supplier: { name: string; email: string | null; orderUrl: string | null; orderMethod: string | null }
  lines: OutputLine[]
  /** For a supplier's quick-order page: one "ITEM, QUANTITY" line per item (or with a space or tab). */
  quickOrder: string
  /** When the supplier's page takes fewer lines than this order has. */
  quickOrderWarning: string | null
  csv: string
  email: { to: string | null; subject: string; body: string; mailto: string | null }
  total: number
  totalComplete: boolean
  currency: string
}

const SEPARATORS: Record<string, string> = { comma: ', ', space: ' ', tab: '\t' }

/** One CSV field: quoted when it holds a comma, quote or line break; a leading = + - @ is defused so spreadsheets don't run it. */
export const csvField = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const money = (n: number, currency: string) => new Intl.NumberFormat('en', { style: 'currency', currency }).format(n)

/**
 * Everything a person needs to place an order themselves: lines to paste into the supplier's
 * quick-order page, a CSV, an email draft (never sent by Restock) and product links.
 */
export async function orderOutputs(payload: Payload, orderID: ID, options: { req?: Req } = {}): Promise<OrderOutputs> {
  const o = restockOf(payload)
  const req = options.req ?? {}
  const order = (await payload.findByID({ collection: o.orders as CollectionSlug, id: orderID, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  if (!order) throw new RestockError('notFound', 'That order doesn’t exist.', 404)
  const supplier = (await payload.findByID({ collection: o.suppliers as CollectionSlug, id: idOf(order.supplier)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
  const lines: OutputLine[] = []
  for (const l of (order.lines ?? []) as Doc[]) {
    const item = (await payload.findByID({ collection: o.items as CollectionSlug, id: idOf(l.item)!, ...sys, joins: false, disableErrors: true, req })) as Doc | null
    if (!item) continue
    const packs = num(l.packs) ?? 0
    const unitPrice = num(l.unitPrice)
    lines.push({
      sku: String(item.sku),
      name: String(item.name ?? ''),
      packs,
      packName: String(item.packName || 'each'),
      unitPrice,
      lineTotal: unitPrice === null ? null : round(unitPrice * packs, 2),
      url: typeof item.productUrl === 'string' && /^https?:\/\//.test(item.productUrl) ? item.productUrl : null,
    })
  }
  const sep = SEPARATORS[String(supplier?.quickOrderSeparator ?? 'comma')] ?? ', '
  const max = num(supplier?.quickOrderMaxLines)
  const quickOrder = lines.map((l) => `${l.sku}${sep}${l.packs}`).join('\n')
  const quickOrderWarning = max !== null && lines.length > max ? `${supplier?.name ?? 'This supplier'}’s page takes ${max} lines at a time; this order has ${lines.length}. Paste it in two goes.` : null
  const csv = [
    ['Item number', 'Description', 'Quantity', 'Sold as', `Price of one (${o.currency})`, `Line total (${o.currency})`].map(csvField).join(','),
    ...lines.map((l) => [l.sku, l.name, l.packs, l.packName, l.unitPrice ?? '', l.lineTotal ?? ''].map(csvField).join(',')),
  ].join('\r\n')
  const total = num(order.estimatedTotal) ?? 0
  const complete = Boolean(order.totalComplete)
  const subject = `Purchase order ${order.number}`
  const body = [
    `Hello${supplier?.name ? ` ${supplier.name}` : ''},`,
    '',
    `Please supply the following (our order ${order.number}):`,
    '',
    ...lines.map((l) => `- ${l.packs} × ${l.sku} ${l.name} (${l.packName})${l.unitPrice === null ? '' : ` at ${money(l.unitPrice, o.currency)}`}`),
    '',
    lines.some((l) => l.unitPrice !== null) ? `Estimated total: ${money(total, o.currency)}${complete ? '' : ' (some prices to confirm)'}` : 'Please confirm prices.',
    ...(supplier?.orderNotes ? ['', String(supplier.orderNotes)] : []),
    '',
    'Please reply with a confirmation and the expected delivery date. Thank you.',
  ].join('\n')
  const to = typeof supplier?.email === 'string' && supplier.email ? supplier.email : null
  return {
    number: String(order.number),
    supplier: { name: String(supplier?.name ?? ''), email: to, orderUrl: typeof supplier?.orderUrl === 'string' && /^https?:\/\//.test(supplier.orderUrl) ? supplier.orderUrl : null, orderMethod: supplier?.orderMethod ?? null },
    lines,
    quickOrder,
    quickOrderWarning,
    csv,
    email: { to, subject, body, mailto: to ? `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null },
    total,
    totalComplete: complete,
    currency: o.currency,
  }
}
