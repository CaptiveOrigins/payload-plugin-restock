'use client'

import React, { useId, useState } from 'react'

/** A read-only box with a Copy button that says when it's copied. */
export function CopyBox({ label, text, rows = 6, help }: { label: string; text: string; rows?: number; help?: string }) {
  const id = useId()
  const [status, setStatus] = useState('')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied.')
      return
    } catch {
      // Some browsers and embedded views block the clipboard API; the older way often still works.
    }
    const box = document.getElementById(id) as HTMLTextAreaElement | null
    box?.select()
    const ok = box ? document.execCommand('copy') : false
    setStatus(ok ? 'Copied.' : 'Couldn’t copy. The text is selected: press Cmd+C (or Ctrl+C).')
  }
  return (
    <div style={{ marginBottom: 'var(--base)' }}>
      <label htmlFor={id} style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
        {label}
      </label>
      {help ? <p style={{ margin: '0 0 4px', fontSize: 13 }}>{help}</p> : null}
      <textarea id={id} readOnly value={text} rows={rows} style={{ width: '100%', fontFamily: 'monospace', fontSize: 14 }} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" className="btn btn--style-secondary btn--size-small" style={{ margin: '4px 8px 0 0' }} onClick={copy}>
        Copy
      </button>
      <span role="status" style={{ fontSize: 13 }}>
        {status}
      </span>
    </div>
  )
}
