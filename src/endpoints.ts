import type { CollectionSlug, Endpoint, PayloadRequest, Where } from 'payload'

import { draftOrders } from './draft.js'
import { receiveOrder, type ReceiveLine } from './receive.js'
import type { ID } from './types.js'
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
]

export { fail, json, bodyOf }
