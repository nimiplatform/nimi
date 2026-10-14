# Creator Economy and Value Distribution

Realm Economy provides the financial backbone for creators building characters and experiences across Nimi. Kept separate from narrative state and AI compute billing, it defines auditable semantics for subscriptions, account currency transactions, and revenue attribution and sharing.

For a closer look at how settlement and withdrawal stages are structured, see [Creator Payouts and Settlement Flows](/realm/creator-payouts).

## From Attribution to Payout

To keep financial records accurate and auditable, Realm separates revenue calculation from actual balance changes. Value flows through four distinct stages, spanning active capabilities and planned platform directions:

### 1. Source Attribution (Active)

Before revenue can be shared, Realm identifies the upstream creations involved. Through authenticated queries, `RevenueShareService` resolves typed `CharacterSourceRefV3` references to trace which creators and source assets contribute to a given character or experience.

### 2. Deterministic Split Preview (Active)

Once attribution is resolved, `RevenueShareService` can generate a deterministic revenue share preview. Previews show how proceeds would be apportioned among contributors, but they are strictly read-only calculations. Generating a preview does not trigger write operations or modify any account balances.

### 3. Formal Ledger Settlement (Ledger Core)

Turning a calculated split into actual creator earnings requires a separately admitted, idempotent, and atomic ledger transaction. A preview or split ratio never represents credited funds on its own. When a settlement transaction is committed, Realm records the balance movement as an append-only `CurrencyTransaction` account event (with exact fields and event types defined by the current OpenAPI and Prisma schemas).

### 4. Payouts and Creator Workspace (Platform Direction)

Withdrawing settled balances to external payout channels and tracking earnings in a dedicated Desktop workspace are part of our longer-term platform direction, not active Desktop features or public App APIs. Capabilities such as scheduled auto-settlements, escrow holds, payment gateway disbursements, and self-serve refund adjustments remain outside the current interface.

## App Access and Permission Boundaries

Regular Nimi Apps interact with Realm only through explicitly admitted `client.realm` operations. Runtime manages credentials on the user's behalf, while Realm enforces resource-level permissions—holding a `realm.data` scope does not grant blanket access to economy or social interfaces.

## Related Documentation

- [Creator Payouts and Settlement Flows](/realm/creator-payouts)
- [Asset Attachment & Binding Specification](/realm/asset-and-binding)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
