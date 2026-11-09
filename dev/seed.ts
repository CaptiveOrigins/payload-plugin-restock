import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'

import { markDelivered } from '@captiveorigins/payload-plugin-restock'

/** The try-out's only person. The app signs in as them. */
export const TRY_EMAIL = 'staff@example.com'

type Doc = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Made-up data for the try-out, written once into the throwaway database: two suppliers, four
 * supplies (two below their level), and one order whose parcel has arrived and waits for someone
 * to confirm it. Every name says "made up".
 */
export async function seed(payload: Payload) {
  if ((await payload.count({ collection: 'users' })).totalDocs > 0) return
  const make = (collection: string, data: Doc) => payload.create({ collection: collection as never, data: data as never, depth: 0 }) as Promise<Doc>

  await make('users', { email: TRY_EMAIL, name: 'Staff (made up)', password: randomBytes(24).toString('hex') })
  await make('restock-settings', {
    organizationName: 'Example Lab (made up)',
    shipTo: { name: 'Attn: Receiving', line1: '100 Example Way', city: 'Springfield', region: 'AZ', postalCode: '85000', country: 'United States' },
    contactName: 'Staff (made up)',
    contactEmail: TRY_EMAIL,
    paperSize: 'LETTER',
    terms: 'Made up. Net 30. Deliveries 9 to 4, Monday to Friday.',
  })

  const lab = await make('suppliers', {
    name: 'Example Lab Supply (made up)',
    email: 'orders@example.com',
    website: 'https://supplies.example.com',
    leadTimeDays: 3,
    orderMethod: 'quick-order',
    orderUrl: 'https://supplies.example.com/quick-order',
    quickOrderSeparator: 'comma',
    quickOrderMaxLines: 95,
  })
  const print = await make('suppliers', {
    name: 'Example Print Shop (made up)',
    email: 'print@example.com',
    leadTimeDays: 7,
    orderMethod: 'email',
    orderNotes: 'Made up: please quote our order number on the invoice.',
  })

  const inAYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10)
  // Below level: swabs and cards, so "Draft from stock levels" has something to do.
  const swab = await make('supply-items', { name: 'Swab (made up)', unit: 'each', openingStock: 40, lowStockLevel: 100, reorderQuantity: 500, supplier: lab.id })
  const tube = await make('supply-items', {
    name: 'Buffer tube (made up)',
    unit: 'each',
    openingStock: 120,
    lowStockLevel: 50,
    reorderQuantity: 200,
    supplier: lab.id,
    trackLots: true,
    shelfLifeDays: 365,
    openingLotNumber: 'MADE-UP-1',
    openingExpiresOn: inAYear,
  })
  await make('supply-items', { name: 'Return mailer (made up)', unit: 'each', openingStock: 200, lowStockLevel: 50, reorderQuantity: 200, supplier: lab.id })
  const card = await make('supply-items', { name: 'Instruction card (made up)', unit: 'each', openingStock: 20, lowStockLevel: 100, reorderQuantity: 500, supplier: print.id })

  await make('supplier-items', { supplier: lab.id, kittingItem: swab.id, sku: 'SW-500', name: 'Swabs, made up', packName: 'case of 500', packSize: 500, price: 60, productUrl: 'https://supplies.example.com/SW-500' })
  const tubes = await make('supplier-items', { supplier: lab.id, kittingItem: tube.id, sku: 'BT-100', name: 'Buffer tubes, made up', packName: 'rack of 100', packSize: 100, price: 45, productUrl: 'https://supplies.example.com/BT-100' })
  await make('supplier-items', { supplier: print.id, kittingItem: card.id, sku: 'IC-250', name: 'Instruction cards, made up', packName: 'pack of 250', packSize: 250, minimumPacks: 2, price: 18 })

  // An order that's been placed and has arrived: it waits on the "Arrived, please confirm" list.
  const order = await make('purchase-orders', { supplier: lab.id, lines: [{ item: tubes.id, packs: 2 }] })
  await payload.update({ collection: 'purchase-orders' as never, id: order.id, data: { status: 'approved' } as never })
  await payload.update({
    collection: 'purchase-orders' as never,
    id: order.id,
    data: { status: 'ordered', orderReference: 'EX-MADE-UP-1', shipments: [{ carrier: 'UPS', trackingNumber: '1ZMADEUP0001' }] } as never,
  })
  await markDelivered(payload, { trackingNumber: '1ZMADEUP0001' })
  payload.logger.info('Restock try-out: made-up data is ready. Open http://127.0.0.1:3200/admin/restock')
}
