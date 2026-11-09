import PDFDocument from 'pdfkit'

import { longDate, money, type PurchaseOrderDocument } from './document.js'

type PDF = any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A purchase order as a tagged PDF: real text (not an image), a structure tree (headings,
 * paragraphs, a table with header cells) for screen readers, the document language and title, and
 * margins that print on both US Letter and A4. Uses the built-in Helvetica, so no font files.
 */
export async function purchaseOrderPDF(d: PurchaseOrderDocument): Promise<Buffer> {
  const title = `Purchase order ${d.number}${d.buyer.organization ? `, ${d.buyer.organization}` : ''}`
  const doc: PDF = new PDFDocument({
    size: d.paperSize,
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    pdfVersion: '1.7',
    tagged: true,
    lang: 'en-US',
    displayTitle: true,
    info: { Title: title, Subject: `Purchase order to ${d.supplier.name}`, Creator: 'Restock for Payload' },
    bufferPages: true,
  })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const root = doc.struct('Document')
  doc.addStructure(root)
  const left = doc.page.margins.left
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right
  const ink = '#111111'
  const grey = '#555555'
  const para = (text: string, opts: Doc = {}, tag = 'P') => root.add(doc.struct(tag, () => doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size ?? 10).fillColor(opts.color ?? ink).text(text, opts.x ?? left, opts.y, { width: opts.width ?? width, align: opts.align ?? 'left' })))
  type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  const rule = (y: number) => doc.markContent('Artifact', { type: 'Layout' }) && doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.5).strokeColor('#999999').stroke() && doc.endMarkedContent()

  // Heading block.
  if (d.buyer.organization) para(d.buyer.organization, { bold: true, size: 16 }, 'P')
  para(`Purchase order ${d.number}`, { bold: true, size: 20 }, 'H1')
  para(`Date: ${longDate(d.date)}${d.supplierOrderReference ? `    Supplier’s order number: ${d.supplierOrderReference}` : ''}`, { color: grey })
  doc.moveDown(0.8)

  // Supplier, ship to, bill to: three columns.
  const top = doc.y
  const colW = (width - 24) / 3
  const block = (heading: string, lines: string[], i: number) => {
    const x = left + i * (colW + 12)
    root.add(doc.struct('H2', () => doc.font('Helvetica-Bold').fontSize(10).fillColor(ink).text(heading, x, top, { width: colW })))
    root.add(doc.struct('P', () => doc.font('Helvetica').fontSize(10).fillColor(ink).text(lines.length ? lines.join('\n') : '—', x, doc.y + 2, { width: colW })))
    return doc.y
  }
  const supplierLines = [d.supplier.name, d.supplier.email, d.supplier.phone, d.supplier.website].filter((x): x is string => Boolean(x))
  const bottoms = [block('Supplier', supplierLines, 0), block('Ship to', d.buyer.shipTo, 1), block('Bill to', d.buyer.billTo, 2)]
  doc.y = Math.max(...bottoms) + 18

  // Lines: a real table, with header cells.
  const cols = [
    { head: 'Item number', w: 0.17, align: 'left' },
    { head: 'Description', w: 0.33, align: 'left' },
    { head: 'Qty', w: 0.08, align: 'right' },
    { head: 'Sold as', w: 0.16, align: 'left' },
    { head: 'Unit price', w: 0.12, align: 'right' },
    { head: 'Line total', w: 0.14, align: 'right' },
  ] as const
  const xs = cols.reduce<number[]>((a, c, i) => [...a, i === 0 ? left : a[i - 1]! + cols[i - 1]!.w * width], [])
  const table = doc.struct('Table')
  root.add(table)
  const row = (cells: string[], header: boolean) => {
    const heights = cells.map((c, i) => doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).heightOfString(c, { width: cols[i]!.w * width - 6 }))
    const h = Math.max(...heights) + 6
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 60) doc.addPage()
    const y = doc.y
    const tr = doc.struct('TR')
    table.add(tr)
    cells.forEach((c, i) => {
      tr.add(
        doc.struct(header ? 'TH' : 'TD', () =>
          doc
            .font(header ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9.5)
            .fillColor(ink)
            .text(c, xs[i]! + 3, y + 3, { width: cols[i]!.w * width - 6, align: cols[i]!.align }),
        ),
      )
    })
    tr.end()
    doc.y = y + h
    rule(doc.y)
  }
  rule(doc.y)
  row(
    cols.map((c) => c.head),
    true,
  )
  for (const l of d.lines) row([l.sku, l.description, String(l.quantity), l.packSize !== 1 && !l.soldAs.includes(String(l.packSize)) ? `${l.soldAs} (${l.packSize})` : l.soldAs, money(l.unitPrice, d.currency), money(l.lineTotal, d.currency)], false)
  table.end()

  doc.moveDown(0.6)
  para(`Total: ${money(d.totals.subtotal, d.currency)}${d.totals.complete ? '' : ' (some prices to be confirmed)'}`, { bold: true, size: 11, align: 'right' })
  doc.moveDown(0.6)
  if (d.shipments.length)
    para(
      `Shipments: ${d.shipments.map((sh) => `${sh.carrier ? `${sh.carrier} ` : ''}${sh.trackingNumber} (${sh.status === 'delivered' ? `delivered${sh.deliveredAt ? ` ${longDate(sh.deliveredAt)}` : ''}` : sh.status === 'problem' ? 'problem' : 'on its way'})`).join('; ')}`,
    )
  if (d.notes) para(`Notes: ${d.notes}`)
  if (d.buyer.contact.name || d.buyer.contact.email || d.buyer.contact.phone)
    para(`Contact: ${[d.buyer.contact.name, d.buyer.contact.email, d.buyer.contact.phone].filter(Boolean).join(', ')}`)
  if (d.approvedBy) para(`Approved by ${d.approvedBy}`)
  if (d.terms) {
    doc.moveDown(0.6)
    para(d.terms, { color: grey, size: 9 })
  }

  // Page numbers, as layout artifacts so screen readers skip them.
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // Writing below the bottom margin would start a new page: lift the margin for the footer.
    const bottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    doc.markContent('Artifact', { type: 'Pagination' })
    doc.font('Helvetica').fontSize(8).fillColor(grey).text(`${d.number}  ·  page ${i + 1} of ${range.count}`, left, doc.page.height - 36, { width, align: 'center', lineBreak: false })
    doc.endMarkedContent()
    doc.page.margins.bottom = bottom
  }
  root.end()
  doc.end()
  return done
}
