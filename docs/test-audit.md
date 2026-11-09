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
