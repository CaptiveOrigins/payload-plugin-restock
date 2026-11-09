# payload-plugin-restock

Restock for Payload: supplier lists, purchase orders and receiving, fed by your stock levels, with copy-ready orders for suppliers that have no API.

**Status:** early, 0.1.0, not on npm. Built: suppliers, supplier items, purchase orders with their life cycle, access and site isolation, and drafting orders from stock levels (with Kitting 0.1.0 from npm, or your own needs). 14 tests pass against a real MongoDB (in memory, single-node replica set) on Payload 3.92. On 2026-11-09 the order page was opened in a local dev server of the Captive Origins platform with made-up data, and no server errors were logged. The place-this-order panel showed quick-order lines, the CSV and email buttons, and links. The receive form recorded 2 packs with a lot number from the keyboard alone, and the stock and lot appeared in Kitting. Not checked yet: a screen reader, or copying to the clipboard in a normal browser (the in-app browser used blocks it, and the button says so).

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
  - **Download CSV:** item number, description, quantity, what it's sold as, price and line total. Cells a spreadsheet could run as a formula are defused.
  - **Email draft:** opens in your email app with the order filled in. Nothing is sent until you send it.
  - **Links:** to their order page and to each product page (http and https only).
- **Receiving** (on an ordered order's page, `receiveOrder(payload, id, lines)` and `POST /api/restock/receive`): what arrived, in whole packs per line, with a lot number and use-by date where the supply tracks lots.
  - **More than ordered** is refused.
  - **Status:** the order becomes partly received or received, with who and when in its history.
  - **With Kitting:** each line linked to a supply adds stock through Kitting's own movements, converted from packs to the supply's unit and referenced with the order number. So Kitting's access check, lots and alerts all apply.
  - **All or nothing:** a receipt that's refused writes nothing.
- **For a cart helper** (the Captive Origins Console later, or your own): `GET /api/restock/cart/orders?scope=` lists approved orders with their quick-order lines and links, and `POST /api/restock/cart { order, status: 'filled' | 'failed', note }` records whether the cart was filled. A failure needs a reason. Both are for people with `approve` access, only for approved orders, and nothing else on the order can change through them. Restock still never places an order: a person checks the cart and checks out.
- **Access:** `manage` drafts and receives, `approve` approves and marks orders as ordered, and `read` sees them. With `scopeField`, everything stays inside one site. An order can't use another supplier's items, and nothing links across sites.

## Install

Run `payload generate:importmap` after adding it: the order page has a component.



```ts
import { restockPlugin } from '@captiveorigins/payload-plugin-restock'

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

```bash
npm install
npm test            # Vitest with an in-memory MongoDB replica set
npm run typecheck
npm run build
npm run leak-check
```

## License

MIT. See [LICENSE](LICENSE).
