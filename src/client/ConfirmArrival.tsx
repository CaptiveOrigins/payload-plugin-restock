'use client'

import React, { useState } from 'react'

import { ReceiveForm } from './ReceiveForm.js'

type Line = { index: number; sku: string; name: string; left: number; packName: string; lots: boolean; expiryOptional?: boolean }

/**
 * "Yes, I received this package": one click adds exactly what's still to come, recorded as this
 * person's receipt. "Something's missing or damaged" opens the receive form, filled in to edit.
 * With lot-tracked supplies, the form comes first: lot and use-by are needed.
 */
export function ConfirmArrival({ order, number, lines, apiRoute }: { order: string; number: string; lines: Line[]; apiRoute: string }) {
  const needsLots = lines.some((l) => l.lots)
  const [mode, setMode] = useState<'ask' | 'form'>(needsLots ? 'form' : 'ask')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const all = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`${apiRoute}/restock/receive`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order, all: true }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setResult({ ok: false, message: data.message ?? 'Not recorded. Nothing was changed.' })
      else {
        setResult({ ok: true, message: `Received in full. The supplies are in stock. Reloading…` })
        setTimeout(() => window.location.reload(), 900)
      }
    } catch {
      setResult({ ok: false, message: 'Couldn’t reach the server. Nothing was changed; try again.' })
    } finally {
      setBusy(false)
    }
  }
  if (mode === 'form')
    return (
      <>
        <p style={{ margin: '0 0 8px' }}>{needsLots ? 'Check what arrived and give the lot and use-by from each label. Nothing is added until you record it.' : 'Change what arrived, and say what was missing or damaged.'}</p>
        <ReceiveForm order={order} lines={lines} apiRoute={apiRoute} prefill />
      </>
    )
  return (
    <div role="group" aria-label={`Confirm ${number}`}>
      <p style={{ margin: '0 0 8px' }}>The carrier says it was delivered. Nothing has been added to stock: check the boxes first.</p>
      <ul style={{ margin: '0 0 8px' }}>
        {lines.map((l) => (
          <li key={l.index}>
            {l.left} × {l.packName} of {l.sku} {l.name}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn--style-primary" style={{ margin: '0 8px 0 0' }} disabled={busy} onClick={() => void all()}>
        {busy ? 'Adding…' : 'Yes, I received this package: add the supplies'}
      </button>
      <button type="button" className="btn btn--style-secondary" style={{ margin: 0 }} disabled={busy} onClick={() => setMode('form')}>
        Something’s missing or damaged
      </button>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} style={{ margin: '8px 0 0', fontWeight: 600 }}>
          {result.message}
        </p>
      ) : null}
    </div>
  )
}
