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
- **LICENSE:** none while the repo is private (director, 2026-11-09, following the ~/Code rule for private repos). It becomes MIT at the public step, as the brief decides.

## 2026-11-09: what the suppliers' own pages say (read by a session, not checked by the owner)

- **ULINE** (uline.com/QuickOrder, "Catalog Quick Order"): it takes model numbers and unit quantities, with the model number and quantity separated by a space or a comma, for example `H-101, 25`, one per line. There's also a "Paste Items Page". Its cart holds at most 95 items. No file upload was found. So Restock's "Copy for Quick Order" for ULINE is `MODEL, QTY` lines, with a warning past 95 lines.
- **Zymo Research**: its Quick Order page is search-based, one item at a time, with no paste format and no upload found. So for Zymo, Restock gives product links, a CSV and an email draft.
- **Terms on automated access:** none was found in either site's web terms that were read. Not read yet: ULINE's full terms PDF and robots.txt, and Zymo's Terms of Purchase. This matters only for Tier 2 (the Console), and is checked fully before anything is handed to it.

## 2026-11-09: suppliers' terms on automated access (step 6, read by a session; for the owner to decide)

Read from the suppliers' own pages on 2026-11-09. A session's reading, not legal advice.

- **ULINE.**
  - Its full terms (the PDF linked from uline.com/Terms, "Use restrictions") say you may not scrape, extract, download or copy the site's contents "using automated tools, including … bots", without ULINE's written consent.
  - Its robots.txt doesn't block /QuickOrder or /Cart for crawlers, but it blocks the checkout steps (/Ordering/Step1… to Step5…).
  - Its site also offers procurement **punchout** (Ariba), its sanctioned route for system-to-system ordering.
  - **Reading:** a bot filling ULINE's cart isn't clearly allowed. By the owner's rule ("only for a vendor whose terms allow automated access", and "if a safety check can't reach a decision, the answer is no"), Tier 2 stays off for ULINE unless ULINE gives written consent or a punchout account is set up.
  - Tier 1 (a person pastes Restock's quick-order lines into ULINE's page) involves no automation, and stays.
- **Zymo Research.**
  - Its website terms and terms of purchase say nothing about automated access.
  - Its robots.txt (a Shopify store) disallows /cart, /checkout, /orders and /account for all agents.
  - Its How to Order page supports ordering **by email to its orders address**. It lists the fields to include: PO number, billing and shipping addresses, the attention line, a contact name and phone, catalog number, product name, size and quantity, and the customer type.
  - **Reading:** the robots.txt asks automated agents to stay out of the cart and checkout, so treat Tier 2 as refused for Zymo. The email PO is its sanctioned route, and Restock's email draft fits it, once the supplier's ordering notes hold the billing and shipping details and contact.
- **So, for now:** nothing is handed to the Console for either supplier. The owner may ask ULINE for written consent or a punchout account, and Zymo whether automated cart filling is acceptable. Until then, both stay on Tier 1.

## 2026-11-09 (owner): Tier 2 decided

Ordering stays on **copy/paste and email**. There's no cart automation for ULINE or Zymo, and nothing to ask either supplier. The Console's cart API stays in place: it's harmless, changes nothing but its own status, and is ready if this ever changes. One PDF renderer, with no separate printable HTML view (director, same day).

## 2026-11-09 (director): MIT, ready for the public step

Restock is a general Payload plugin, so it's licensed MIT like the others (`~/Code/CLAUDE.md`), `Copyright (c) 2026 Captive Origins`. This replaces the "no license while private" entry above. The repo is still private: making it public, the first npm publish and npm trust are the owner's steps.

- `LICENSE` is back, `package.json` says `"license": "MIT"`, and the npm package includes `LICENSE`.
- Added the standard `release.yml` (stage on npm by trusted publishing; the owner approves with 2FA) and `RELEASING.md`, copied from Kitting.
- Kitting is an optional peer from `>=0.1.0`, not `>=0.2.0`. The tests run against Kitting 0.1.0 from npm, and drafting falls back to its below-level list when `restockNeeds` (0.2) isn't there. Kitting 0.2 adds `restockNeeds` and the arrivals on its Today line.
- The first-public-push audit is in `docs/first-public-push-audit.md`.

## 2026-11-10: decision feed acknowledged (ops/decisions/all.md, captive-origins.md)

Settled decisions from the owner, through Helm's feed. The feed holds the owner's exact words.

- **D1** Settled decisions arrive through the feed and are acted on, not re-argued.
- **D2** Build it right: agnostic plugins with optional adapters, best architecture first. This repo depends on no other Captive Origins plugin: Kitting is an optional peer, reached only through a guarded dynamic import in `draft.ts`, and Restock runs without it (tested).
- **D3** Owner steps and tests go to `~/Code/ops/inbox/` per `ops/rules/owner-items.md`, never straight to needs-you.md or tests.md.
- **D4** Priority: Docker media, Minecraft server, then all Captive Origins.
- **D5** No private repos to save CI minutes. This repo is public, with the Actions-minutes rules.
- **D6, D21** Plugin names need the owner's OK before work starts (ops/plugin-names.md). Restock predates the review and is on npm; it isn't in the Approved table.
- **D7** No launch dates: work follows the priority list in ops/timeline-captive-origins.md. A freeze point is cut only when the owner says so.
- **D8** Seed World hears about every collection-structure change ahead of time, with versions, and audits when it lands.
- **D12** No plugin-family tags yet. None are in `package.json` keywords.
- Not for this repo: D9 (PM doc), D10 (tour before studbook), D11 (kids decide on guardian suggestions), D14 (plan B), D15 (Husbandry.Pro link), D16 (both views).
