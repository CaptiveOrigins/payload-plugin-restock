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
