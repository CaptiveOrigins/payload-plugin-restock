'use client'

import React, { useId, useState } from 'react'

type Line = { index: number; sku: string; name: string; left: number; packName: string; lots: boolean }

/** What arrived: packs per line, with a lot number and use-by date where the supply tracks lots. */
export function ReceiveForm({ order, lines, apiRoute }: { order: string; lines: Line[]; apiRoute: string }) {
  const base = useId()
  const [values, setValues] = useState<Record<number, { packs: string; lot: string; expires: string }>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const set = (i: number, k: 'packs' | 'lot' | 'expires', v: string) => setValues({ ...values, [i]: { packs: '', lot: '', expires: '', ...values[i], [k]: v } })
  const entered = lines.flatMap((l) => {
    const v = values[l.index]
    if (!v || v.packs.trim() === '') return []
    const packs = Number(v.packs)
    return [{ l, packs, valid: Number.isInteger(packs) && packs > 0 && packs <= l.left, v }]
  })
  const invalid = entered.filter((e) => !e.valid)
  const save = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch(`${apiRoute}/restock/receive`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order,
          lines: entered.map((e) => ({ line: e.l.index, packs: e.packs, lotNumber: e.v.lot.trim() || null, expiresOn: e.v.expires ? new Date(`${e.v.expires}T00:00:00Z`).toISOString() : null })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setResult({ ok: false, message: data.message ?? 'Not recorded. Nothing was changed.' })
      else {
        setResult({ ok: true, message: `Recorded. The order is ${data.status === 'received' ? 'fully received' : 'partly received'}. Reloading…` })
        setTimeout(() => window.location.reload(), 900)
      }
    } catch {
      setResult({ ok: false, message: 'Couldn’t reach the server. Nothing was changed; try again.' })
    } finally {
      setBusy(false)
    }
  }
  if (!lines.length) return <p style={{ margin: 0 }}>Everything on this order has arrived.</p>
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && entered.length && !invalid.length) void save()
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <caption style={{ textAlign: 'left', padding: '0 0 8px' }}>Type how many packs arrived. Leave a line empty if nothing came.</caption>
        <thead>
          <tr>
            <th scope="col" style={{ textAlign: 'left', padding: 6 }}>Item</th>
            <th scope="col" style={{ textAlign: 'right', padding: 6 }}>Still to come</th>
            <th scope="col" style={{ textAlign: 'left', padding: 6 }}>Arrived</th>
            <th scope="col" style={{ textAlign: 'left', padding: 6 }}>Lot number</th>
            <th scope="col" style={{ textAlign: 'left', padding: 6 }}>Use by</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const id = `${base}-${l.index}`
            const v = values[l.index] ?? { packs: '', lot: '', expires: '' }
            const bad = v.packs.trim() !== '' && !(Number.isInteger(Number(v.packs)) && Number(v.packs) > 0 && Number(v.packs) <= l.left)
            return (
              <tr key={l.index} style={{ borderTop: '1px solid var(--theme-elevation-150)' }}>
                <th scope="row" style={{ textAlign: 'left', padding: 6, fontWeight: 400 }}>
                  <label htmlFor={`${id}-p`}>
                    {l.sku}: {l.name}
                  </label>
                </th>
                <td style={{ textAlign: 'right', padding: 6 }}>
                  {l.left} × {l.packName}
                </td>
                <td style={{ padding: 6 }}>
                  <input id={`${id}-p`} inputMode="numeric" value={v.packs} onChange={(e) => set(l.index, 'packs', e.target.value)} aria-invalid={bad || undefined} aria-describedby={bad ? `${id}-e` : undefined} style={{ width: 70, minHeight: 34 }} />
                  {bad ? (
                    <span id={`${id}-e`} style={{ display: 'block', fontSize: 13 }}>
                      Whole packs, 1 to {l.left}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: 6 }}>{l.lots ? <input aria-label={`Lot number for ${l.sku}`} value={v.lot} onChange={(e) => set(l.index, 'lot', e.target.value)} style={{ width: 120, minHeight: 34 }} /> : '—'}</td>
                <td style={{ padding: 6 }}>{l.lots ? <input type="date" aria-label={`Use-by date for ${l.sku}`} value={v.expires} onChange={(e) => set(l.index, 'expires', e.target.value)} style={{ minHeight: 34 }} /> : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button type="submit" className="btn btn--style-primary btn--size-small" style={{ margin: '8px 0 0' }} disabled={busy || !entered.length || invalid.length > 0}>
        {busy ? 'Recording…' : 'Record what arrived'}
      </button>
      {result ? (
        <p role={result.ok ? 'status' : 'alert'} style={{ margin: '8px 0 0', fontWeight: 600 }}>
          {result.message}
        </p>
      ) : null}
    </form>
  )
}
