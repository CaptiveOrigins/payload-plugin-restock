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

Not rendered in tests: the confirm panel, the Restock overview and Kitting's Today line, which need the full admin. They were checked in a browser on a throwaway platform copy with made-up data, with no console or server errors:
- the overview's Arrived list and Kitting's Today line;
- "Yes, I received this package" from the keyboard, which added exactly 2 cases of 500 swabs;
- on a lot-tracked order, a prefilled form with no one-click button, where Record stayed disabled until a lot number was given and then recorded the lot. Its use-by came from the supply's shelf life.

## 2026-11-10, after the MIT prep and the try-out app

22 tests. Since the last audit: the license and release files, Kitting as an optional peer from 0.1.0, and the local try-out app (`npm run dev`).

### Gap added (2 tests, 1 fix)

- **The try-out app's database guard.** The app signs anyone in, so it must refuse any database except the throwaway one `npm run dev` starts. The old check only looked at how the URL began, so `mongodb://127.0.0.1:x@example.com/` passed: that's a user name and password for another host. A second host after a comma passed too. It's now `isThrowawayDatabase` (`dev/local-only.ts`), a strict match: one MongoDB on 127.0.0.1, a port, a name and plain options. Tested against the URL the app really gets and ten that must be refused. It never shipped in the npm package (`files` is `dist` only), and it was only ever run against its own throwaway database.

### Checked by hand

`npm run dev` after the fix: the made-up data loaded, `/admin/restock` answered 200, and Ctrl+C deleted the database.

### Skipped, and why

- **Drafting with Kitting 0.2's `restockNeeds`.** CI tests against Kitting 0.1.0 from npm, which covers the fallback. The 0.2 path is tested on Kitting's side (`restockNeeds`), and Restock's call to it should get a test here once 0.2.0 is on npm. On the lead's list.
- **The license and release files:** nothing to test; the Release workflow checks the tag and the description itself.

## 2026-11-10, Kitting 0.2.0 on npm

Kitting 0.2.0 is on npm, so the gap left open above is closed.

### Gap added (1 test, 1 assertion, 1 setup fix)

- **Drafting with Kitting 0.2's `restockNeeds`.** The dev copy of Kitting is now 0.2.0. The drafting test asserts `restockNeeds` is there, so it can't quietly fall back.
- **The 0.1 fallback stays covered.** `test/kitting-0.1.test.ts` hides `restockNeeds` from the installed Kitting and checks that drafting from the stock report still gives whole packs, for one site only, with unmatched needs listed.
- **Setup fix, found by this test:** the test site didn't scope Kitting 0.2's new `kitting-settings` collection, and drafting failed with "the following path cannot be queried: tenant". Kitting's upgrade note already says to scope it. A site that skips the note gets the same unclear error, so a plainer check belongs in Kitting (on its list).

23 tests pass. Nothing skipped.

## 2026-11-10, fortnightly pass

No code has changed since the last audit: only the README's npm line and the decision feed (D1 to D16, D21). This pass maps the decisions to the tests.

### Covered

| Promise | Tests |
|---|---|
| It never buys anything; the Console's cart API changes only its own status, with history, and refuses signed-out people and other sites | the Console's cart API (step 5) |
| Each works alone: Restock drafts from the host's own needs without Kitting, and from Kitting 0.1's stock report without `restockNeeds` | without Kitting (step 2); `test/kitting-0.1.test.ts` |
| One supplier list shared with Kitting | with Kitting (step 2) |
| Status by hand only draft ↔ approved → ordered; approving and ordering need `approve`; receiving and the cart status only through Restock | life cycle (step 1); step 4; step 5 |

### Gap added (1 test)

- **Works without Kitting, at the package level** (D2, "each works alone"). The tests above run with Kitting installed, so a static import of it would pass them and still crash a host without it. Now a test checks that `package.json` has no Captive Origins dependency, that Kitting is an optional peer, and that the only reference to it in `src` is the guarded `await import(...).catch(() => null)` in `draft.ts`.

24 tests.

### For the lead

- **D2's wording in `docs/decisions.md`:** "This repo imports no other Captive Origins plugin" isn't quite true. It imports Kitting as an optional adapter, which D2 allows. The new test pins what's true; the line could say "imports no other Captive Origins plugin except Kitting, optionally".

### Skipped, and why

- **"Never stores vendor credentials":** no collection has a field for one, and a test matching field names would prove little. A review question for any new supplier field, not a test.
- **D12, no plugin-family tags:** one keyword list in `package.json`, read at review. A test would be overkill.
- **The README's npm line and the other decisions:** process, not behavior.
