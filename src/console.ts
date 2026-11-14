import type { CollectionSlug, Payload, Where } from 'payload'

import { orderOutputs, type OrderOutputs } from './outputs.js'
import type { CartStatus, ID } from './types.js'
import { asInternal, restockOf, RestockError, sys, transaction, userID, type Doc, type Req } from './util.js'

/**
 * For a console app (Tier 2), or any helper that fills a supplier's cart in a person's
 * own browser: the approved orders waiting to be placed, and one thing it may record, whether it
 * filled the cart. It never changes lines, status or anything else, and Restock never places orders.
 */

export type CartOrder = { id: ID; number: string; supplier: OrderOutputs['supplier']; lines: { sku: string; packs: number; url: string | null }[]; quickOrder: string; cartStatus: CartStatus | null }

/** Approved orders on a site, oldest first, with what a cart needs. */
export async function ordersForCart(payload: Payload, options: { scope?: ID | null; req?: Req } = {}): Promise<CartOrder[]> {
  const o = restockOf(payload)
  const scope = options.scope ?? null
  if (o.scopeField && scope === null) throw new RestockError('scope', `Say which ${o.scopeField}.`)
  const where: Where = { and: [{ status: { equals: 'approved' } }, ...(o.scopeField ? [{ [o.scopeField]: { equals: scope } }] : [])] }
  const orders = (await payload.find({ collection: o.orders as CollectionSlug, where, sort: 'updatedAt', pagination: false, ...sys, joins: false, req: options.req })).docs as Doc[]
  const out: CartOrder[] = []
  for (const order of orders) {
    const x = await orderOutputs(payload, order.id, { req: options.req })
    out.push({ id: order.id, number: x.number, supplier: x.supplier, lines: x.lines.map((l) => ({ sku: l.sku, packs: l.packs, url: l.url })), quickOrder: x.quickOrder, cartStatus: order.cartStatus ?? null })
  }
  return out
}

/** Record whether the cart was filled for an approved order, with a note. Nothing else changes. */
export async function recordCart(payload: Payload, orderID: ID, args: { status: CartStatus; note?: string; req?: Req }): Promise<{ id: ID; cartStatus: CartStatus }> {
  const o = restockOf(payload)
  if (args.status !== 'filled' && args.status !== 'failed') throw new RestockError('cartStatus', 'The cart is either filled or failed.')
  const note = String(args.note ?? '').slice(0, 500)
  if (args.status === 'failed' && !note.trim()) throw new RestockError('cartNote', 'Say why the cart couldn’t be filled.')
  return transaction(payload, args.req, async (req) => {
    const order = (await payload.findByID({ collection: o.orders as CollectionSlug, id: orderID, ...sys, joins: false, disableErrors: true, req })) as Doc | null
    if (!order) throw new RestockError('notFound', 'That order doesn’t exist.', 404)
    if (order.status !== 'approved') throw new RestockError('status', `Only approved orders go to a cart; ${order.number} is ${order.status}.`)
    const at = new Date().toISOString()
    await asInternal(req, () =>
      payload.update({
        collection: o.orders as CollectionSlug,
        id: order.id,
        data: {
          cartStatus: args.status,
          cartNote: note || null,
          cartAt: at,
          history: [...((order.history ?? []) as Doc[]), { at, by: userID(o, req), from: 'approved', to: 'approved', note: `Cart ${args.status}${note ? `: ${note}` : ''}` }],
        } as never,
        ...sys,
        req,
      }),
    )
    return { id: order.id as ID, cartStatus: args.status }
  })
}
