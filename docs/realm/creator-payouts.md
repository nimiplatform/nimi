# Creator Payouts and Financial Settlement Pipelines

Within Nimi's economic architecture, "Payouts" denote the financial lifecycle that translates virtual commercial proceeds into compliant disbursements. Anchored by the immutable `R-ECON-*` ledger and explicit split agreements, the payout pipeline ensures transparent, verifiable disbursement workflows.

> Status: Admitted as platform direction. The economy core that payouts build on (`R-ECON-*` contracts, revenue split policies) is settled; the payout pipeline and user-facing withdrawal interfaces represent an agreed platform direction rather than an active Desktop feature or public App API.

## Foundational Invariants

1. **Decoupling Finance from Narrative Fiction**: In-game transactions between characters belong to narrative world lore (Story Events), while real creator compensation belongs to financial accounting (Economic Events). These data streams remain strictly separated to prevent accounting contamination.
2. **Explicit Transparent Revenue Splits**: Collaborator split percentages are locked into registered agreements prior to becoming effective, preventing undisclosed deductions or arbitrary retroactive splits.
3. **Immutable Financial Ledger**: All purchases, settlements, and withdrawals commit exclusively to append-only ledgers.

## Lifecycle of a Payout

| Phase | Operational Action | Ledger Event Representation |
| --- | --- | --- |
| **1. Ingestion** | A buyer purchases a creator's world asset | Emits `Purchase` event, recording source and asset provenance |
| **2. Accumulation** | Proceeds pool within the current billing cycle | Engine computes collaborator shares based on active split plans |
| **3. Settlement** | Scheduled or triggered settlement execution | Commits `Settlement` event, moving funds to available creator balances |
| **4. Payout (Direction)** | Creator initiates disbursement via admitted withdrawal flows | Commits `Withdrawal` event to append-only ledger; external disbursement gateways represent future platform direction |

## Corrections and Dispute Auditing

When handling billing discrepancies, refunds, or chargebacks:
- **Preservation of History**: The original transaction entry remains permanently visible in the ledger.
- **Explicit Offsets**: The system records an explicit `Correction` event referencing the original entry with a documented justification.
- **Verifiable Auditability**: Financial auditors can trace both the original purchase and its subsequent offset, ensuring full compliance.

## Related Documentation

- [Creator Economy Architecture](/realm/creator-economy)
- [Asset Attachment and Binding](/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
