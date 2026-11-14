# Crossing `restock-tracking`

Between Restock (`@extantape/payload-plugin-restock`) and the host app's carrier tracking. On the first site that's its EasyPost tracker webhook, owned by the site. Written 2026-11-09, before code.

## Rule

**A delivery never adds stock.** A delivered parcel only puts the order on the "Arrived, please confirm" list. Stock goes in only when a person who may receive presses "Received in full" or records what arrived, and that person is recorded.

## Restock → host: start tracking (optional)

```ts
restockPlugin({
  tracking: {
    // Called when staff add a shipment to an ordered purchase order, after the save commits.
    // Return the tracker's id so later events can find the shipment. Throwing only records a note.
    track: async ({ payload, shipment: { carrier, trackingNumber }, order: { id, number, scope } }) => ({ trackerId: 'trk_…' }),
  },
})
```

Without `tracking`, staff set a shipment to delivered by hand on the order page.

## Host → Restock: delivered

```ts
import { markDelivered } from '@extantape/payload-plugin-restock'

await markDelivered(payload, {
  trackerId: 'trk_…',            // or { carrier, trackingNumber }
  scope?: tenantId,               // when given, it must be the shipment's site, or nothing changes
  deliveredAt?: '2026-11-09T…',  // the carrier's time; default now
})
// → { status: 'delivered' | 'already' | 'not-found' | 'wrong-site', order?, number? }
```

- **Idempotent:** the same event twice is a no-op (`already`).
- **Unknown or another site's tracker:** nothing changes (`not-found` or `wrong-site`).
- **Writes:** only the shipment's status and time, an order history entry, and the optional staff email ("arrived, please confirm"). Never stock.

## The first site's wiring (the site's side)

The existing EasyPost tracker webhook (Kits PR #30) is to:
1. Create EasyPost trackers for Restock shipments through `tracking.track`.
2. On a `tracker.updated` event with status `delivered`, call `markDelivered` with the tracker id and the tenant it stored.

EasyPost's tracker fee, if any, is in Restock's README, from EasyPost's own pricing page.
