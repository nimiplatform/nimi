# Social Graph and Economic Systems

Realm provides the account-level foundation for how people connect (**Realm Social**) and how digital value is tracked and attributed (**Realm Economy**). Rather than forcing every domain into a single storage pattern, Realm pairs a stateful relationship model for social connections with an append-only transaction model for account balances.

## Account Social Graph

Realm Social manages human-to-human relationships at the account level through two core records: `Friendship` and an independent `AccountBlock`.

- **Uniquely Ordered Account Pairs**: Each `Friendship` is stored against a canonical, uniquely ordered pair of accounts. Unlike financial records, friendships are stateful—supporting requests, state transitions, and removal rather than an append-only event log.
- **Cross-World Account Continuity**: Because friendships belong to user accounts rather than individual worlds, users do not need to re-add friends when switching worlds. However, an account-level connection does not mean every application can freely read your social graph; actual visibility and actions always depend on current authorization.
- **Clear Domain Boundaries**:
  - **Messaging**: Human-to-human direct messaging checks applicable friendship and block preconditions in Realm Social, while conversation streams and message delivery are handled by [Realm Chat](/realm/chat).
  - **Characters and Local Agents**: Realm Social only tracks relationships between human accounts. It does not hold Character or Persona relationships, nor is it responsible for LocalAgent creation, dialogue, or long-term memory.

## Platform Economic Systems

Realm Economy governs auditable subscriptions, account currency transactions, and revenue attribution semantics. Narrative and local AI inference compute costs are accounted for separately from Realm currency and virtual asset balances.

### Account Currency Transactions

Balance-affecting activity is recorded through append-only `CurrencyTransaction` entries on the account ledger, preserving an auditable history without destructive row mutations. Exact transaction fields and event enums are defined by the current OpenAPI and Prisma schemas.

### Creator Revenue: From Attribution to Payout

For creators building characters and world content, Realm separates revenue calculation from balance mutation across four distinct stages:

1. **Source Attribution (Available)**: `RevenueShareService` supports authenticated queries against typed `CharacterSourceRefV3` references to trace provenance and identify contributing creators.
2. **Split Preview (Available)**: Based on attributed sources, `RevenueShareService` calculates deterministic revenue-share previews. Previews are strictly read-only and do not alter account balances.
3. **Formal Ledger Settlement**: Turning a previewed split into actual balance changes requires a separately authorized, idempotent, and atomic ledger transaction. Calculated ratios or preview outputs do not represent credited or disbursed funds on their own.
4. **Creator Payouts and Workbenches (Platform Direction)**: Creator withdrawals, external payment disbursements, and dedicated desktop revenue workbenches are part of the long-term platform direction rather than current Desktop features or public App APIs.

## Application Access and Permissions

Regular Nimi Apps interact with Realm exclusively through protected, explicitly admitted `client.realm` operations. Runtime manages credentials locally while Realm validates resource-level permissions on every request—holding a general scope such as `realm.data` does not grant blanket access to social graph or economic interfaces.

## Related Documentation

- [Creator Economy and Royalties](/realm/creator-economy)
- [Realm Realtime Chat Architecture](/realm/chat)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
