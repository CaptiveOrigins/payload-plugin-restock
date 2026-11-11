# Changelog

## Unreleased

- **`arrived` says which site each order belongs to.** The function Restock puts on `config.custom.restock` for other plugins now returns `scope` with each order: the order's site, the ID in `scopeField`, or `null` when Restock runs without one. Kitting uses it to show its "Arrived, please confirm" line to staff who manage only some sites, with only those sites' deliveries. The other fields are unchanged, so callers that ignore `scope` work as before. The contract is in [docs/contracts/kitting-restock.md](docs/contracts/kitting-restock.md).

Tested: 26 tests (1 extended). Not tested: Kitting's Today line in a real admin with both plugins installed.
