# payload-plugin-restock

Restock for Payload: supplier lists, purchase orders and receiving, fed by your stock levels, with copy-ready orders for suppliers that have no API.

**Status:** early, 0.1.0 in progress, not on npm. Built so far: suppliers, supplier items and purchase orders with their life cycle, access and site isolation. 4 tests pass against a real MongoDB (in memory, single-node replica set) on Payload 3.92. Not built yet: drafting orders from stock levels, the copy-ready outputs, receiving and the Console API. Nothing has been tried in a browser yet.

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
- **Access:** `manage` drafts and receives, `approve` approves and marks orders as ordered, and `read` sees them. With `scopeField`, everything stays inside one site. An order can't use another supplier's items, and nothing links across sites.

## Install

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
