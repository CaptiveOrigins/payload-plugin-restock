import { APIError, type Access, type CollectionSlug, type Payload, type PayloadRequest } from 'payload'

import { trueOrWhere } from './access.js'
import type { ID, ResolvedRestock } from './types.js'

export type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
export type Req = Partial<PayloadRequest>

/** Request-context key for writes Restock makes itself. Hosts never set it. */
export const INTERNAL = 'restockInternal'

export const restockOf = (payload: Payload): ResolvedRestock => {
  const o = payload.config.custom?.restock as ResolvedRestock | undefined
  if (!o) throw new Error('payload-plugin-restock is not installed in this Payload config.')
  return o
}

export const idOf = (v: unknown): ID | null => (v && typeof v === 'object' ? ((v as { id: ID }).id ?? null) : v === undefined || v === null || v === '' ? null : (v as ID))
export const sameID = (a: unknown, b: unknown) => String(idOf(a) ?? '') === String(idOf(b) ?? '')
export const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** Money and quantities without floating-point dust. */
export const round = (n: number, places = 6) => Math.round(n * 10 ** places) / 10 ** places

export class RestockError extends APIError<{ code: string }> {
  code: string
  constructor(code: string, message: string, status = 400) {
    super(message, status, { code }, true)
    this.code = code
  }
}

export const sys = { overrideAccess: true, depth: 0 } as const
export const list = { ...sys, pagination: false, joins: false } as const

/** Run in the caller's transaction when there is one, otherwise in our own. */
export async function transaction<T>(payload: Payload, req: Req | undefined, fn: (req: Req) => Promise<T>): Promise<T> {
  if (req?.transactionID) return fn(req)
  const transactionID = (await payload.db.beginTransaction?.()) ?? undefined
  const own: Req = { ...req, transactionID, context: { ...req?.context } }
  try {
    const result = await fn(own)
    if (transactionID) await payload.db.commitTransaction(transactionID)
    return result
  } catch (error) {
    if (transactionID) await payload.db.rollbackTransaction(transactionID)
    throw error
  }
}

/** Mark writes as Restock's own for the length of `fn`. */
export async function asInternal<T>(req: Req, fn: () => Promise<T>): Promise<T> {
  req.context ??= {}
  const before = req.context[INTERNAL]
  req.context[INTERNAL] = true
  try {
    return await fn()
  } finally {
    req.context[INTERNAL] = before
  }
}

/** Does this access function allow the person this document? A query result must match it. */
export async function allows(req: PayloadRequest, access: Access, collection: string, id: ID): Promise<boolean> {
  // Exactly `true`, or a well-formed query that must match this document. Any other truthy answer, an empty or
  // malformed query (Payload would skip it and match everything), and a thrown error are a no.
  const result = await trueOrWhere(() => access({ req } as never))
  if (result === true) return true
  if (result === false) return false
  try {
    const found = await req.payload.count({ collection: collection as CollectionSlug, where: { and: [{ id: { equals: id } }, result] }, overrideAccess: true, req })
    return found.totalDocs > 0
  } catch {
    // A query Payload can't run here (a field this collection doesn't have, say) is a no, not a 500.
    return false
  }
}

export const scopeOf = (o: ResolvedRestock, doc: Doc | null | undefined): ID | null => (o.scopeField && doc ? idOf(doc[o.scopeField]) : null)

export const userID = (o: ResolvedRestock, req: Req) => (req.user && req.user.collection === o.userSlug ? (req.user.id as ID) : null)
