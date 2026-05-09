# Roadmap

## Status: Admitted as platform direction

The capability backlog (`F-CAP-*`), source registry, and graduation
contract are admitted at the kernel level under `nimi/.nimi/spec/future/`.
This page describes the **roadmap governance shape**: how
capabilities are tracked, how they earn admission, what status
values they pass through. It does not promise dates.

## Why A Roadmap Authority

A platform without a roadmap surface ends up with: features sneaking
in unannounced, ad-hoc public roadmaps that drift from reality, and
no shared vocabulary for "where is X in the pipeline." The future
authority surface answers all three: every tracked capability is in
the backlog with a typed status; every status transition is governed.

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

Items without a `RESEARCH-*` source do not enter the backlog. The
provenance link is required.

## Priority Taxonomy (F-CAP-002)

| Priority | Meaning |
| --- | --- |
| `high` | Directly affects core user experience or competitive gap; implementation path clear |
| `medium` | Strengthens platform capability or integration; clear demand but does not block core flow |
| `low` | Long-term capability reserve; no immediate need or waiting on external standard maturity |

Priority is operational guidance, not a date promise.

## Status Lifecycle (F-CAP-003)

```
proposed → accepted → spec-drafted → implemented
                   ↘ rejected
                   ↘ deferred
```

| Status | Meaning |
| --- | --- |
| `proposed` | Extracted from research reports; awaiting audit |
| `accepted` | Audit passed; in active backlog |
| `spec-drafted` | Has draft spec under `.nimi/spec/runtime/` or `.nimi/spec/sdk/` |
| `implemented` | Implemented and merged |
| `rejected` | Audited and deemed not applicable / off-direction |
| `deferred` | Waiting on external conditions to mature |

A status transition is governed by `graduation-contract.md`. Status
does not change by app convention; it changes by admitted graduation
event.

## Category Taxonomy (F-CAP-004)

| Category | Meaning |
| --- | --- |
| `ux` | User experience improvements (rendering, interaction, editor) |
| `integration` | External protocol / service integration (MCP, search, OAuth) |
| `platform` | Platform core capability (RAG, workflow, model routing) |
| `auth` | Authentication / authorization extension |
| `security` | Security and review capability |
| `observability` | Observability + operations |

The category is closed. Items do not invent new categories by
convention.

## Dependency Constraints (F-CAP-005)

| Rule | Value |
| --- | --- |
| Each `depends_on` item must exist in `backlog-items.yaml` | Required |
| Self-references | Forbidden |
| Cycles | Forbidden |
| Dependency strength | Soft constraint (recommended order, not hard block) |

Soft dependencies let independent development proceed in parallel
where the items are not mutually-exclusive — but the dependency is
still recorded so reviewers see the recommended order.

## Source Registry

Backlog items reference research sources via `RESEARCH-*` ids. The
source registry under `future/source-registry.md` admits which
research surfaces may originate backlog items. The registry is the
provenance discipline — items cannot be invented "from intuition."

## Graduation Contract

The graduation contract governs how items transition through the
status lifecycle:

| Transition | Required evidence |
| --- | --- |
| `proposed → accepted` | Audit pass with explicit reason |
| `accepted → spec-drafted` | Draft spec exists under admitted spec path |
| `spec-drafted → implemented` | Implementation merged + admitted spec final |
| Anything → `rejected` | Audit reason recorded; not silent |
| Anything → `deferred` | Deferred reason recorded; revisit conditions named |

The graduation contract is the answer to "how does X become real."

## Reader Scenario: A New Capability Enters The Backlog

A research report identifies a capability the platform should
consider.

1. **Research surface attaches a `RESEARCH-*` id.** Per the source
   registry.
2. **Backlog item drafted.** All required fields filled. Status:
   `proposed`. Source ids reference the research.
3. **Audit.** Audit reviews against direction; outcome is
   `accepted`, `rejected`, or `deferred`. Reason recorded.
4. **If `accepted`:** item enters active backlog with assigned
   priority + category + target layers.

## Reader Scenario: An Item Drafts A Spec

An accepted item moves toward implementation.

1. **Spec draft proposed.** Under admitted spec path
   (`.nimi/spec/runtime/`, `.nimi/spec/sdk/`, etc.).
2. **Status transitions to `spec-drafted`.** Per graduation
   contract evidence.
3. **Spec admission process.** Separate from backlog status; spec
   moves through its own admission.
4. **Implementation begins.**

## Reader Scenario: An Item Gets Deferred

An accepted item depends on an external standard that hasn't
matured.

1. **Status moves to `deferred`.** Reason recorded: "blocked on
   external standard X reaching version Y."
2. **Revisit condition named.** "Re-evaluate when X.Y ships."
3. **Backlog stays accurate.** The item is visible but not
   pretending to be active.

## What The Roadmap Does Not Do

- It does not promise dates.
- It does not promise specific implementations of any item.
- It does not let items enter without `RESEARCH-*` provenance.
- It does not let items invent categories or statuses.
- It does not silently delete items — `rejected` and `deferred` are
  explicit terminal-or-paused states with reasons.
- It does not allow circular or self-referencing dependencies.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Backlog item shape | `F-CAP-001` + `tables/backlog-items.yaml` |
| Priority taxonomy | `F-CAP-002` |
| Status lifecycle | `F-CAP-003` + graduation contract |
| Category taxonomy | `F-CAP-004` |
| Dependency rules | `F-CAP-005` |
| Source provenance | `source-registry.md` |
| Status transitions | `graduation-contract.md` + `tables/graduation-log.yaml` |

## Source Basis

- [`.nimi/spec/future/kernel/capability-backlog.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/capability-backlog.md)
- [`.nimi/spec/future/kernel/source-registry.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/source-registry.md)
- [`.nimi/spec/future/kernel/graduation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/graduation-contract.md)
- [`.nimi/spec/future/kernel/tables/backlog-items.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/tables/backlog-items.yaml)
- [`.nimi/spec/future/kernel/tables/graduation-log.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/future/kernel/tables/graduation-log.yaml)
