import { DefaultTemplate } from '@payloadcms/next/templates'
import type { AdminViewServerProps, CollectionSlug } from 'payload'
import React from 'react'

import { DraftButton } from '../client/DraftButton.js'
import { STATUS_LABELS } from '../collections.js'
import { awaitingConfirmation } from '../tracking.js'
import { idOf, restockOf } from '../util.js'

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const day = (iso: unknown) => (typeof iso === 'string' && iso ? new Date(iso).toLocaleDateString('en', { dateStyle: 'medium' }) : '')

/** /admin/restock: arrived (please confirm), drafts, to place, and on its way. */
export async function RestockView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult
  const o = restockOf(req.payload)
  const admin = req.payload.config.routes.admin
  const canRead = req.user ? Boolean(await o.read({ req } as never)) : false
  const canManage = req.user ? Boolean(await o.manage({ req } as never)) : false
  const orders = canRead
    ? ((await req.payload.find({ collection: o.orders as CollectionSlug, where: { status: { in: ['draft', 'approved', 'ordered', 'partly-received'] } }, overrideAccess: false, user: req.user, depth: 1, pagination: false, sort: 'updatedAt' })).docs as Doc[])
    : []
  const arrived = canManage ? await awaitingConfirmation(req.payload, { user: req.user }) : []
  const arrivedIDs = new Set(arrived.map((a) => String(a.id)))
  const link = (d: Doc | { id: unknown; number: string }) => <a href={`${admin}/collections/${o.orders}/${String(d.id)}`}>{d.number}</a>
  const supplierOf = (d: Doc) => (d.supplier && typeof d.supplier === 'object' ? String(d.supplier.name ?? '') : '')
  // Sites this person can draft for: those of the suppliers they can see.
  const scopes = new Map<string, string>()
  if (canManage) {
    const suppliers = (await req.payload.find({ collection: o.suppliers as CollectionSlug, overrideAccess: false, user: req.user, depth: 1, pagination: false })).docs as Doc[]
    for (const s of suppliers) {
      const sc = o.scopeField ? s[o.scopeField] : null
      const key = String(idOf(sc) ?? '')
      if (!scopes.has(key)) scopes.set(key, sc && typeof sc === 'object' ? String(sc.name ?? sc.title ?? sc.slug ?? key) : key)
    }
  }
  const list = (title: string, id: string, rows: Doc[], empty: string, extra?: (d: Doc) => React.ReactNode) => (
    <section aria-labelledby={id}>
      <h2 id={id} style={{ margin: '0 0 8px' }}>
        {title} {rows.length ? `(${rows.length})` : ''}
      </h2>
      {rows.length ? (
        <ul style={{ margin: 0 }}>
          {rows.map((d) => (
            <li key={String(d.id)} style={{ marginBottom: 4 }}>
              {link(d)}, {supplierOf(d) || 'supplier'}
              {extra ? <> {extra(d)}</> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0 }}>{empty}</p>
      )}
    </section>
  )
  return (
    <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={req.payload} permissions={permissions} req={req} searchParams={searchParams} user={req.user ?? undefined} visibleEntities={visibleEntities}>
      <div className="gutter--left gutter--right" style={{ paddingBlock: 'calc(var(--base) * 2)', display: 'grid', gap: 'calc(var(--base) * 1.5)', maxWidth: 900 }}>
        <h1 style={{ margin: 0 }}>Restock</h1>
        {!canRead ? (
          <p>You don’t have access to purchase orders here.</p>
        ) : (
          <>
            {arrived.length > 0 && (
              <section aria-labelledby="restock-arrived" style={{ padding: 12, borderRadius: 4, border: '2px solid var(--theme-success-500)' }}>
                <h2 id="restock-arrived" style={{ margin: '0 0 8px' }}>
                  Arrived, please confirm ({arrived.length})
                </h2>
                <p style={{ margin: '0 0 8px' }}>Delivered, but nothing is added to stock until someone checks the boxes and confirms.</p>
                <ul style={{ margin: 0 }}>
                  {arrived.map((a) => (
                    <li key={String(a.id)}>
                      {link(a)}, {a.supplier || 'supplier'}
                      {a.deliveredAt ? `, delivered ${day(a.deliveredAt)}` : ''}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {canManage && scopes.size > 0 && (
              <section aria-labelledby="restock-draft">
                <h2 id="restock-draft" style={{ margin: '0 0 8px' }}>
                  What to buy
                </h2>
                <p style={{ margin: '0 0 8px' }}>Drafts one order per supplier from what’s low. A person checks and approves each one; nothing is bought for you.</p>
                {[...scopes.entries()].map(([key, name]) => (
                  <p key={key} style={{ margin: '0 0 8px' }}>
                    <DraftButton scope={o.scopeField ? key : null} label={o.scopeField && scopes.size > 1 ? `Draft orders for ${name}` : 'Draft orders now'} apiRoute={req.payload.config.routes.api} />
                  </p>
                ))}
              </section>
            )}
            {list('Drafts to check', 'restock-drafts', orders.filter((d) => d.status === 'draft'), 'No drafts.')}
            {list('Approved, to place', 'restock-approved', orders.filter((d) => d.status === 'approved'), 'Nothing waiting to be placed.')}
            {list(
              'On their way',
              'restock-ordered',
              orders.filter((d) => ['ordered', 'partly-received'].includes(d.status) && !arrivedIDs.has(String(d.id))),
              'Nothing on its way.',
              (d) => <>({STATUS_LABELS[d.status]?.toLowerCase()}{(d.shipments ?? []).length ? `, ${(d.shipments as Doc[]).map((s) => s.trackingNumber).join(', ')}` : ', no tracking yet'})</>,
            )}
          </>
        )}
      </div>
    </DefaultTemplate>
  )
}

/** Nav link to the Restock overview. */
export async function RestockNavLink({ payload, user }: { payload: import('payload').Payload; user?: unknown }) {
  if (!user) return null
  const access = await restockOf(payload).read({ req: { user, payload } } as never)
  if (!access) return null
  return (
    <a className="nav__link" href={`${payload.config.routes.admin}/restock`} style={{ display: 'block', marginTop: 'calc(var(--base) / 2)' }}>
      <span className="nav__link-label">Restock overview</span>
    </a>
  )
}
