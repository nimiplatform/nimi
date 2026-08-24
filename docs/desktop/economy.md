# Economy

Desktop's economy surface — the Wallet — projects the user's
canonical economic standing from Realm. Currency balance,
transaction history, top-up, subscription state, and withdrawal
surface here. Realm `R-ECON-*` is the source of truth; Desktop is
the consumer.

## What The Wallet Surfaces

| Surface | Behavior |
| --- | --- |
| Currency balance | Canonical platform balance from Realm |
| Transaction history | Append-only economy event stream |
| Top-up | Add funds (under admitted top-up flow) |
| Subscription state | Active subscription (if any) |
| Withdrawal | Withdraw funds (under admitted withdraw flow) |

All economic operations require a valid bearer token. Realm
`R-ECON-003` is the source of truth for revenue and settlement
logic.

## Append-Only Economy

Realm economy is **append-only**. Currency transactions, revenue
attribution, and settlement use typed events with explicit semantics.
Nothing silently rewrites.

| Property | Value |
| --- | --- |
| Storage | Append-only stream |
| Event types | Explicit; admitted at kernel level |
| Settlement | Typed events, not free-form journal entries |
| Audit | Every change is reconstructible |

This is why "transaction history" in Desktop is a real reference,
not a reconstructed view. The events are canonical.

## AI Compute Cost Is Not Realm Truth

A non-obvious design choice: AI compute cost is **not** modeled as
Realm core truth. Cost accounting is a separate concern from the
canonical economy.

The canonical economy is about platform-level value: subscriptions,
revenue settlements, creator economy events, and currency
transactions. AI compute cost is a runtime concern with its own
accounting. The two do not collapse into one ledger.

## Reader Scenario: A Creator Receives Revenue Settlement

A world creator's world generates revenue from admitted sources.

1. **Events accumulate.** Each admitted revenue event is appended
   with typed source attribution.
2. **Share plan.** The creator's share plan is admitted under
   `R-ECON-*`.
3. **Settlement events.** At settlement time, settlement events
   are appended; the creator's wallet balance updates.
4. **Withdrawal.** The creator can withdraw under the admitted
   withdrawal flow.
5. **Audit.** Every event in the chain is reconstructible from
   revenue attribution through settlement and withdrawal.

A creator who wants to know "where did this revenue come from"
can answer the question through the typed event stream.

## What Wallet Does Not Show

| Concern | Why not |
| --- | --- |
| Other users' balances | Private to each user |
| AI compute cost detail | Separate runtime concern |
| World-internal currencies | World creators may run their own internal currencies; those are not platform canonical |

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
