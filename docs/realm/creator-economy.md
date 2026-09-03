# Creator Economy

> Status: Running today. The Realm economy contracts (`R-ECON-*`)
> are live, and creator revenue policy is connected to them. For
> the payout pipeline narrative see
> [Creator Payouts](/realm/creator-payouts).

The creator economy is the slice of Realm's economy that is about
world creators earning money: revenue attribution, share plans,
settlement, and withdrawal. The World Creator Economy and Creator
Revenue Policy definitions connect those ideas to the economy
contracts that actually run them.

## Where Creator Economy Lives

| Surface | Authority |
| --- | --- |
| Realm Economy | `R-ECON-*` — append-only economy event stream |
| World Creator Economy | Bridge between platform economy and creator-side concepts |
| Creator Revenue Policy | Maps share plans, settlement rules |
| Desktop Wallet | Projects this into the creator's UI |

The creator economy is canonical at the Realm layer; the creator-
side conceptual surface is where share plans and revenue policies
attach.

## Append-Only Revenue Events

Every revenue event is typed and appended.

| Event kind | Purpose |
| --- | --- |
| Purchase | Buyer purchases admitted ownable assets |
| Settlement | Periodic settlement per share plan |
| Withdrawal | Creator withdraws settled funds |
| Correction | Supersedes a prior event under admitted correction flow |

Append-only is the audit foundation. Every revenue event has
provenance, timestamp, and typed shape. Settlement events
reference the admitted revenue-source events they settle.

## Share Plans

A share plan declares how revenue is split among creators and
contributors.

| Property | Value |
| --- | --- |
| Plan id | Stable identity |
| Owner | The creator who authored the plan |
| Splits | Typed share allocations |
| Effective dates | When this plan applies |
| Versioning | New share plans supersede older ones (no silent overwrite) |

A creator who wants to change their share plan publishes a new
plan; the old one is superseded but not deleted.

## Bridge Mappings

`world-creator-economy.md` and `creator-revenue-policy.md` are
**bridge** files. They map external open-spec anchors (the
broader concepts of "creator economy" or "revenue policy") onto
local Realm economy contracts.

| Bridge | Purpose |
| --- | --- |
| World Creator Economy | Domain bridge for creator-economy concepts |
| Creator Revenue Policy | Domain bridge for revenue policies |

The bridge files make external mental models reachable; the
canonical authority remains in the kernel `R-ECON-*` rules.

## Reader Scenario: A Creator Receives Revenue

An admitted revenue source is attributed to a creator's world and
settled under the active share plan.

1. **Source attribution.** Realm resolves the typed source origin.
2. **Settlement event triggered.** Per the active share plan,
   settlement is scheduled or computed.
3. **Settlement event commits.** Splits are recorded; each
   creator's wallet projection updates.
4. **Audit lineage.** Source attribution, settlement event, and
   each creator's settlement record remain linked.
5. **Creator views.** Through Desktop Wallet, the creator sees the
   resulting settlement and its source attribution.

The full chain is reconstructible. A creator who wants to know
"why did I receive this much" can walk back through the events.

## Reader Scenario: A Withdrawal

A creator wants to withdraw settled funds.

1. **Withdrawal request.** Creator submits withdrawal under
   admitted withdrawal flow.
2. **Realm validates.** Sufficient balance, admitted withdrawal
   destination, etc.
3. **Withdrawal event.** Typed event committed; balance
   decreases by withdrawn amount.
4. **External settlement.** Outside Realm, the funds move to the
   creator's external account under admitted withdrawal mechanism.

The withdrawal event is canonical Realm truth. The mechanism that
moves funds externally is admitted but separate from Realm core
truth.

## Reader Scenario: A Share Plan Update

A creator updates their share plan to add a new contributor.

1. **Compose new plan.** Creator composes a new share plan with
   the additional contributor.
2. **Publish.** Realm admits the new plan; old plan is
   superseded with effective-date semantics.
3. **Future settlements use new plan.** From the new plan's
   effective date onward, settlements split per the new plan.
4. **Past settlements unchanged.** Already-settled events use
   their original share plan; they are not retroactively
   rewritten.
5. **Audit lineage.** Old plan + new plan + supersession event
   all in the canonical record.

A share plan is canonical; updating it preserves history.

## What Creator Economy Does Not Do

| Concern | Why not |
| --- | --- |
| AI compute cost accounting | Separate runtime concern, not Realm core truth |
| World-internal currencies | World creators may run their own internal currencies; those are not platform canonical |
| Subscription processor internals | Lives in admitted subscription surface, not creator economy directly |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
