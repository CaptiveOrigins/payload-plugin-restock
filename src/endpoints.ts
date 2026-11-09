import type { CollectionSlug, Endpoint, PayloadRequest, Where } from 'payload'

import { ordersForCart, recordCart } from './console.js'
import { purchaseOrderCSV, purchaseOrderDocument } from './document.js'
import { draftOrders } from './draft.js'
import { purchaseOrderPDF } from './pdf.js'
import { receiveOrder, type ReceiveLine } from './receive.js'
import type { CartStatus, ID } from './types.js'
import { allows, RestockError, restockOf } from './util.js'

type Body = Record<string, unknown>
const json = (data: unknown, status = 200) => Response.json(data, { status })
const bodyOf = async (req: PayloadRequest): Promise<Body> => (typeof req.json === 'function' ? ((await req.json().catch(() => ({}))) as Body) : {})

/**
 * May this person manage Restock on this site? Their `manage` access must allow it outright, or
 * match at least one of the site's suppliers. Fails closed.
 */
export async function mayManageSite(req: PayloadRequest, scope: ID | null): Promise<boolean> {
  const o = restockOf(req.payload)
  if (!req.user || req.user.collection !== o.userSlug) return false
  const access = await o.manage({ req } as never)
  if (access === true) return true
  if (!access || !o.scopeField || scope === null) return false
  const found = await req.payload.count({ collection: o.suppliers as CollectionSlug, where: { and: [{ [o.scopeField]: { equals: scope } }, access as Where] }, overrideAccess: true, req })
  return found.totalDocs > 0
}

const fail = (req: PayloadRequest, error: unknown) => {
  if (error instanceof RestockError) return json({ code: error.code, message: error.message }, error.status)
  req.payload.logger.error({ err: error, msg: 'restock: request failed' })
  return json({ message: 'Something went wrong; nothing was changed.' }, 500)
}

/** POST /api/restock/draft { scope } drafts a site's orders; POST /api/restock/receive { order, lines } records what arrived. */
export const restockEndpoints: Endpoint[] = [
  {
    path: '/restock/draft',
    method: 'post',
    handler: async (req) => {
      const o = restockOf(req.payload)
      if (!req.user) return json({ message: 'Sign in first.' }, 401)
      const body = await bodyOf(req)
      const scope = o.scopeField ? ((body.scope as ID | undefined) ?? null) : null
      if (o.scopeField && scope === null) return json({ message: `Say which ${o.scopeField}.` }, 400)
      if (!(await mayManageSite(req, scope))) return json({ message: 'You can’t draft orders here.' }, 403)
      try {
        return json(await draftOrders(req.payload, { scope, req: { user: req.user, payload: req.payload } as PayloadRequest }))
      } catch (error) {
        return fail(req, error)
      }
    },
  },
  {
    path: '/restock/receive',
    method: 'post',
    handler: async (req) => {
      const o = restockOf(req.payload)
      if (!req.user || req.user.collection !== o.userSlug) return json({ message: 'Sign in first.' }, 401)
      const body = await bodyOf(req)
      const order = body.order as ID | undefined
      if (order === undefined) return json({ message: 'Say which order.' }, 400)
      if (!(await allows(req, o.manage, o.orders, order))) return json({ message: 'You can’t receive this order.' }, 403)
      const lines = (Array.isArray(body.lines) ? body.lines : []) as ReceiveLine[]
      try {
        return json(await receiveOrder(req.payload, order, lines, { req: { user: req.user, payload: req.payload } as PayloadRequest, note: typeof body.note === 'string' ? body.note : undefined }))
      } catch (error) {
        return fail(req, error)
      }
    },
  },
  {
    // For the Console: approved orders on a site. People who may approve (place) orders only.
    path: '/restock/cart/orders',
    method: 'get',
    handler: async (req) => {
      const o = restockOf(req.payload)
      if (!req.user || req.user.collection !== o.userSlug) return json({ message: 'Sign in first.' }, 401)
      const scope = o.scopeField ? ((req.searchParams.get('scope') as ID | null) ?? null) : null
      if (o.scopeField && scope === null) return json({ message: `Say which ${o.scopeField}.` }, 400)
      try {
        const orders = await ordersForCart(req.payload, { scope, req: { user: req.user, payload: req.payload } as PayloadRequest })
        const allowed = []
        for (const order of orders) if (await allows(req, o.approve, o.orders, order.id)) allowed.push(order)
        if (orders.length && !allowed.length) return json({ message: 'You can’t place orders here.' }, 403)
        return json({ orders: allowed })
      } catch (error) {
        return fail(req, error)
      }
    },
  },
  {
    // For the Console: record whether it filled the cart. Nothing else can change through it.
    path: '/restock/cart',
    method: 'post',
    handler: async (req) => {
      const o = restockOf(req.payload)
      if (!req.user || req.user.collection !== o.userSlug) return json({ message: 'Sign in first.' }, 401)
      const body = await bodyOf(req)
      const order = body.order as ID | undefined
      if (order === undefined) return json({ message: 'Say which order.' }, 400)
      if (!(await allows(req, o.approve, o.orders, order))) return json({ message: 'You can’t place this order.' }, 403)
      try {
        return json(await recordCart(req.payload, order, { status: body.status as CartStatus, note: typeof body.note === 'string' ? body.note : undefined, req: { user: req.user, payload: req.payload } as PayloadRequest }))
      } catch (error) {
        return fail(req, error)
      }
    },
  },
  {
    // Exports: GET /api/restock/order/:id/csv, /json or /pdf, for people who may read that order.
    path: '/restock/order/:id/:format',
    method: 'get',
    handler: async (req) => {
      const o = restockOf(req.payload)
      if (!req.user || req.user.collection !== o.userSlug) return json({ message: 'Sign in first.' }, 401)
      const id = req.routeParams?.id as ID | undefined
      const format = String(req.routeParams?.format ?? '')
      if (!id || !['csv', 'json', 'pdf'].includes(format)) return json({ message: 'Ask for csv, json or pdf.' }, 400)
      if (!(await allows(req, o.read, o.orders, id))) return json({ message: 'You can’t see this order.' }, 403)
      try {
        const d = await purchaseOrderDocument(req.payload, id, { req: { user: req.user, payload: req.payload } as PayloadRequest })
        const name = `${d.number}-${d.supplier.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'supplier'}`
        const headers = (type: string, ext: string) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}.${ext}"`, 'Cache-Control': 'no-store' })
        if (format === 'json') return new Response(JSON.stringify(d, null, 2), { headers: headers('application/json; charset=utf-8', 'json') })
        if (format === 'csv') return new Response(purchaseOrderCSV(d), { headers: headers('text/csv; charset=utf-8', 'csv') })
        return new Response(new Uint8Array(await purchaseOrderPDF(d)), { headers: headers('application/pdf', 'pdf') })
      } catch (error) {
        return fail(req, error)
      }
    },
  },
]

export { fail, json, bodyOf }
