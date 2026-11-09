# Decisions

Dated decisions for this repo, newest last.

- 2026-11-09: created from the ops starter kit, area `captive-origins`.

## 2026-11-09 (owner, via the director)

- Name: **Restock** (`payload-plugin-restock`, `@captiveorigins/payload-plugin-restock`). It was first drafted as "purchasing".
- Supply ordering is semi-automatic: the plugin decides what to buy and how much, and a person checks it and makes the purchase. It never buys anything and never stores vendor credentials.
- **Tier 1 now, in this plugin:** suppliers, supplier items, purchase lists drafted from stock levels, outputs (copy for a supplier's quick-order page, CSV, a purchase-order email draft that's never sent without a person, product links) and receiving.
- **Tier 2 later:** filling a vendor's cart is the Captive Origins Console's job, in the owner's own signed-in browser, stopping at the cart, and only for vendors whose terms allow automated access. This plugin only gives it the approved orders and records "cart filled" or "cart failed".
- **Each works alone:** Restock without Kitting, Kitting without Restock, and neither needs the Console. Contract: `docs/contracts/kitting-restock.md` (crossing `kitting-restock`).
- Private until the owner says otherwise. The owner publishes the first npm version.

## 2026-11-09 (made while building; the owner can change them)

- **One supplier list.** With Kitting (or any app that already has `suppliers`), Restock adds its ordering fields to that collection instead of keeping a second list.
- **Status changes by hand:** draft ↔ approved → ordered, and cancelled from anything not yet received. Approving and marking as ordered need `approve` access. Receiving and the cart status change only through Restock's own functions.
- **Order numbers** are PO-0001, PO-0002 and so on per site, after the highest so far, with a unique index per site.
- **LICENSE** is MIT, as the brief decides and as Kitting has, while the repo stays private.
