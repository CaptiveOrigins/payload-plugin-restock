import { describe, expect, it } from 'vitest'

import { packsFor, pickItem } from '../src/index.js'

describe('rounding to packs', () => {
  it('rounds up to whole packs, then to the minimum', () => {
    expect(packsFor(500, 200)).toBe(3)
    expect(packsFor(400, 200)).toBe(2)
    expect(packsFor(401, 200)).toBe(3)
    expect(packsFor(40, 25, 4)).toBe(4)
    expect(packsFor(0.3, 0.1)).toBe(3) // no floating-point dust: 0.3 / 0.1 is 2.9999…
    expect(packsFor(0, 10)).toBe(0)
    expect(packsFor(5, 0)).toBe(0)
  })
})

describe('choosing a supplier item', () => {
  it('prefers preferred items, then the cheapest per unit, and skips ones no longer sold', () => {
    const items = [
      { id: 'a', price: 30, packSize: 200 }, // 0.15 each
      { id: 'b', price: 10, packSize: 100 }, // 0.10 each
      { id: 'c', price: 1, packSize: 100, active: false },
      { id: 'd', price: 2, packSize: 100, preferred: false },
      { id: 'e', packSize: 100 }, // no price: last
    ]
    expect(pickItem(items)?.id).toBe('b')
    expect(pickItem([{ id: 'x', preferred: false, price: 5 }, { id: 'y', preferred: false, price: 4 }])?.id).toBe('y')
    expect(pickItem([{ id: 'c', active: false }])).toBeNull()
  })
})

describe('the purchase-order PDF', () => {
  it('runs onto more pages on Letter, numbering each one, with every line in the text', async () => {
    const { purchaseOrderPDF } = await import('../src/pdf.js')
    const lines = Array.from({ length: 60 }, (_, i) => ({
      sku: `X-${String(i + 1).padStart(3, '0')}`,
      description: `Made-up item ${i + 1}, with a description long enough to wrap onto a second line in the table`,
      quantity: i + 1,
      soldAs: 'box of 10',
      packSize: 10,
      unitPrice: 2.5,
      lineTotal: 2.5 * (i + 1),
      receivedQuantity: 0,
      productUrl: null,
    }))
    const d = {
      schema: 'restock.purchase-order', version: 1, id: '1', number: 'PO-0042', status: 'approved', date: '2026-11-09T00:00:00.000Z', currency: 'USD',
      buyer: { organization: 'Example Organization', shipTo: ['1 Example Way'], billTo: ['1 Example Way'], contact: { name: null, email: null, phone: null } },
      supplier: { name: 'Example Supply', email: null, phone: null, website: null, orderUrl: null },
      lines, totals: { subtotal: 4575, complete: true }, shipments: [{ carrier: 'UPS', trackingNumber: '1ZEXAMPLE', status: 'delivered', deliveredAt: '2026-11-09T12:00:00.000Z' }], approvedBy: 'A. Buyer', orderedBy: null, supplierOrderReference: null, notes: null, terms: null, paperSize: 'LETTER',
    } as const
    const bytes = new Uint8Array(await purchaseOrderPDF(d as never))
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: bytes }).promise
    expect(pdf.numPages).toBeGreaterThan(1)
    let all = ''
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p)
      expect(Math.round(page.view[2]!)).toBe(612) // US Letter width
      const text = (await page.getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ')
      expect(text).toContain(`page ${p} of ${pdf.numPages}`)
      all += text
    }
    for (const l of lines) expect(all).toContain(l.sku)
    expect(all).toContain('$4,575.00')
    expect(all).toContain('UPS 1ZEXAMPLE (delivered November 9, 2026)')
  })
})

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks, and defuses cells a spreadsheet would run', async () => {
    const { csvField } = await import('../src/index.js')
    expect(csvField('plain')).toBe('plain')
    expect(csvField('Box, "small"')).toBe('"Box, ""small"""')
    expect(csvField('two\nlines')).toBe('"two\nlines"')
    for (const risky of ['=CMD()', '+1', '-1+1', '@SUM(A1)']) expect(csvField(risky).startsWith("'")).toBe(true)
    expect(csvField(null)).toBe('')
    expect(csvField(18.4)).toBe('18.4')
  })
})

describe('works without Kitting', () => {
  it('depends on no other Captive Origins package; Kitting is an optional peer, reached only by a guarded dynamic import', async () => {
    const { readFile, readdir } = await import('node:fs/promises')
    const root = new URL('../', import.meta.url)
    const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
    const ours = (deps: Record<string, string> = {}) => Object.keys(deps).filter((d) => d.startsWith('@captiveorigins/'))
    expect(ours(pkg.dependencies)).toEqual([])
    expect(ours(pkg.peerDependencies)).toEqual(['@captiveorigins/payload-plugin-kitting'])
    expect(pkg.peerDependenciesMeta['@captiveorigins/payload-plugin-kitting']).toEqual({ optional: true })
    // A static import of Kitting would crash a host that doesn't install it. Restock's own admin paths are fine.
    const files = (await readdir(new URL('src/', root), { recursive: true })).filter((f) => /\.tsx?$/.test(f))
    const uses: string[] = []
    for (const f of files) {
      const text = await readFile(new URL(`src/${f}`, root), 'utf8')
      for (const m of text.matchAll(/^.*@captiveorigins\/(?!payload-plugin-restock\/).*$/gm)) uses.push(`${f}: ${m[0].trim()}`)
    }
    expect(uses).toHaveLength(1)
    expect(uses[0]).toMatch(/^draft\.ts: const kitting = \(await import\('@captiveorigins\/payload-plugin-kitting'\)\.catch\(\(\) => null\)\)/)
  })
})
