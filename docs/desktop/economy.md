# Economy

The Wallet is Desktop's economy page. It shows your balance,
transaction history, top-up, subscription state, and withdrawals. The
figures come from your Nimi account (Realm `R-ECON-*`); Desktop
displays them.

## What The Wallet Surfaces

| Surface | Behavior |
| --- | --- |
| Currency balance | Canonical platform balance from Realm |
| Transaction history | Append-only economy event stream |
| Top-up | Add funds (under admitted top-up flow) |
| Subscription state | Active subscription (if any) |
| Withdrawal | Withdraw funds (under admitted withdraw flow) |

All economic operations require a valid bearer token. Revenue and
settlement rules live in Realm `R-ECON-003`.

## Append-Only Economy

The Realm economy is **append-only**. Every currency transaction,
revenue attribution, and settlement is recorded as a typed event with
explicit meaning. Nothing is silently rewritten.

| Property | Value |
| --- | --- |
| Storage | Append-only stream |
| Event types | Explicit; admitted at kernel level |
| Settlement | Typed events, not free-form journal entries |
| Audit | Every change is reconstructible |

That's why the transaction history in Desktop is the actual record,
not a reconstructed view.

## AI Compute Cost Is Not Realm Truth

One design choice worth knowing: AI compute cost is **not** part of
the platform economy. The platform economy tracks platform-level
value: subscriptions, revenue settlements, creator economy events, and
currency transactions. AI compute cost is accounted for separately by
Runtime. The two never collapse into one ledger.

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
