# Purchase order JSON (`restock.purchase-order`, version 1)

`GET /api/restock/order/:id/json` returns this, for people who may read the order. The CSV, the PDF and the Console read the same document, so they never disagree. New fields may be added within version 1; anything renamed or removed bumps `version`.

| Field | Type | Meaning |
|---|---|---|
| `schema` | `"restock.purchase-order"` | What this is |
| `version` | `1` | Format version |
| `id` | string or number | The order's id in Payload |
| `number` | string | PO-0001 and so on, per site |
| `status` | string | `draft`, `approved`, `ordered`, `partly-received`, `received`, `cancelled` |
| `date` | ISO 8601 | When it was approved, otherwise when it was created |
| `currency` | ISO 4217 | For every price |
| `buyer.organization` | string or null | From the site's Restock settings |
| `buyer.shipTo`, `buyer.billTo` | string[] | Address lines, in order. `billTo` is `shipTo` unless set separately |
| `buyer.contact` | `{ name, email, phone }` | Each string or null |
| `supplier` | `{ name, email, phone, website, orderUrl }` | `website` and `orderUrl` are only http or https links, else null |
| `lines[].sku` | string | The supplier's item or model number |
| `lines[].description` | string | |
| `lines[].quantity` | number | Whole packs, in what it's sold as |
| `lines[].soldAs` | string | For example "box of 100" |
| `lines[].packSize` | number | How many are in one, in the unit it's used in |
| `lines[].unitPrice` | number or null | Price of one pack; null when unknown |
| `lines[].lineTotal` | number or null | `unitPrice × quantity`, rounded to cents |
| `lines[].receivedQuantity` | number | Packs received so far |
| `lines[].productUrl` | string or null | http or https only |
| `totals.subtotal` | number | Sum of the known line totals |
| `totals.complete` | boolean | False when any line has no price |
| `shipments[]` | `{ carrier, trackingNumber, status, deliveredAt }` | Parcels the supplier sent. `status` is `in-transit`, `delivered` or `problem`. Added 2026-11-09, within version 1 |
| `approvedBy`, `orderedBy` | string or null | The person's name, or email when there's no name |
| `supplierOrderReference` | string or null | The supplier's order number, once ordered |
| `notes` | string or null | The order's notes |
| `terms` | string or null | From the site's settings, printed at the foot |
| `paperSize` | `"LETTER"` or `"A4"` | For the PDF |
