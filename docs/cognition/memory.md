# Memory Service

Cognition Memory Service is the typed memory authority for
standalone agent reasoning. Distinct from Runtime memory bank
scopes (which serve runtime-canonical memory), Cognition memory is
about how an agent **thinks** with its memory — episodic,
semantic, observational records with explicit lifecycle.

## Six Artifact Families In Cognition

Cognition has six top-level artifact families. Memory is one.

| Family | Purpose |
| --- | --- |
| `agent_model_kernel` | The agent's local model of itself |
| `world_model_kernel` | The agent's local model of its world |
| `memory_substrate` | Typed memory records |
| `knowledge_projections` | Typed knowledge pages with first-class relations |
| `skill_artifacts` | Typed advisory bundles (capability blueprints) |
| `working_state` | Transient cognition scaffolding (not durable) |

Memory sits in the **advisory** tier — kernels are core truth;
memory / knowledge / skill are advisory; working state is never
served as truth.

## Memory Operations

| Operation | Behavior |
| --- | --- |
| `Save` | Save a typed memory record |
| `Load` | Load by id |
| `List` | List under typed filter |
| `Search` | Search under admitted query |
| `Delete` | Explicit delete (not silent decay) |
| History / lineage | Read history of memory record changes |
| Derived view | Read service-derived metadata views |

Service-derived metadata (support, lineage, invalidation,
cleanup) is **service-owned**, not caller-persisted. Apps don't
construct metadata themselves; they read service-derived views.

## Cognition Scope

Every cognition artifact belongs to **exactly one scope**. One
scope contains exactly one `agent_model_kernel` + one
`world_model_kernel`. Deleting a scope removes scope-owned
artifacts.

| Property | Value |
| --- | --- |
| Scope cardinality | One agent kernel + one world kernel per scope |
| Cross-scope references | Forbidden |
| Scope deletion | Removes scope-owned artifacts |

A memory record cannot reference an artifact in a different scope;
that would create cross-scope leakage.

## Memory Artifact Lifecycle

| State | Reachable via |
| --- | --- |
| Created | Explicit Save |
| Listed / Recalled | List / Search / Load |
| Derived view read | Service-derived view methods |
| Archived | Digest cleanup pass (reversible) |
| Removed | Later digest pass after archival, or explicit destructive delete |

Archive and remove are **separate passes**. Same-pass
archive-and-remove is forbidden — the platform refuses it. This
is what makes archives reversible.

## Reader Scenario: An Agent Saves And Recalls A Memory

An agent learns the user's birthday.

1. **Save.** Agent calls `MemoryService.Save` with a typed
   memory record describing the learning. Service admits.
2. **Service-derived metadata.** The service computes support,
   lineage, etc. Caller does not need to construct these.
3. **Recall later.** Agent searches; the record is returned
   under typed query.
4. **Use in next turn.** Brain layer consumes the recalled
   memory; behavior reflects "I remember your birthday."

The memory is durable; the recall path is typed.

## Reader Scenario: A Digest Pass Archives Stale Memories

The digest routine periodically proposes which memories to clean
up.

1. **Digest scans.** The first admitted routine; acts on
   memory / knowledge / skill (never kernels).
2. **Refgraph reasoning.** Each candidate is checked against the
   refgraph — incoming support, broken refs, dependency health.
3. **Archive proposals.** Stale candidates proposed for
   archival.
4. **Archive (reversible).** Approved candidates archived.
5. **Later pass.** Subsequent digest pass may remove
   already-archived items.
6. **Audit lineage.** Each step is traceable to specific refgraph
   reasoning.

Cleanup is **explainable** — not heuristic. A user (or auditor)
asking "why was this archived" gets a typed answer pointing to
specific broken refs.

## Reader Scenario: An Explicit Delete

A user wants a specific memory to be deleted permanently.

1. **Explicit delete request.** User invokes `MemoryService.Delete`
   on the record id.
2. **Cascade check.** Service checks dependencies; explicit
   delete is destructive.
3. **Removed.** Record is deleted under admitted contract.
4. **Audit.** Deletion event recorded.

Explicit delete is **separate from digest cleanup**. Digest is
proactive cleanup; explicit delete is user-driven destructive.

## Cleanup Eligibility

| Family | Cleanup eligibility |
| --- | --- |
| Kernels (agent / world) | Never |
| Working state | Only via explicit clear |
| Memory / knowledge / skill | Via digest |

Kernels are inviolate. They are core truth; advisory cleanup
never touches them.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Memory records | Cognition Memory Service |
| Service-derived metadata | Service (not caller) |
| Refgraph reasoning | Cognition refgraph |
| Cleanup decisions | Digest routine + admitted policy |
| Cross-scope reference | Forbidden |

## Source Basis

- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/memory-service-operations.yaml)
- [`.nimi/spec/cognition/kernel/tables/artifact-families.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/artifact-families.yaml)
