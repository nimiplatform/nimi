# Creator Payouts and Settlement Architecture

In Nimi's Realm Economy, creator payouts build on a clear separation between how value is attributed, how splits are previewed, how balances are settled on the ledger, and how funds are eventually withdrawn. Creator earnings and subscription or currency records are tracked as auditable economic activity, kept strictly separate from in-world narrative trades and AI compute billing.

> Status: Platform direction. Realm Economy already defines append-only currency ledger semantics (`CurrencyTransaction`) and deterministic revenue split previews (`RevenueShareService`). Creator withdrawals and the Desktop earnings workspace are platform directions, with no active Desktop feature or public App API; specific payout cycles and payment integrations are not established by this model.

## From Attribution to Payout

Understanding creator compensation in Realm requires distinguishing four conceptual stages—from read-only calculation to actual fund movement:

1. **Source Attribution**: `RevenueShareService` resolves creator provenance through authenticated, typed `CharacterSourceRefV3` lookups, tying economic activity back to its recognized source.
2. **Deterministic Split Preview**: Before any balance changes occur, `RevenueShareService` calculates a deterministic preview of how proceeds should be shared. A preview is strictly read-only—it shows expected proportions without crediting accounts or writing distribution entries.
3. **Formal Ledger Settlement**: Preview ratios do not equal disbursed funds. Moving value into an account balance requires a separately admitted, idempotent, and atomic ledger transaction. Account-level currency changes are recorded as append-only `CurrencyTransaction` entries, whose exact fields and event types are defined by the active OpenAPI and Prisma schemas.
4. **Payout and Withdrawal (Planned)**: Creator withdrawals and a dedicated earnings workspace remain platform directions. This model does not define available settlement schedules, refund workflows, or external payment gateways.

## Accounting and Access Boundaries

- **Separated from Story and Compute**: Fictional transactions between characters belong to world narrative, and model inference costs belong to compute billing. Neither contaminates creator revenue accounting.
- **Append-Only Ledger History**: `CurrencyTransaction` records are append-only. Balance adjustments rely on new ledger transactions rather than overwriting historical entries.
- **Scoped App Access**: Nimi Apps can only call explicitly admitted operations on `client.realm`; a `realm.data` scope does not grant blanket access to economy or settlement interfaces. Runtime holds Realm credentials while Realm enforces resource-level permissions.

## Related Documentation

- [Creator Economy Architecture](/realm/creator-economy)
- [Asset Attachment and Binding](/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
