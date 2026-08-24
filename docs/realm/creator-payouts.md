# Creator Payouts

## Status: Admitted as platform direction

The Realm economy contracts (`R-ECON-*`) and the
`creator-revenue-policy.md` / `world-creator-economy.md` framings
are admitted at the spec level. Payout flows, settlement cadence
operationalization, and withdrawal UI are admitted as direction;
the user-facing payout surface is not a public app API.

## What "Payouts" Means

A creator who builds a world earns from admitted revenue sources
and share-plan settlements made within that world. **Payouts** are the
typed pipeline from those earnings to the creator's withdrawn
funds — accruing in append-only events, settling per share plan,
withdrawn through admitted flows.

This page explains the pieces. It does not promise dates.

## Authority Surface

| Concern | Authority |
| --- | --- |
| Realm economy contract (append-only, separate from narrative) | `R-ECON-001..R-ECON-004` |
| World creator economy bridge | `realm/world-creator-economy.md` |
| Creator revenue policy (share plans, settlement) | `realm/creator-revenue-policy.md` |
| Desktop wallet projection | Desktop kernel (admitted) |

The economy is canonical at Realm. Desktop projects it; share plans
and revenue policies attach at the bridge.

## Append-Only Revenue Events

Every revenue event is typed and appended:

| Event kind | Purpose |
| --- | --- |
| Purchase | Buyer purchases admitted ownable assets |
| Settlement | Periodic settlement per share plan |
| Withdrawal | Creator withdraws settled funds |
| Correction | Supersedes a prior event under admitted correction flow |

Append-only is the audit foundation. Every revenue event has
provenance, timestamp, and typed shape. Settlement events reference
the admitted revenue-source events they settle.

## Share Plans

A share plan declares how revenue is split among creators and
platform. Plans are explicit; revenue does not flow without an
admitted plan. The plan governs:

- Which creators receive shares
- The split percentages
- Settlement cadence
- Withdrawal eligibility

Hidden side splits, retroactive plan changes that mutate prior
settlements, or platform-skim outside the declared plan are
forbidden.

## Boundary Per `R-ECON-*`

| Rule | Constraint |
| --- | --- |
| `R-ECON-001` | Creator economy + access economics remain auditable, explicit, separate from narrative runtime |
| `R-ECON-002` | AI compute route cost is NOT modeled as Realm core truth or hidden world mutation |
| `R-ECON-003` | Revenue and settlement use explicit event types and share plans with append-only accounting |
| `R-ECON-004` | Apps cannot hide economic state changes inside narrative history or memory commits |

The boundary keeps "money flow" from getting tangled with "story
flow." A purchase is a typed economy event. A character buying
something in-narrative is a story event. They are not the same row.

## Reader Scenario: Revenue Becomes A Settlement

An admitted revenue source is attributed to a creator's world.

1. **Source attribution.** Realm records the typed origin and its
   economic lineage.
2. **Revenue accrues.** Admitted revenue events accumulate under
   the active share plan.
3. **Settlement cadence fires.** A typed `Settlement` event
   references the revenue events it settles and records each share.
4. **Settled funds become available.** A creator may withdraw
   settled funds through the admitted Withdrawal flow.
5. **Withdrawal event.** Append-only, with provenance attached.

The chain is auditable end-to-end from source attribution through
settlement and withdrawal.

## Reader Scenario: A Correction

A revenue source was attributed to the wrong world.

1. **Original attribution.** Stays as-is in the append-only record.
2. **Correction event.** A typed correction supersedes the original
   attribution and records the corrected origin and reason.
3. **Settlement re-derivation.** The next settlement cycle reads
   the corrected attribution.
4. **Audit chain.** Reviewers see both records; nothing is silently
   overwritten.

## Reader Scenario: A Forbidden Substitution

A maintainer asks: can settlement be embedded inline as a memory
commit to skip Realm economy?

1. **Reject.** Per `R-ECON-004`, apps cannot hide economic state
   changes inside narrative history or memory commits.
2. **Re-route.** Settlement is a Realm economy event; no other
   surface may stand in for it.
3. **Audit posture preserved.** The auditable separate stream is
   what makes payouts trustworthy.

## What Creator Payouts Do Not Do

- Promise specific payout dates.
- Promise specific share-plan terms.
- Promise specific withdrawal cadence.
- Allow revenue to flow without admitted share plans.
- Let AI compute cost become Realm truth.
- Let economy events hide inside narrative history or memory.

The "what is admitted" surface is the contract. The "what ships when"
question is operational, not contractual.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Realm economy event stream | Realm (`R-ECON-*`) |
| Share plans + settlement rules | `creator-revenue-policy.md` |
| World creator bridge | `world-creator-economy.md` |
| Wallet UI projection | Desktop kernel (admitted) |

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
