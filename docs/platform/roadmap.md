# Roadmap

## Status: Public roadmap projection

This page describes the **roadmap governance shape** that Nimi exposes to
developers and readers: how capabilities are tracked, how they earn admission,
and which status values they pass through. It does not promise dates, and it is
not an active product authority source.

Active product behavior is governed by `.nimi/spec/<domain>/kernel/**`.
Candidate roadmap and backlog material is not represented as an active spec
subtree; until a capability graduates into an active product domain, roadmap
state is handled through the product planning process outside active spec.

## Why A Roadmap Surface

A platform without a roadmap surface ends up with: features sneaking in
unannounced, ad-hoc public roadmaps that drift from reality, and no shared
vocabulary for "where is X in the pipeline." The roadmap surface answers all
three: every tracked capability has a typed status; every status transition is
governed before it becomes product authority.

## Backlog Item Shape (F-CAP-001)

Every backlog entry has required fields:

| Field | Purpose |
| --- | --- |
| `item_id` | `F-<MNEMONIC>-NNN`, globally unique |
| `title` | Short title |
| `priority` | `high` / `medium` / `low` |
| `category` | `ux` / `integration` / `platform` / `auth` / `security` / `observability` |
| `target_layers` | Affected layers: `runtime` / `sdk` / `desktop` / `web` |
| `status` | Lifecycle state |
| `source_ids` | At least one `RESEARCH-*` source reference |
| `complexity` | `small` / `medium` / `large` |
| `depends_on` | Dependency `item_id` list (no self-ref, no cycles) |
| `architecture_notes` | Brief architecture impact |

Items without a `RESEARCH-*` source do not enter the backlog. The provenance
link is required.

## Priority Taxonomy (F-CAP-002)

| Priority | Meaning |
| --- | --- |
| `high` | Directly affects core user experience or competitive gap; implementation path clear |
| `medium` | Strengthens platform capability or integration; clear demand but does not block core flow |
| `low` | Long-term capability reserve; no immediate need or waiting on external standard maturity |

Priority is operational guidance, not a date promise.

## Status Lifecycle (F-CAP-003)

```
proposed -> accepted -> spec-drafted -> implemented
                   -> rejected
                   -> deferred
```

| Status | Meaning |
| --- | --- |
| `proposed` | Extracted from research reports; awaiting audit |
| `accepted` | Audit passed; in active backlog |
| `spec-drafted` | Has draft authority in an active product domain |
| `implemented` | Implemented and merged |
| `rejected` | Audited and deemed not applicable / off-direction |
| `deferred` | Waiting on external conditions to mature |

A status transition is governed by an admitted graduation event. Status does not
change by app convention.

## Category Taxonomy (F-CAP-004)

| Category | Meaning |
| --- | --- |
| `ux` | User experience improvements (rendering, interaction, editor) |
| `integration` | Optional external protocol / service integration |
| `platform` | Platform capability that still requires an explicit product-owner decision |
| `auth` | Authentication / authorization extension |
| `security` | Security and review capability |
| `observability` | Observability + operations |

The category is closed. Items do not invent new categories by convention.

## Dependency Constraints (F-CAP-005)

| Rule | Value |
| --- | --- |
| Each `depends_on` item must resolve to a tracked backlog item | Required |
| Self-references | Forbidden |
| Cycles | Forbidden |
| Dependency strength | Soft constraint (recommended order, not hard block) |

Soft dependencies let independent development proceed in parallel where the
items are not mutually-exclusive, but the dependency is still recorded so
reviewers see the recommended order.

## Source Registry

Backlog items reference research sources via `RESEARCH-*` ids. The source
registry admits which research surfaces may originate backlog items. The
registry is the provenance discipline: items cannot be invented from intuition.

## Graduation Contract

The graduation contract governs how items transition through the status
lifecycle:

| Transition | Required evidence |
| --- | --- |
| `proposed -> accepted` | Audit pass with explicit reason |
| `accepted -> spec-drafted` | Draft authority exists under an active product domain |
| `spec-drafted -> implemented` | Implementation merged + admitted spec final |
| Anything -> `rejected` | Audit reason recorded; not silent |
| Anything -> `deferred` | Deferred reason recorded; revisit conditions named |

The graduation contract is the answer to "how does X become real."

## Reader Scenario: A New Capability Enters The Backlog

A research report identifies a capability the platform should consider.

1. **Research surface attaches a `RESEARCH-*` id.** Per the source registry.
2. **Backlog item drafted.** All required fields filled. Status: `proposed`.
   Source ids reference the research.
3. **Audit.** Audit reviews against direction; outcome is `accepted`,
   `rejected`, or `deferred`. Reason recorded.
4. **If `accepted`:** item enters active backlog with assigned priority,
   category, and target layers.

## Reader Scenario: An Item Drafts A Spec

An accepted item moves toward implementation.

1. **Product proposal prepared.** The proposal identifies the intended owner,
   such as Runtime, SDK, Desktop, Platform, Realm, or Avatar.
2. **Status transitions to `spec-drafted`.** Per graduation evidence.
3. **Owner decision.** If the product decision closes, its truth is authored in
   the existing `.nimi/spec/**` owner container.
4. **Implementation begins.**

## Reader Scenario: An Item Gets Deferred

An accepted item depends on an external standard that has not matured.

1. **Status moves to `deferred`.** Reason recorded: "blocked on external
   standard X reaching version Y."
2. **Revisit condition named.** "Re-evaluate when X.Y ships."
3. **Backlog stays accurate.** The item is visible but not pretending to be
   active.

## What The Roadmap Does Not Do

- It does not promise dates.
- It does not promise specific implementations of any item.
- It does not let items enter without `RESEARCH-*` provenance.
- It does not let items invent categories or statuses.
- It does not silently delete items; `rejected` and `deferred` are explicit
  terminal-or-paused states with reasons.
- It does not allow circular or self-referencing dependencies.
- It does not override active product authority under `.nimi/spec/**`.

## Boundary Summary

| Concern | Source of truth |
| --- | --- |
| Implemented product behavior | Active product domain spec under `.nimi/spec/<domain>/kernel/**` |
| Candidate roadmap posture | Product planning records outside active spec |
| Backlog item shape | Roadmap projection taxonomy |
| Priority taxonomy | Roadmap projection taxonomy |
| Status lifecycle | Graduation event evidence |
| Category taxonomy | Roadmap projection taxonomy |
| Source provenance | Research source registry |

## Source Basis

- [`docs/spec/INDEX.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/INDEX.md)
- Active product domain specs under `.nimi/spec/<domain>/kernel/**`
- Roadmap planning records and admitted graduation events
