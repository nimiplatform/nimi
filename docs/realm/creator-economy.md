# Creator Economy and Value Distribution

The Creator Economy infrastructure in Realm provides monetization and value-sharing rails for digital world architects, 3D artists, and lore builders. It defines how digital creations are registered, how proceeds are apportioned among collaborators, and how disbursements are settled.

For details on the settlement and banking payout pipeline, see [Creator Payouts and Settlement Flows](/realm/creator-payouts).

> Status: The economic event ledger and revenue split models are settled under `R-ECON-*`; the creator payout pipeline and user-facing withdrawal interfaces represent an admitted platform direction rather than an active Desktop "Financial Center" or public App API.

## Tiered Architectural Model

| Layer | Domain | Responsibility |
| --- | --- | --- |
| **Realm Economic Core (`R-ECON-*`)** | Immutable Append-Only Ledger | Records verifiable asset purchases, royalty allocations, and disbursements |
| **World Creator Agreements** | Rights and Licensing Framework | Governs IP ownership and downstream distribution terms for virtual items |
| **Revenue Policies & Split Plans** | Commercial Distribution Rules | Encapsulates mathematical revenue partitions among collaborating creators |
| **Creator Desktop Workspace (Planned)** | Creator Dashboard & Accounting (Platform Direction) | Conceptual design for visualizing sales analytics, historical settlements, and withdrawal flows |

## Append-Only Financial Ledger Events

Financial operations emit structured events into immutable ledgers:

- **Purchase Events**: Emitted when users purchase digital assets, passes, or virtual goods.
- **Settlement Events**: Dispatched when the engine executes scheduled split schemes, crediting individual creator balances.
- **Withdrawal Events**: Emitted when a creator requests payout of settled funds under admitted withdrawal flows.
- **Correction Events**: Used when refunds or dispute adjustments occur, replacing older entries by appending explicit offsets rather than mutating past records.

## Multi-Collaborator Revenue Splits

Supports multi-party revenue distribution for collaborative projects:
- **Explicit Split Plans**: Bound to unique Plan IDs with designated effective timestamp windows.
- **Automated Apportionment**: Allocates proceeds according to verified percentages (e.g., 70% Lead Author, 20% Modeler, 10% Composer).
- **Forward-Only Versioning**: Updating a split scheme applies exclusively to transactions occurring after the effective timestamp; historical settlements remain untampered.

## Planned Workflow: Creator Payout and Settlement (Platform Direction)

1. **Review Available Balance**: Creator balances are projected dynamically from settled Realm economic ledger events.
2. **Disbursement Request**: The creator submits a withdrawal request through platform-supervised payout channels once available.
3. **Escrow & Verification**: Realm logs the withdrawal intent as a typed `Withdrawal` event, subject to platform compliance checks.
4. **End-to-End Auditability**: Every payout record traces back to the granular user purchase events that generated the proceeds.

## Related Documentation

- [Creator Payouts & Settlement Flows](/realm/creator-payouts)
- [Asset Attachment & Binding Specification](/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
