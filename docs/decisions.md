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
