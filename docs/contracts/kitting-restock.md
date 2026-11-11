# Crossing `kitting-restock`

Between Kitting (`@captiveorigins/payload-plugin-kitting`) and Restock (`@captiveorigins/payload-plugin-restock`). Both plugins are led by the same session, so the contract is written here before code lands on either side (2026-11-09).

## Rules

- **Each works alone.** Restock never requires Kitting: it's an optional peer dependency, loaded only when `payload.config.custom.kitting` exists. Kitting never imports Restock.
- **Restock never writes to Kitting's records directly,** only through Kitting's own paths. Kitting's hooks keep stock, lots, shrinkage and alerts consistent.
- **Same site.** Every call carries the scope (tenant), and Kitting refuses a supply from another site.

## Kitting → Restock: what to buy

A new Kitting export (0.2.x):

```ts
restockNeeds(payload, { scope?, req? }): Promise<RestockNeed[]>

type RestockNeed = {
  item: ID            // a Kitting supply
  name: string
  unit: string        // the supply's own unit (g, ml, each…)
  onHand: number
  usable: number      // on hand minus expired lots
  lowStockLevel: number | null
  reorderQuantity: number | null
  /** What Kitting suggests buying, in the supply's unit: the larger of
   *  (a) its reorder suggestion when below level, and
   *  (b) what's needed to build every recipe up to its number to keep, minus usable stock. */
  suggested: number
  why: string         // plain words, e.g. "below its level (40 of 50)" or "18 kits to build need 36"
  supplier: ID | null // Kitting's supplier, for matching
}
```

Only supplies with `suggested > 0` and not retired are returned.

## Restock → Kitting: receiving

Restock receives through Kitting's movements collection, in the caller's transaction:

```ts
payload.create({ collection: <kitting movements slug>, data: {
  item,                 // the Kitting supply linked to the supplier item
  kind: 'received',
  quantity, unit,       // in the supplier's pack, e.g. 2 × "box of 100"; Kitting converts
  lotNumber?, expiresOn?,
  reference,            // the purchase order number
  reason: 'Received on PO …',
}, req })
```

The supply's packs must include the supplier's pack name. Otherwise Restock converts to the supply's unit itself, using the supplier item's pack size, and sends that.

## Restock → Kitting: arrivals waiting to be confirmed

Restock puts a function on `payload.config.custom.restock`, and Kitting's `restockArrivals` calls it for the Today line:

```ts
arrived({ payload, user?, scope? }): Promise<{
  id: ID
  number: string
  supplier: string             // the supplier's name
  deliveredAt: string | null   // the latest delivered parcel
  scope: ID | null             // the order's site (its scopeField value); null without a scopeField (added 2026-11-11)
}[]>
```

With `user`, only orders that person may receive. Kitting shows the whole list to someone whose `manage` answers exactly `true`. For a query that only names sites (the scope field with `equals` or `in`, alone or under `and`/`or`), it keeps the orders whose `scope` is one of them. For any other answer, a query it can't read that way included, it shows nothing and doesn't call `arrived`. An order without a `scope`, from an older Restock, is never shown to site-limited staff.

## Linking

A Restock supplier item has an optional `kittingItem` relationship to Kitting's supplies collection, added only when Kitting is installed. A supply can have several supplier items, one per supplier.
