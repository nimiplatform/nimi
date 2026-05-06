# Runtime Bridge

The runtime bridge is the **typed seam** through which Runtime
consumes Cognition. It is consumption, not absorption. Runtime
can read Cognition's surfaces; Cognition's authority remains its
own.

## What The Bridge Does

| Concern | Behavior |
| --- | --- |
| Runtime reads Cognition memory | Through admitted bridge surface |
| Runtime reads Cognition knowledge | Through admitted bridge surface |
| Runtime reads Cognition skills | Through admitted bridge surface |
| Runtime reads Cognition prompt service | Through admitted bridge surface |
| Authority transfer | None — Cognition stays the authority |

The bridge is the runtime-facing republication of cognition
surfaces. `RuntimeCognitionService` is the runtime side; the
bridge contract defines what runtime is allowed to consume.

## Why Bridge, Not Absorb

If Runtime absorbed Cognition's authority, two things break:

- **Standalone use.** A project using only `nimi-cognition` (no
  runtime) loses authority alignment.
- **Authority drift.** Runtime would silently extend or alter
  Cognition's contracts.

With a typed bridge:

- Cognition is admitted as standalone authority.
- Runtime consumes through admitted surface.
- Both projects evolve independently with bridge contract as the
  invariant.

## Bridge Boundary Table

| Concern | Owner |
| --- | --- |
| Cognition object model | Cognition |
| Runtime memory bank scopes | Runtime |
| Runtime-facing republication | Runtime (`RuntimeCognitionService`) |
| Bridge surface contract | `runtime-bridge-contract.md` (kernel) |
| Authority for bridge admission | Cognition kernel |

The bridge is **bounded** — Runtime cannot consume everything in
Cognition; it consumes the admitted bridge surface.

## RuntimeCognitionService

`RuntimeCognitionService` is the runtime-facing republication
surface for overlap memory / knowledge semantics.

| Property | Value |
| --- | --- |
| Owner | Runtime |
| Source authority | Cognition |
| Consumed surfaces | Memory, knowledge, prompt serving (admitted) |
| Retained runtime-private depth | Runtime keeps canonical truth for its bank scopes |

Runtime memory has its own canonical truth (per bank scopes).
Cognition memory has its own canonical truth (per scope-bound
substrate). The bridge unifies the read surfaces; the canonical
truth stays where it lives.

## Reader Scenario: An Agent Recalls Memory Through The Bridge

An agent's runtime turn needs memory.

1. **Runtime turn execution.** RuntimeAgentService asks for
   memory.
2. **Bridge consults Cognition.** Through `RuntimeCognitionService`,
   memory is queried.
3. **Cognition Memory Service responds.** Typed memory records
   under admitted surface.
4. **Runtime composes.** Agent's Brain layer uses recalled
   memory.
5. **No authority transfer.** Cognition's memory authority stays
   in Cognition; Runtime did not become the memory authority.

The runtime is the consumer; cognition is the authority.

## Reader Scenario: A Runtime Memory Write Replicates To Realm

The bridge interacts with Runtime's own memory replication.

1. **Runtime memory write.** Agent writes to `AGENT_CORE` bank.
2. **Replicates to Realm.** Per Runtime's replication state.
3. **Bridge to Cognition (when host product wires it).** The
   same memory record can be projected to a cognition memory
   artifact via admitted projection.
4. **Replication state explicit.** `pending → synced | conflict
   | invalidated` at every layer.

The same memory record can be a runtime canonical record, a
realm-replicated record, and a cognition memory artifact —
under admitted replication / projection contracts.

## Reader Scenario: Cognition Without Runtime

A project uses only `nimi-cognition` for an AI agent that has no
runtime.

1. **Cognition standalone.** `nimi-cognition` builds, tests, and
   runs without runtime as a prerequisite.
2. **Memory / knowledge / skill / prompt all available.** Per
   admitted surfaces.
3. **No runtime bridge.** The project does not need to wire the
   bridge.
4. **No runtime memory bank scopes.** Bank scopes are runtime
   concerns; cognition has its own scope model.

Cognition's standalone runnability is structural. The bridge is
opt-in for runtime consumers.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Cognition authority | Cognition kernel |
| Runtime consumer surface | `RuntimeCognitionService` |
| Bridge contract | `runtime-bridge-contract.md` |
| Canonical truth (cognition side) | Cognition substrate |
| Canonical truth (runtime side) | Runtime memory banks + replication |

## Source Basis

- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
