# Truth

Truth is the canonical definition of a world: the rules, the
agents, the projections. Truth is creator-governed, versioned,
atomic, auditable. Apps and agents read truth; only authorized
creator tooling mutates it.

## What Truth Carries

| Concept | Purpose |
| --- | --- |
| `WorldRule` | A rule of the world authored by the creator |
| `AgentRule` | Agent truth bound to a world scope |
| `WorldRelease` | The official anchor of any world publish |
| `CanonicalTruthPackage` | The official upstream truth ingress object |
| Projection inputs | What read views the world supports |
| Governance / release metadata | Version, provenance, audit |

Truth is **creator-governed**. Apps and agents can read it; only
creator tooling (with appropriate authorization) can mutate it.
A runtime story execution can never silently mutate truth. An
app's narrative archive must be app-owned, not Realm-canonical.

## WorldRelease

A release is the atomic transactional commit that publishes a
world.

| Field | Purpose |
| --- | --- |
| Package version | Which version of the package this is |
| Provenance | Who released, with what tooling |
| Checksum | Verifiable hash |
| Diff metadata | What changed from the prior release |
| Rollback lineage | What this release succeeds, what it can roll back to |

Rollback is a release operation, not an ad hoc rewrite. A bad
release is rolled back by issuing another release that references
back; the bad release is not deleted from history; it is
superseded.

## CanonicalTruthPackage

The package distinguishes:

| Component | Purpose |
| --- | --- |
| Canonical truth units | World rules, agent rules, scene rules, etc. |
| Derivation / inheritance inputs | How world truth constrains agent truth |
| Projection inputs | What read views the world supports |
| Governance / release metadata | Version, provenance, audit |

Lorebook text and prompt payloads are **never the package's
canonical center**. They may be inputs to projection but are not
truth on their own.

## InheritanceLink

`InheritanceLink` is the formal derivation edge from world truth
to agent truth.

| Field | Purpose |
| --- | --- |
| Source | World truth scope |
| Target | Agent truth scope constrained |
| Materialization | How the edge appears in the host layer |

This is what makes "this agent is a citizen of this world" a real
typed relationship rather than a convention. Agents inheriting
truth from a world keep their constraints visible.

## Worldview, Lorebook, Browse DTOs

Truth is read through projections. The projection layer does not
expose raw truth; it exposes admitted projection shapes.

| Projection | What it reveals |
| --- | --- |
| `detail-with-agents` | Public read aggregate; may expose `activeRuleCount` or `agentRuleSummary` |
| Worldview | Read-aggregate projection |
| Lorebook | Selected lore content |

Projections do **not** expose raw `AgentRule` content. The
projection layer is intentionally narrow.

## Reader Scenario: A Creator Authors World Truth

A creator writes the rules, agents, and scenes for a world.

1. **Author truth artifacts.** World rules, agent rules with
   inheritance links, scene rules.
2. **Stage as drafts.** Local working set: `truthDraft`,
   `stateDraft`, `historyDraft`.
3. **Bundle into CanonicalTruthPackage.** Truth units +
   derivation inputs + projection inputs + governance metadata.
4. **Publish atomically as `WorldRelease`.** Truth is frozen with
   provenance and rollback lineage.
5. **World becomes a destination.** Apps can read truth via
   admitted projections; agents bound by `AgentRule` are part of
   the world.

The atomic transactional shape is the key property. Half-published
worlds are not admitted.

## Reader Scenario: Truth Is Not An App's Narrative Archive

Suppose an app wants to build a long-form narrative archive
of what happened in a world.

- The narrative archive is **app-owned**, not Realm-canonical.
  Realm truth is the canonical world definition; story execution
  output is not truth by default.
- The app can store its narrative under app-private state, or
  under an admitted Realm asset, or as a content document — but
  not as Realm-canonical truth.
- A creator who wants part of the narrative to be canonical must
  promote it through admitted truth-publish flow (creator tooling
  + WorldRelease).

This separation matters because Realm truth is platform-canonical;
narrative is app-specific. Mixing them would let any app silently
rewrite world rules.

## Source Basis

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/tables/truth-contract.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/truth-contract.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)
- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
