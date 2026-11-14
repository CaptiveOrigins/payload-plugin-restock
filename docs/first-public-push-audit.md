# First public push audit

By the Kitting Plugin session (Restock's lead), 2026-11-09, at commit 2917360 plus the MIT commit that adds this file. The repo is still private. Making it public is the owner's step.

All 17 commits on every branch were scanned, not just the latest files.

| Check | Result |
| --- | --- |
| `scripts/leak-check.sh` locally, with the private terms list | passed |
| Private terms anywhere in history, commit messages included | none |
| Keys and tokens (Stripe, EasyPost, AWS, GitHub, npm, Slack, private keys, Mongo URLs with a password, hard-coded passwords or secrets) | none |
| Email addresses in history | only made-up `@example.com` addresses in tests and docs, and the noreply author and co-author addresses in commits |
| IP addresses, server or database hosts, deploy URLs | none |
| Phone numbers, street addresses, account or customer numbers | none |
| Real supplier or account data | none. Test suppliers are made up ("Example Packaging Co", "Example Lab Supply"), and items say "made up". ULINE and Zymo are named in `docs/decisions.md` and one field hint only for their public ordering formats and terms. `H-101` is the example model number from ULINE's public quick-order page. No account, price list or order of theirs is in the repo. |
| Home folder paths, personal names | none. Commit authors use the GitHub noreply address; git's author field holds the full name, which is allowed |
| Claude session links in commit text | none |
| Build output, packed files, `.env`, `.secrets/` | never committed. `dist/`, `*.tgz`, `.env` and `.secrets/` are ignored |
| Leak check in CI | yes, the first step of `.github/workflows/ci.yml` |
| Release | `.github/workflows/release.yml` stages on npm by trusted publishing and needs the owner's 2FA approval; no token stored |
| LICENSE | MIT, now "Copyright (c) 2026 EXTANT APE", included in the npm package |
| README status line | yes: 0.1.0, not on npm, what the 20 tests cover, the browser check on a local copy with made-up data, and what hasn't been checked |

**Worth knowing, not blocking:**
- `CLAUDE.md` (from the starter kit) is tracked. It names private tooling paths and scripts but no secrets or people.
- `docs/` mentions a console app and the owner's Tier 2 decision. Both describe Restock's own design.

Result: clean. Nothing needed rewriting.
