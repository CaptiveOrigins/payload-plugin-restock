'use client'

import React, { useState } from 'react'

/** Draft orders from what's needed. Nothing is approved or bought. */
export function DraftButton({ scope, label, apiRoute }: { scope: string | null; label: string; apiRoute: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const run = async () => {
    setBusy(true)
    setMessage('')
    try {
      const res = await fetch(`${apiRoute}/restock/draft`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) setMessage(d.message ?? 'Couldn’t draft orders.')
      else {
        const made = (d.created?.length ?? 0) + (d.added?.length ?? 0)
        setMessage(
          [
            made ? `${d.created?.length ?? 0} new draft${d.created?.length === 1 ? '' : 's'}, ${d.added?.length ?? 0} added to.` : 'Nothing new to order.',
            d.unmatched?.length ? `No supplier item for: ${d.unmatched.map((u: { name: string }) => u.name).join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' ') + (made ? ' Reloading…' : ''),
        )
        if (made) setTimeout(() => window.location.reload(), 1200)
      }
    } catch {
      setMessage('Couldn’t reach the server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <span>
      <button type="button" className="btn btn--style-primary btn--size-small" style={{ margin: '0 8px 0 0' }} disabled={busy} onClick={() => void run()}>
        {busy ? 'Drafting…' : label}
      </button>
      <span role="status" style={{ fontSize: 13 }}>
        {message}
      </span>
    </span>
  )
}
