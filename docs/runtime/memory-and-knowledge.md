# Memory And Knowledge

Runtime owns the local memory substrate and the knowledge bank
surface. This page covers how memory and knowledge are stored,
scoped, replicated, and bridged to Cognition.

## Memory Bank Scopes

Memory in Runtime has typed bank scopes:

| Scope | Visibility | Use |
| --- | --- | --- |
| `AGENT_CORE` | Agent's private | Agent's own long-term memory |
| `AGENT_DYADIC` | Per-relationship private | Agent's memory of one specific other being |
| `WORLD_SHARED` | Visible inside one world | World-local shared memory |
| `APP_PRIVATE` | App infrastructure scope | App-side infrastructure |
| `WORKSPACE_PRIVATE` | Workspace infrastructure scope | Workspace-local infrastructure |

`AGENT_CORE` and `AGENT_DYADIC` are world-portable — they travel
with the agent across worlds. `WORLD_SHARED` stays with its world
by design.

Apps can create infra banks (`APP_PRIVATE`, `WORKSPACE_PRIVATE`)
through `CreateBank`. Canonical agent-facing scopes
(`AGENT_CORE`, `AGENT_DYADIC`) are runtime-internal — apps consume
them through admitted contracts, not by direct creation.

## Memory Substrate

The **memory substrate** is the runtime-private contract that binds
bank truth to an underlying memory provider implementation.

| Property | Value |
| --- | --- |
| Default substrate | `Hindsight` (experimental) |
| Default mode | Supervised, with embedding routed through llama loopback |
| Default provider admission | None — memory is opt-in |

Runtime ships with **no default memory provider**. The user (or
host product) must enable memory explicitly. If enabled without an
override, the substrate runs `Hindsight` in supervised mode.

This opt-in posture matters: memory is consequential. The platform
does not silently start storing things; the user grants permission
explicitly.

## Replication

Runtime memory replicates to Realm with explicit states:

| State | Meaning |
| --- | --- |
| `pending` | Awaiting replication |
| `synced` | Replicated to Realm |
| `conflict` | Conflict detected; cannot serve |
| `invalidated` | Realm governance invalidated cached memory; runtime cannot continue serving |

Realm governance can invalidate cached memory. Runtime cannot
continue serving an invalidated record — the contract is
fail-closed.

Apps that want to know whether a memory write was durable read the
replication state. A `pending` write is admitted but not yet
durable; a `synced` write is durable; a `conflict` or
`invalidated` state means the write needs reconciliation before
serving continues.

## Knowledge Banks

Knowledge banks are runtime-local typed knowledge pages with
keyword search, ingest lifecycle, and explicit page lifecycle.

| Concept | What it is |
| --- | --- |
| Bank | Named container of pages |
| Page | Typed knowledge unit with content + metadata |
| Ingest | The lifecycle of bringing content in |
| Keyword search | Bounded query surface over bank pages |

Knowledge pages have admitted lifecycle states; pages do not exist
"halfway between." Apps consume knowledge through admitted query
surfaces.

## RuntimeCognitionService Family

Runtime-facing memory and knowledge are republished through the
absorbed `RuntimeCognitionService` family. This is the runtime
side of the bridge to standalone Cognition.

| Concept | What it covers |
| --- | --- |
| `RuntimeCognitionService` | Runtime's view of memory + knowledge |
| Bridge contract | How Runtime consumes standalone Cognition |
| Upgrade contract | How capability upgrades flow without absorbing authority |

Runtime can bridge to standalone Cognition for memory and
knowledge — that is consumption, not absorption. Cognition's
authority remains its own. If Runtime has no Cognition installed,
runtime-internal memory and knowledge still work.

## Reader Scenario: Memory Opt-In Flow

A user installs Nimi and creates an agent. Memory is off by
default.

1. **Agent created.** No memory provider is admitted.
2. **User enables memory.** Through CLI or Desktop runtime
   config, the user opts in.
3. **Substrate boots.** Default `Hindsight` substrate runs in
   supervised mode.
4. **Embedding route.** Embedding routes through llama loopback
   (or an admitted alternative if configured).
5. **Memory writes admitted.** The agent can now write to its
   `AGENT_CORE` bank. Writes replicate to Realm under typed
   states.
6. **Memory reads admitted.** The agent can recall its memory in
   subsequent turns.

The user explicitly granted memory; no silent storage happened
before that.

## Reader Scenario: Memory Replication Conflict

An agent writes a memory that conflicts with Realm-side
governance — perhaps a delegated path attempted to promote
non-canonical memory to canonical.

1. **Local write admitted.** Runtime accepts the write into the
   appropriate bank scope.
2. **Replication starts.** State moves to `pending`.
3. **Realm governance refuses.** State moves to `conflict`.
4. **Runtime cannot serve.** A `conflict` state means runtime
   cannot continue serving this memory record.
5. **Reconciliation required.** The agent's memory is
   reconciled — either the write is rolled back, or governance
   admits the write under amended terms.

A conflict does not silently overwrite Realm. A conflict does
not silently invalidate the local write either. Reconciliation is
explicit.

## Reader Scenario: Knowledge Ingest

A user ingests a set of documents into a knowledge bank for an
agent.

1. **Bank created.** Apps create the bank under the appropriate
   scope.
2. **Ingest pipeline.** Documents are parsed; pages are created
   under typed page lifecycle.
3. **Pages admitted.** Each page passes admitted ingest gates.
4. **Search available.** Keyword search surface is admitted over
   the bank's pages.
5. **Query.** The agent (or app) queries the bank; results are
   typed.

The ingest pipeline is bounded by admitted contracts; an
arbitrary ingest path is not admitted.

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
