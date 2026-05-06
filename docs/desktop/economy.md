# Economy

Desktop's economy surface — the Wallet — projects the user's
canonical economic standing from Realm. Currency balance,
transaction history, top-up, subscription state, withdrawal, and
the gift system all surface here. Realm `R-ECON-*` is the source
of truth; Desktop is the consumer.

## What The Wallet Surfaces

| Surface | Behavior |
| --- | --- |
| Currency balance | Canonical platform balance from Realm |
| Transaction history | Append-only economy event stream |
| Top-up | Add funds (under admitted top-up flow) |
| Subscription state | Active subscription (if any) |
| Withdrawal | Withdraw funds (under admitted withdraw flow) |
| Gift system | Send / receive gifts |

All economic operations require a valid bearer token. Realm
`R-ECON-003` is the source of truth for revenue and settlement
logic.

## Append-Only Economy

Realm economy is **append-only**. Every gift, every revenue split,
every settlement event is a typed event with explicit type. Nothing
silently rewrites.

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

The canonical economy is about platform-level value: gifts,
revenue settlements, creator economy events. AI compute cost is a
runtime concern with its own accounting. The two do not collapse
into one ledger.

## Reader Scenario: Sending A Gift

You want to send a gift to a friend.

1. **Wallet open.** You see your canonical balance.
2. **Compose gift.** Desktop submits a typed gift event to
   Realm — sender, recipient, item, amount.
3. **Realm admits.** The economy contract validates: sender has
   sufficient balance; recipient is admitted; gift event is
   typed correctly.
4. **Append.** The gift event is appended to the economy stream.
5. **Settlement.** Per `R-ECON-*`, the settlement is recorded.
6. **Audit lineage.** Sender, recipient, gift event id, settlement
   record — all linked.

The gift is a real economic event, not a UI gesture. It is
auditable end-to-end.

## Reader Scenario: A Creator Receives Revenue Settlement

A world creator's world generates revenue from gifts and
purchases.

1. **Events accumulate.** Each gift / purchase is appended as a
   typed economy event.
2. **Share plan.** The creator's share plan is admitted under
   `R-ECON-*`.
3. **Settlement events.** At settlement time, settlement events
   are appended; the creator's wallet balance updates.
4. **Withdrawal.** The creator can withdraw under the admitted
   withdrawal flow.
5. **Audit.** Every event in the chain is reconstructible —
   gifts → settlement → withdrawal.

A creator who wants to know "where did this revenue come from"
can answer the question through the typed event stream.

## What Wallet Does Not Show

| Concern | Why not |
| --- | --- |
| Other users' balances | Private to each user |
| AI compute cost detail | Separate runtime concern |
| World-internal currencies | World creators may run their own internal currencies; those are not platform canonical |

## Source Basis

- [`.nimi/spec/desktop/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/economy.md)
- [`.nimi/spec/realm/economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/economy.md)
- [`.nimi/spec/realm/kernel/economy-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/economy-contract.md)
- [`.nimi/spec/realm/kernel/tables/economy-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/economy-contract.yaml)
- [`.nimi/spec/realm/world-creator-economy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-creator-economy.md)
- [`.nimi/spec/realm/creator-revenue-policy.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/creator-revenue-policy.md)
