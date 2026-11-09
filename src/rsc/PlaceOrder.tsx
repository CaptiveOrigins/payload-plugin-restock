import type { Payload } from 'payload'
import React from 'react'

import { CopyBox, DownloadButton } from '../client/CopyBox.js'
import { orderOutputs } from '../outputs.js'

/** On a purchase order: everything a person needs to place it themselves. Restock never places it. */
export async function PlaceOrder(props: { id?: string | number; payload: Payload }) {
  if (props.id === undefined || props.id === null) return null
  const out = await orderOutputs(props.payload, props.id).catch(() => null)
  if (!out) return null
  const box: React.CSSProperties = { padding: 12, borderRadius: 4, border: '1px solid var(--theme-elevation-150)', marginBottom: 'var(--base)' }
  if (!out.lines.length) return <p style={box}>Add lines to this order, then the ways to place it appear here.</p>
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
