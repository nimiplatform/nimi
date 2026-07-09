# Runtime Agent Canonical Memory Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent canonical review, truth read, coordination, and chat/life evidence admission authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-016 Canonical Review Ownership

`RuntimeAgentService` owns canonical review for agent-facing memory scopes.

It owns:

- review scheduling
- review token-budget admission
- review trigger policy
- review executor selection
- truth candidate admission and supersession policy

It does not own:

- public Memory Service `Reflect` semantics
- Memory Service storage and cascade of admitted derived outputs

Fixed rules:

- canonical review for `AGENT_CORE`, `AGENT_DYADIC`, and admitted `WORLD_SHARED` scopes must execute through a RuntimeAgentService-owned runtime-private review path
- retired public `Reflect` semantics on the runtime cognition cutover path must
  not be reintroduced as the canonical review scheduler by implication
- canonical review must use a dedicated runtime-private review executor contract rather than extending the admitted `Life Turn` result contract
- admitted review output is limited to narrative candidates, truth candidates, optional relation candidates, summary, token usage, and review-window metadata
- the model-facing canonical review executor output contract is the APML
  `<canonical-review>` root admitted by `agent-output-wire-contract.md`; JSON
  executor output compatibility is not admitted
- extracting review storage mechanics into a runtime-owned internal memory library does not transfer review ownership, scheduling, admission policy, or recovery semantics away from RuntimeAgentService
- truth candidate admission and conflict handling remain RuntimeAgentService-owned even when Memory Service persists the resulting state

## K-AGCORE-016a Canonical Review Status Projection

`RuntimeAgentService` admits a narrow read-only canonical review status
projection for agent-facing memory banks.

It may project:

- the validated canonical bank locator
- whether the Runtime-owned canonical review executor is currently available
- the last committed review follow-up id, checkpoint basis, and completion time
- the next eligibility time derived from Runtime-owned review cadence policy
- whether a recoverable runtime review run currently blocks fresh scheduling

Fixed rules:

- this projection is bank-level scheduler/follow-up observability, not a
  per-memory-record review truth field
- the projection must derive from RuntimeAgentService-owned review persistence,
  committed follow-up rows, and review cadence constants; SDKs and apps must
  not derive equivalent status from memory metadata, summaries, timestamps,
  UI state, or app-local caches
- the projection must not expose admitted truth state, narrative bodies,
  prepared review outcomes, or model-facing canonical review input/output
  payloads
- no mutation, redaction, forget, retire, or review execution command is
  admitted by this read surface
- recoverable `prepared` / `memory_committed` review runs must be explicit
  blocking state rather than hidden as ordinary eligibility or pseudo-success
- missing canonical bank state must be explicit `BANK_UNAVAILABLE` readiness
  rather than causing callers to synthesize lifecycle state

## K-AGCORE-017 Runtime-Private Chat Track Sidecar Contract

`RuntimeAgentService` may consume a runtime-private sidecar result from Chat Track execution.

Fixed rules:

- sidecar parsing and validation must remain runtime-owned; renderer or client code must not become the semantic owner of sidecar payloads
- admitted sidecar output is limited to posture patch, emotion update, hook
  cancellations, typed `HookIntent`, and canonical memory candidates
- the model-facing sidecar executor output contract is the APML
  `<chat-track-sidecar>` root admitted by `agent-output-wire-contract.md`; JSON
  executor output compatibility is not admitted
- sidecar output must not admit proactive initiate-chat semantics, arbitrary state mutation, direct world/user mutation, or free-form scheduling logic
- typed `HookIntent` and canonical memory candidates returned by the sidecar
  must pass the same runtime-owned validators used elsewhere on
  RuntimeAgentService
- invalid sidecar output must fail closed without silently mutating committed posture, hooks, or memory truth

## K-AGCORE-018 Runtime-Private Canonical Truth Read Boundary

`RuntimeAgentService` must consume admitted truth and review-input data
through a runtime-private typed read boundary provided by retained
runtime-private memory depth.

Fixed rules:

- RuntimeAgentService must not read admitted truths, narrative context, canonical review inputs, or review checkpoints by direct database access
- runtime-private truth read surfaces must return typed runtime contract data rather than raw store rows or provider-native blobs
- RuntimeAgentService must continue to consume this boundary through the retained
  runtime-private memory facade even if the underlying mechanics are implemented
  by a runtime-owned internal library
- prompt assembly may inject admitted truths and narrative context from this runtime-private read path, but that does not create a public truth API

## K-AGCORE-019 Canonical Review Coordination Model

`RuntimeAgentService` owns cross-owner coordination for canonical review
runs, while retained runtime-private memory depth owns atomic persistence of
memory state.

Fixed rules:

- RuntimeAgentService must submit canonical review outcomes through a single runtime-private commit request identified by `review_run_id`
- Memory Service must commit all review-owned narrative / truth / lineage mutations atomically and idempotently for that `review_run_id`
- RuntimeAgentService must publish follow-up checkpoint, hook, or event truth only after the Memory Service commit succeeds
- internal library extraction must preserve this dual-phase coordination model rather than collapsing RuntimeAgentService into direct store mutation or distributed-transaction coupling
- RuntimeAgentService recovery and coordination must not absorb backlog/replay ownership or mutate pending replay truth outside the Memory Service owned boundary, even when internal helper extraction changes where storage mechanics live
- the admitted coordination model is idempotent dual-phase coordination, not distributed transaction coupling

## K-AGCORE-020 Chat/Life Evidence To Canonical Memory Admission Boundary

`RuntimeAgentService` owns the runtime-private stabilization boundary between
chat/life conversational evidence and canonical memory candidate admission.

It owns:

- evidence-to-candidate stabilization for chat-track and life-track outputs
- same-window correction absorption before durable candidate admission
- candidate-level distinction between transient conversational evidence and
  stable canonical memory proposal

It does not own:

- direct persistence of raw chat transcript as canonical memory truth
- retained runtime-private memory dedup mechanics or downstream storage behavior
- truth-level supersession once conflicting durable memory has already been
  committed across separate windows

Fixed rules:

- chat transcript, conversation continuity, and life-turn conversational evidence are
  source evidence inputs, not canonical memory truth by default
- runtime-private chat-sidecar and life-turn outputs may emit canonical memory
  candidates only after RuntimeAgentService-owned stabilization over the current evidence
  window
- explicit same-window self-correction or contradiction must not by default be
  emitted as two conflicting durable canonical memory candidates from the same
  evidence window
- candidate `source_event_id` and provenance preserve evidence lineage, but
  they do not imply that every intermediate utterance becomes durable memory
  truth
- retain-time dedup remains a downstream concern over stabilized candidates; it
  must not become the primary owner of immediate conversational correction
- truth admission, stale/supersession, and later derived projection updates
  remain the downstream path for cross-window correction after durable memory
  has already been committed

## K-AGCORE-021 Standalone Cognition Consumption Boundary

`RuntimeAgentService` may consume standalone cognition through explicit bridge paths, but it does not own cognition semantics.

Fixed rules:

- RuntimeAgentService remains the runtime owner of live agent execution, canonical admission, and runtime-private posture/hook truth
- if runtime consumes standalone cognition kernels, prompt context, or advisory outputs, that consumption must remain adapter-owned rather than semantic ownership
- cognition runtime bridge and prompt-serving boundaries are governed by `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`, `.nimi/spec/cognition/kernel/prompt-serving-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`
- RuntimeAgentService must not redefine cognition object model, cleanup semantics, or standalone public surface by implementation convention
- runtime/private cognition consumption does not authorize collapsing cognition authority back into runtime contracts
