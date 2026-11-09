import type { Payload } from 'payload'
import React from 'react'

import { CopyBox, DownloadButton } from '../client/CopyBox.js'
import { ReceiveForm } from '../client/ReceiveForm.js'
import { restockOf, idOf, num } from '../util.js'
import { orderOutputs } from '../outputs.js'

/** On a purchase order: everything a person needs to place it themselves. Restock never places it. */
export async function PlaceOrder(props: { id?: string | number; payload: Payload }) {
  if (props.id === undefined || props.id === null) return null
  const out = await orderOutputs(props.payload, props.id).catch(() => null)
  if (!out) return null
  const box: React.CSSProperties = { padding: 12, borderRadius: 4, border: '1px solid var(--theme-elevation-150)', marginBottom: 'var(--base)' }
  if (!out.lines.length) return <p style={box}>Add lines to this order, then the ways to place it appear here.</p>
  const o = restockOf(props.payload)
  const order = (await props.payload.findByID({ collection: o.orders as never, id: props.id, depth: 0, overrideAccess: true, disableErrors: true })) as Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
  if (order && ['ordered', 'partly-received'].includes(order.status)) {
    const kitting = o.kitting ? (props.payload.config.custom?.kitting as { items: string } | undefined) : undefined
    const lines = []
    for (const [index, l] of ((order.lines ?? []) as Record<string, any>[]).entries()) { // eslint-disable-line @typescript-eslint/no-explicit-any
      const left = (num(l.packs) ?? 0) - (num(l.receivedPacks) ?? 0)
      if (left <= 0) continue
      const item = (await props.payload.findByID({ collection: o.items as never, id: idOf(l.item)!, depth: 0, overrideAccess: true, disableErrors: true })) as Record<string, any> | null // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!item) continue
      const supply = kitting && idOf(item.kittingItem) !== null ? ((await props.payload.findByID({ collection: kitting.items as never, id: idOf(item.kittingItem)!, depth: 0, overrideAccess: true, disableErrors: true })) as Record<string, any> | null) : null // eslint-disable-line @typescript-eslint/no-explicit-any
      lines.push({ index, sku: String(item.sku), name: String(item.name ?? ''), left, packName: String(item.packName || 'each'), lots: Boolean(supply?.trackLots) })
    }
    return (
      <section aria-labelledby="restock-receive" style={box}>
        <h3 id="restock-receive" style={{ margin: '0 0 8px' }}>
          Receive {out.number}
        </h3>
        <ReceiveForm order={String(props.id)} lines={lines} apiRoute={props.payload.config.routes.api} />
      </section>
    )
  }
  return (
    <section aria-labelledby="restock-place" style={box}>
      <h3 id="restock-place" style={{ margin: '0 0 8px' }}>
        Place this order with {out.supplier.name || 'the supplier'}
      </h3>
      <p style={{ margin: '0 0 var(--base)', fontSize: 14 }}>Restock never places orders. Use one of these, then mark the order as ordered and add their order number.</p>
      {out.supplier.orderMethod === 'quick-order' || out.supplier.orderUrl ? (
        <>
          <CopyBox
            label="Copy for Quick Order"
            text={out.quickOrder}
            rows={Math.min(Math.max(out.lines.length, 3), 12)}
            help={`One item per line, as their quick-order page asks.${out.quickOrderWarning ? ` ${out.quickOrderWarning}` : ''}`}
          />
          {out.supplier.orderUrl ? (
            <p style={{ margin: '0 0 var(--base)' }}>
              <a href={out.supplier.orderUrl} target="_blank" rel="noreferrer noopener">
                Open their order page
              </a>{' '}
              (opens in a new tab)
            </p>
          ) : null}
        </>
      ) : null}
      <p style={{ margin: '0 0 var(--base)' }}>
        <DownloadButton name={`${out.number}.csv`} text={out.csv} type="text/csv" label="Download CSV" />
        {out.email.mailto ? (
          <a className="btn btn--style-secondary btn--size-small" style={{ margin: 0 }} href={out.email.mailto}>
            Open as an email draft
          </a>
        ) : null}
      </p>
      <CopyBox label="Email text" text={`${out.email.subject}\n\n${out.email.body}`} rows={8} help={out.email.to ? `To ${out.email.to}. It's a draft: nothing is sent until you send it.` : 'Add an order email to the supplier to open it as a draft.'} />
      {out.lines.some((l) => l.url) ? (
        <>
          <h4 style={{ margin: '0 0 4px' }}>Product pages</h4>
          <ul style={{ margin: 0 }}>
            {out.lines
              .filter((l) => l.url)
              .map((l) => (
                <li key={l.sku}>
                  <a href={l.url!} target="_blank" rel="noreferrer noopener">
                    {l.sku}: {l.name}
                  </a>{' '}
                  × {l.packs}
                </li>
              ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
