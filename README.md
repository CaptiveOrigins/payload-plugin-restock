# payload-plugin-restock

Restock for Payload: supplier lists, purchase orders and receiving, fed by your stock levels, with copy-ready orders for suppliers that have no API.

**Status:** early. 0.1.0 is on npm (2026-11-10). 26 tests pass (24 against a real MongoDB (in memory, single-node replica set) on Payload 3.92, with Kitting 0.2.0 from npm, and once with Kitting's 0.1 behavior (no `restockNeeds`), and 2 more on the access rules and the admin view's access, with fakes). They cover suppliers, supplier items and purchase orders, the order life cycle and who may move it, site isolation, drafting from stock levels, receiving into Kitting, shipments and marking them delivered, and the CSV, JSON and PDF exports. On 2026-11-09 a session also checked it in a browser, on a local copy of a real site with made-up suppliers, using the keyboard. It checked the place-this-order panel, receiving with a lot number, the Arrived list and confirming a delivery. No errors were logged. Not checked yet: a screen reader, copying to the clipboard in a normal browser, a real supplier order, and use by anyone outside these tests. Kitting's "Today" line shows arrivals from Kitting 0.2 on; to staff limited to some sites, from the next Kitting and Restock releases on, since it needs the order's site that `arrived` now returns.

Restock never buys anything and never stores passwords or card numbers. It drafts; a person checks, approves and places the order.

## What it does

- **Suppliers:** name, order email, phone, website, usual days to deliver, how they take orders (quick-order page, CSV, email, their website, phone), the order page, a minimum order value, and ordering notes. If your app already has a `suppliers` collection (Kitting adds one), Restock adds these fields to it instead of making a second list.
- **Supplier items** (`supplier-items`): the supplier's item or model number, a description, what it's sold as ("box of 100") and how many are in one, the minimum order in packs, the price and the date it was seen, and the product page. With Kitting, each can be linked to the supply it restocks.
- **Purchase orders** (`purchase-orders`): one supplier, with lines of items and packs. They're numbered PO-0001, PO-0002 and so on per site.
  - **Totals:** prices are copied from the item when a line is added, and the estimated total says whether every line has a price.
  - **Life cycle:** draft, then approved, then ordered (with who, when and the supplier's order number), then partly received or received. Cancelled is possible until it's received.
  - **By hand:** a draft can be approved or cancelled, an approved order sent back to draft, ordered or cancelled, and an ordered one cancelled. Receiving moves it on.
  - **Locked after the draft:** lines can only change while it's a draft.
  - **History:** every status change is kept, with who, when and an optional note.
  - **Deleting:** only drafts can be deleted. Anything further is cancelled instead, so its history stays.
- **Drafting** (`draftOrders(payload, { scope })`, or `POST /api/restock/draft` for people who manage that site): one draft per supplier.
  - **What to buy:** with Kitting, from what it says to buy. Without it, from your own `needs` function.
  - **Which item:** a supply's preferred supplier item, the cheapest per unit if there are several.
  - **How many:** rounded up to whole packs and the minimum, after taking off what's already on approved or ordered orders. Each line says why, for example "below its level (40 of 100 each); 500 each in packs of 200".
  - **Existing drafts:** an open draft only gets lines for new items; it's never overwritten.
  - **Left over:** supplies with nothing to buy them from are listed, so you can add a supplier item.
  - **Never further:** nothing is approved or ordered by Restock.
- **Placing an order** (on each purchase order's page, and `orderOutputs(payload, id)`). Restock never places it: you do, with one of these.
  - **Copy for Quick Order:** one "ITEM, QUANTITY" line per item (or with a space or tab), as the supplier's quick-order page asks, with a warning when there are more lines than it takes at a time. ULINE's page takes a comma or a space, and its cart holds 95 items.
  - **Download PDF:** a proper purchase order, with the site's organization name, the order number and date, the supplier, ship to and bill to (from the site's Restock settings, never hard-coded), the lines, the total, notes, the contact, who approved it and the site's terms.
    - Real text, tagged for screen readers (headings, a table with header cells, the language and title).
    - Page numbers on long orders, sized for US Letter or A4.
    - Made with PDFKit's built-in Helvetica, so there are no font files to manage.
  - **Download CSV:** one line per item: supplier item number, description, quantity, what it's sold as, pack size, unit price and line total. It opens cleanly in Excel and Numbers (UTF-8 with a byte-order mark), and cells a spreadsheet could run as a formula are defused.
  - **Download JSON:** the whole order, in a stable, documented format ([docs/purchase-order-json.md](docs/purchase-order-json.md)). It's also what a cart helper reads.
  - All three come from `GET /api/restock/order/:id/pdf` (or `/csv`, `/json`), for people who may read the order.
  - **Email draft:** opens in your email app with the order filled in. Nothing is sent until you send it.
  - **Links:** to their order page and to each product page (http and https only).
- **Receiving** (on an ordered order's page, `receiveOrder(payload, id, lines)` and `POST /api/restock/receive`): what arrived, in whole packs per line, with a lot number and use-by date where the supply tracks lots.
  - **More than ordered** is refused.
  - **Status:** the order becomes partly received or received, with who and when in its history.
  - **With Kitting:** each line linked to a supply adds stock through Kitting's own movements, converted from packs to the supply's unit and referenced with the order number. So Kitting's access check, lots and alerts all apply.
  - **All or nothing:** a receipt that's refused writes nothing.
- **Shipments and arrivals.** Once an order is placed, staff add its tracking numbers, one per parcel (a supplier may split an order). They show on the order page, the PDF and the JSON.
  - **Tracking:** with `tracking: { track }`, Restock asks your tracking service to follow each new number. When it says delivered, your app calls `markDelivered(payload, { trackerId, scope })`. Without a service, staff mark a parcel delivered by hand.
  - **A delivery never adds stock.** It puts the order on **Arrived, please confirm**, on the Restock overview (`/admin/restock`) and at the top of Kitting's Today. With `notify`, staff get one email per delivered parcel.
  - **For other plugins:** `config.custom.restock.arrived({ payload, user?, scope? })` lists those orders as `{ id, number, supplier, deliveredAt, scope }`. `scope` is the order's site, the ID in `scopeField` (`null` without one), so Kitting can show staff limited to some sites only their own sites' deliveries. With `user`, only orders that person may receive are listed.
  - **Confirming:** on the order, **"Yes, I received this package: add the supplies"** adds exactly what's still to come, in one click. **"Something's missing or damaged"** opens the receive form, filled in, with a note. Supplies with lots (reagents) go straight to the form: the lot number and use-by are required, and Restock never makes them up.
  - **Safety:** only people who may receive see these controls. Every receipt is recorded with who confirmed it. The same delivered event twice changes nothing, and a tracker from another site is refused.
  - **Cost:** EasyPost lists its Tracking API at "$0.01–$0.03 per shipment" on its pricing page, and says trackers for labels bought through EasyPost are free. It doesn't publish a price for a tracker on a label bought elsewhere, such as a supplier's UPS number. Check with EasyPost or on your EasyPost bill before relying on a figure (checked 2026-11-09).
- **For a cart helper** (a console app later, or your own): `GET /api/restock/cart/orders?scope=` lists approved orders with their quick-order lines and links, and `POST /api/restock/cart { order, status: 'filled' | 'failed', note }` records whether the cart was filled. A failure needs a reason. Both are for people with `approve` access, only for approved orders, and nothing else on the order can change through them. Restock still never places an order: a person checks the cart and checks out.
- **Restock settings** (`restock-settings`, one per site): the organization name, ship-to and bill-to addresses, a contact, the paper size, and terms printed at the foot of every order.
- **Access:** `manage` drafts and receives, `approve` approves and marks orders as ordered, and `read` sees them. With `scopeField`, everything stays inside one site. An order can't use another supplier's items, and nothing links across sites.
  - **Only `true` or a query counts.** Each of the three must answer exactly `true`, or a query (`{ tenant: { in: [...] } }`), which is then applied to the order. Anything else is a no: `1`, `'yes'`, an empty or malformed query (`{ tenant: false }`), a query on a field orders don't have, or an error thrown. The endpoints answer 403, never 500, and the `/admin/restock` page reads nothing for that person.

## On its own, and with others

**On its own:** Restock needs only Payload. It makes its own suppliers list, and drafts orders from a `needs` function you give it. Receiving then moves the order along and keeps its history, but adds stock nowhere, since there's no stock to add to. Run `payload generate:importmap` for the order page.

**Works with:**
- **Kitting:** with Kitting before it in `plugins`, Restock adds its fields to Kitting's suppliers, drafts from Kitting's `restockNeeds`, and receives into Kitting's stock log, lots and alerts. It finds Kitting through `config.custom.kitting`, and the contract is in [docs/contracts/kitting-restock.md](docs/contracts/kitting-restock.md).
- **Labels** (designed, not built): Labels plans a receiving label for each received order, offered through `config.custom.labels.providers`.

Carrier tracking comes from your own code through `tracking.track` and `markDelivered` ([docs/contracts/restock-tracking.md](docs/contracts/restock-tracking.md)), not from another plugin.

**Family:** Restock sits in the Fulfillment family, with Kitting, Sample Kits, Shipping, Scan, Labels, Wizards, Custody and Sequences, though the families are a working draft and Fulfillment is due to be split into different groups.

## Install

Run `payload generate:importmap` after adding it: the order page has a component.



```ts
import { restockPlugin } from '@extantape/payload-plugin-restock'

export default buildConfig({
  plugins: [
    // kittingPlugin({ … }),   // optional; put it before Restock
    restockPlugin({
      access: { manage: isStaff, approve: isBuyer, read: isStaff },
    }),
  ],
})
```

## Commands

`npm run dev` starts a small local app with Restock and Kitting on a throwaway in-memory database, filled with made-up suppliers and supplies. It signs you in as made-up staff, listens on this computer only, and deletes everything when you press Ctrl+C. Nothing is ever sent: emails are written to the terminal.

```bash
npm install
npm run dev          # try it: http://127.0.0.1:3200/admin/restock, made-up data, deleted on Ctrl+C
npm test            # Vitest with an in-memory MongoDB replica set
npm run typecheck
npm run build
npm run leak-check
```

## License

MIT. See [LICENSE](LICENSE).
