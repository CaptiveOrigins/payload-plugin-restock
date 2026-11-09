# Test audit

Each audit maps what Restock promises (README, `docs/decisions.md`, the brief) to the tests that prove it. Rule: `~/Code/CLAUDE.md`, "Test self-audits".

## 2026-11-09, day one (step 1: data model)

4 tests, against an in-memory MongoDB replica set.

| Promise | Test |
|---|---|
| Orders are numbered per site, prices are copied, the total says whether it's complete, and every change is in the history | purchase orders: numbers orders per site… |
| **Life cycle**: draft → approved → ordered by hand, nothing else by hand. Lines are frozen after the draft. Only drafts can be deleted; cancelling keeps the history | purchase orders: moves draft → approved → ordered… |
| **Access**: staff draft, only buyers approve or mark as ordered, viewers only read, nobody reads without signing in | moves draft → approved…; keeps each site's suppliers… |
| **Site isolation**: suppliers, items and orders stay in their site. Nothing links across sites, and an order can't use another supplier's items | refuses lines from another supplier or site…; keeps each site's suppliers… |
| Whole packs only | refuses lines… |

Gaps, planned with the steps that build them: drafting and rounding (step 2), outputs (step 3), receiving into Kitting (step 4), and the Console API's access (step 5). Shared suppliers with Kitting get a test with step 4.

## 2026-11-09, step 2 (drafting)

10 tests. Added:
- **Rounding to packs:** whole packs, minimums, and no floating-point dust. Tested as pure functions with known values.
- **Choosing the item:** preferred first, then the cheapest per unit; items no longer sold are skipped. Pure.
- **With Kitting** (0.1.0 from npm):
  - Restock shares Kitting's supplier list.
  - It drafts one order per supplier from what's below level, in whole packs and minimums.
  - Supplies without a supplier item are listed.
  - Another site's needs never show up.
  - Drafting twice adds nothing.
  - What's already on an approved order counts as on order.
- **Without Kitting:** drafting from the host's own needs, at least the minimum. A site is required.
- **Access:** `POST /api/restock/draft` refuses people who are signed out, viewers, and another site's staff.

Not covered yet: Kitting's `restockNeeds` (ready-stock targets). It arrives in Kitting 0.2.x, and the test moves to it when that's on npm.

## 2026-11-09, step 3 (outputs)

11 tests. Added "ways to place an order":
- quick-order lines with a comma and with a space, and the line-limit warning;
- CSV quoting, plus a defused formula cell (security: a CSV opened in a spreadsheet can't run what a supplier item says);
- the email draft's text, recipient and mailto;
- product links, with a `javascript:` link refused.

The order page's panel hasn't been opened in a browser yet. That's planned with receiving (step 4).

## 2026-11-09, step 4 (receiving)

13 tests. Added:
- **Receiving into Kitting** (0.1.0 from npm):
  - stock arrives through Kitting's movements, with the lot and use-by date;
  - packs are converted to the supply's unit, and the reference carries the order numbers;
  - more than ordered is refused and writes nothing;
  - the order goes partly received, then received, with history;
  - an order that isn't ordered can't be received.
- **Receiving without Kitting:** `POST /api/restock/receive` refuses people who are signed out, viewers, and another site's staff. It refuses part packs, and records who received it and a note.

Kitting's `restockNeeds` is tested in Kitting itself (its PR #2). Restock's tests still use Kitting 0.1.0's below-level fallback until 0.2.0 is on npm.

## 2026-11-09, browser check of the order page

In a local dev server of the platform with Restock installed temporarily and made-up data. **Found and fixed:** the receive form was a `<form>` inside Payload's own edit form. That's invalid HTML: it caused a hydration error, and pressing Enter could have submitted Payload's form instead of recording the receipt. It's now a group with its own button and Enter handling. After the fix: no hydration error, and receiving 2 packs with a lot from the keyboard recorded the stock and lot in Kitting. Also: order lines show read-only once past the draft, and Copy falls back to the older copy command where the clipboard API is blocked. Rendering the panel isn't covered by unit tests (it needs the full admin), as for Kitting's pages.

## 2026-11-09, step 5 (cart API for the Console)

14 tests. Added "the Console's cart API":
- signed out, manage-only staff and another site's staff are refused;
- only approved orders are listed;
- a failed cart needs a reason, an unknown status is refused, and a draft can't go to a cart;
- the cart status records with a history entry, and the lines and status stay untouched;
- an ordinary save can't change the cart status.

## 2026-11-09, exports (CSV, JSON, PDF; owner's request)

17 tests. Added:
- **Exports:** one document feeds the JSON, CSV and PDF.
  - The site's own buyer details are used, and the settings are one per site.
  - The JSON matches its documented format.
  - The CSV has a byte-order mark and the right columns.
  - The PDF is tagged (structure tree, marked content, language, title, table header cells) and A4 when set.
  - Its extracted text holds the organization, number, supplier, address, lines, total, "to be confirmed", the approver and the terms.
  - Access: signed out and another site refused, a viewer allowed, an unknown format refused.
- **The PDF on Letter:** a 60-line order runs onto more pages, each numbered "page n of N", and every line's text is present.
- **CSV cells:** quoting and defused formula cells (pure).

Checked by eye: a sample PDF, which looked right (layout, table and totals). Not checked: a screen reader on the PDF, or printing on paper. The fonts aren't embedded (Helvetica is a standard PDF font), so it isn't strict PDF/UA.

## 2026-11-09, shipments and "Arrived, please confirm" (owner's request)

20 tests. Added:
- **A delivered event never changes stock.** Stock, lines and the total stay the same, and the order stays ordered.
- **Idempotent:** the same event twice is `already`.
- **Another site's tracker is refused** (`wrong-site`), and an unknown one is `not-found`.
- **One email per parcel.** Shipments can't be added before the order is placed, and a tracker id can't be typed in.
- **"Received in full"** adds exactly what's still to come, once.
- **Lots:** a lot number, and a use-by unless the supply has a shelf life, are required where lots are tracked. Missing items go to a partial receipt with a note.
- **Access:** marking delivered by hand, the arrivals list and one-click receipt refuse viewers and another site's staff. The receipt records who confirmed it.

Not rendered in tests: the confirm panel, the Restock overview and Kitting's Today line. They need the full admin; a browser check is planned before release.
