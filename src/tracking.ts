import type { CollectionSlug, Payload, Where } from 'payload'

import type { ID } from './types.js'
import { allows, asInternal, idOf, list, restockOf, sameID, sys, transaction, type Doc, type Req } from './util.js'

export type DeliveredResult = { status: 'delivered' | 'already' | 'not-found' | 'wrong-site'; order?: ID; number?: string }

const OPEN = ['ordered', 'partly-received', 'received']

/**
 * The carrier says a shipment arrived (crossing `restock-tracking`). Marks that shipment delivered and
 * puts the order on the "Arrived, please confirm" list; it never adds stock. The same event twice
 * changes nothing. With `scope`, a shipment on another site is left alone.
 */
export async function markDelivered(
  payload: Payload,
  args: { trackerId?: string; carrier?: string; trackingNumber?: string; scope?: ID | null; deliveredAt?: string; req?: Req },
): Promise<DeliveredResult> {
  const o = restockOf(payload)
  const where: Where = args.trackerId
    ? { 'shipments.trackerId': { equals: args.trackerId } }
    : args.trackingNumber
      ? { 'shipments.trackingNumber': { equals: args.trackingNumber } }
      : { id: { exists: false } }
  const result = await transaction(payload, args.req, async (req) => {
    const orders = ((await payload.find({ collection: o.orders as CollectionSlug, where: { and: [where, { status: { in: OPEN } }] }, ...list, req })).docs as Doc[]).filter(
      (order) => !args.carrier || !args.trackingNumber || ((order.shipments ?? []) as Doc[]).some((sh) => sh.trackingNumber === args.trackingNumber && String(sh.carrier ?? '').toLowerCase() === args.carrier!.toLowerCase()),
    )
    if (!orders.length) return { status: 'not-found' } as DeliveredResult
    const mine = o.scopeField && args.scope != null ? orders.filter((x) => sameID(x[o.scopeField!], args.scope)) : orders
    if (!mine.length) return { status: 'wrong-site' } as DeliveredResult
    if (mine.length > 1) return { status: 'not-found' } as DeliveredResult // ambiguous: a person sets it by hand
    const order = mine[0]!
    const matches = (sh: Doc) => (args.trackerId ? sh.trackerId === args.trackerId : sh.trackingNumber === args.trackingNumber)
    const shipments = ((order.shipments ?? []) as Doc[]).map((sh) => ({ ...sh }))
    const sh = shipments.find(matches)
    if (!sh) return { status: 'not-found' } as DeliveredResult
    if (sh.status === 'delivered') return { status: 'already', order: order.id, number: String(order.number) } as DeliveredResult
    sh.status = 'delivered'
    sh.deliveredAt = args.deliveredAt ?? new Date().toISOString()
    const history = [
      ...((order.history ?? []) as Doc[]),
      { at: new Date().toISOString(), by: null, from: order.status, to: order.status, note: `Shipment ${sh.trackingNumber} delivered (carrier); waiting for someone to confirm what arrived` },
    ]
    await asInternal(req, () => payload.update({ collection: o.orders as CollectionSlug, id: order.id, data: { shipments, history } as never, ...sys, req }))
    return { status: 'delivered', order: order.id, number: String(order.number) } as DeliveredResult
  })
  if (result.status === 'delivered' && result.order !== undefined && !args.req?.transactionID) await notifyArrived(payload, result.order).catch((error) => payload.logger.error({ err: error, msg: 'restock: arrival email not sent' }))
  return result
}

export type Arrived = { id: ID; number: string; supplier: string; deliveredAt: string | null; status: string; scope: ID | null }

/**
 * Orders with a delivered parcel that aren't fully received yet: the "Arrived, please confirm" list.
 * With `user`, only orders that person may receive.
 */
export async function awaitingConfirmation(payload: Payload, options: { user?: unknown; scope?: ID | null; req?: Req } = {}): Promise<Arrived[]> {
  const o = restockOf(payload)
  const where: Where = { and: [{ status: { in: ['ordered', 'partly-received'] } }, { 'shipments.status': { equals: 'delivered' } }, ...(o.scopeField && options.scope != null ? [{ [o.scopeField]: { equals: options.scope } }] : [])] }
  const orders = (await payload.find({ collection: o.orders as CollectionSlug, where, sort: 'updatedAt', ...list, depth: 1, req: options.req })).docs as Doc[]
  const out: Arrived[] = []
  for (const order of orders) {
    if (options.user !== undefined) {
      if (!options.user) continue
      const req = { user: options.user, payload } as never
      if (!(await allows(req, o.manage, o.orders, order.id))) continue
    }
    const delivered = ((order.shipments ?? []) as Doc[]).filter((sh) => sh.status === 'delivered').map((sh) => String(sh.deliveredAt ?? ''))
    out.push({
      id: order.id,
      number: String(order.number),
      supplier: String((order.supplier && typeof order.supplier === 'object' ? order.supplier.name : '') ?? ''),
      deliveredAt: delivered.sort().at(-1) || null,
      status: String(order.status),
      scope: o.scopeField ? idOf(order[o.scopeField]) : null,
    })
  }
  return out
}

/** One "arrived, please confirm" email per delivered shipment, where the site has email on. */
async function notifyArrived(payload: Payload, orderID: ID) {
  const o = restockOf(payload)
  if (!o.notify) return
  if (o.notify.canSend && !(await o.notify.canSend({ payload }))) return
  const order = (await payload.findByID({ collection: o.orders as CollectionSlug, id: orderID, ...sys, depth: 1, joins: false, disableErrors: true })) as Doc | null
  if (!order) return
  const fresh = ((order.shipments ?? []) as Doc[]).filter((sh) => sh.status === 'delivered' && !sh.notifiedAt)
  if (!fresh.length) return
  const scope = o.scopeField ? idOf(order[o.scopeField]) : null
  const r = o.notify.recipients
  const to = [...new Set((Array.isArray(r) ? r : r ? await r({ payload, scope }) : []).map((a) => a.trim()).filter(Boolean))]
  if (!to.length) return
  const supplier = order.supplier && typeof order.supplier === 'object' ? String(order.supplier.name ?? '') : ''
  const base = payload.config.serverURL
  const url = base ? `${base}${payload.config.routes.admin}/collections/${o.orders}/${order.id}` : null
  const text = [
    `${order.number}${supplier ? ` from ${supplier}` : ''} has been delivered (${fresh.map((sh) => sh.trackingNumber).join(', ')}).`,
    'Nothing has been added to stock yet. Please check the boxes and confirm what arrived.',
    ...(url ? ['', url] : []),
  ].join('\n')
  const subject = `Arrived, please confirm: ${order.number}`
  const html = text
    .split('\n')
    .map((l) => (l ? `<p>${l.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)}</p>` : ''))
    .join('')
  if (o.notify.sendEmail) await o.notify.sendEmail({ payload, to, subject, text, html })
  else await payload.sendEmail({ to, subject, text, html })
  const now = new Date().toISOString()
  const shipments = ((order.shipments ?? []) as Doc[]).map((sh) => (sh.status === 'delivered' && !sh.notifiedAt ? { ...sh, notifiedAt: now } : sh))
  await transaction(payload, undefined, (req) => asInternal(req, () => payload.update({ collection: o.orders as CollectionSlug, id: order.id, data: { shipments } as never, ...sys, req })))
}
