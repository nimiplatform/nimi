# Runtime Agent Core Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-001 RuntimeAgentCoreService Authority Home

`RuntimeAgentCoreService` is the runtime-owned authority for live agent execution.

It owns:

- agent lifecycle
- agent identity projection
- life state
- autonomy state
- hook scheduling admission
- agent memory policy
- agent event emission

It consumes `RuntimeCognitionService` plus retained runtime-private memory depth
and must not be collapsed into a cognition or memory engine.

## K-AGCORE-002 Chat Track / Life Track Split

`RuntimeAgentCoreService` must maintain two distinct execution tracks:

- `Chat Track`
  - reactive
  - driven by user/app interaction
  - consumes thread continuity and agent projections
- `Life Track`
  - proactive
  - driven by runtime-owned hook admission
  - consumes life state, memory recall, world context, and autonomy policy

The two tracks may share agent state and memory policy, but they must not collapse into a single undifferentiated scheduling surface.

## K-AGCORE-003 Typed Next-Hook Intent

Life Track model output may not emit free-form execution logic.

It must emit typed next-hook intent only. Trigger kinds are defined by `tables/runtime-memory-hook-trigger.yaml`.

Fixed rules:

- host-owned scheduler/admission is the only scheduling authority
- model output may request a typed intent, not executable logic
- scheduler owns timing, admission, cancellation, and budget checks
- active chat continuity may delay or suppress life hooks, but that suppression remains host-owned
- admitted implementation-facing transport must expose typed trigger-detail and next-hook-intent families with one branch per admitted trigger kind rather than a generic scheduler blob

## K-AGCORE-004 Agent Canonical Memory Policy

`RuntimeAgentCoreService` is the semantic owner of canonical agent memory.

It decides:

- which events may become canonical memory
- which canonical class applies
- which bank scope may be written
- which memory layers may be recalled for agent execution

Fixed rules:

- canonical classes continue to align to Realm `PUBLIC_SHARED`, `WORLD_SHARED`, and `DYADIC`
- infra scopes wider than canonical classes must not be reinterpreted as canonical memory by apps
- `RuntimeCognitionService` serves the runtime-facing overlap slice, while
  retained runtime-private memory depth stores canonical truth; in both cases
  `RuntimeAgentCoreService` owns semantic admission

## K-AGCORE-005 App Consumer Boundary

Apps consume `RuntimeAgentCoreService` as controllers and projection readers.

Apps may:

- initialize agents
- read state and memory projections
- read runtime-owned `AgentPresentationProfile` projection
- update state through admitted commands
- configure autonomy
- subscribe to agent events

Apps may not:

- own renderer-local canonical agent identity
- own renderer-local canonical memory truth
- directly schedule life-track execution
- directly mutate canonical agent bank scopes through Memory Service
- write thread-local avatar interaction state back as runtime-owned presentation truth

## K-AGCORE-006 Public Surface

`RuntimeAgentCoreService` admits the following public operations:

- `InitializeAgent`
- `TerminateAgent`
- `GetAgent`
- `ListAgents`
- `GetAgentState`
- `UpdateAgentState`
- `EnableAutonomy`
- `DisableAutonomy`
- `SetAutonomyConfig`
- `ListPendingHooks`
- `CancelHook`
- `QueryAgentMemory`
- `WriteAgentMemory`
- `SubscribeAgentEvents`

Primary semantic outputs on this surface must use Nimi-owned typed messages:

- hook trigger detail must remain typed rather than free-form execution payload
- recalled agent memory must project typed memory records rather than raw provider JSON
- `QueryAgentMemory` may expose additive narrative projections, but it must not expose admitted truth state or behavioral posture as public wire truth
- when `QueryAgentMemory` exposes a stale narrative projection, the stale marker must remain explicit; Agent Core must not collapse stale narrative context into admitted truth state
- agent events must expose explicit failure / reschedule / budget states as typed event kinds
- dynamic envelopes remain limited to auxiliary details / extensions fields
- implementation-facing transport must distinguish read projections from mutation commands; public agent state mutation may not devolve into arbitrary blob replacement
- implementation-facing transport must reserve typed families for `NextHookIntent`, `HookOutcome`, canonical memory candidate/view, and constrained state mutation payloads
- admitted implementation-facing transport must expose hook outcome detail as typed completed / failed / canceled / rescheduled / rejected families, and app-facing state mutation as a typed command/patch union rather than full-state replacement
- no public Agent Core method may admit proactive initiate-chat, public truth read/write, or public posture mutation unless a later rule explicitly admits those surfaces
- runtime-owned `AgentPresentationProfile` projection may be exposed on agent read surfaces, but transient avatar/session state must remain out of the public runtime truth model

Typed family registry is defined by `tables/runtime-agent-core-typed-family.yaml`.

## K-AGCORE-007 Token Budget Authority

`RuntimeAgentCoreService` owns token budget policy for Life Track autonomy.

Fixed rules:

- token budget configuration is runtime-owned and belongs to agent autonomy state
- token budget remains a quota and safety guardrail, not the primary cadence truth
- budget state must be observable through agent state or agent events; hidden depletion is not admitted
- the default budget window is daily unless a stricter runtime-owned policy is admitted elsewhere
- budget exhaustion suspends or rejects Life Track execution only; Chat Track remains separately governed by runtime product policy
- model output must not mutate budget truth directly

## K-AGCORE-008 Failure Semantics

`RuntimeAgentCoreService` must fail-close on substrate unavailability and keep hook outcomes observable.

Fixed rules:

- agent initialization requires runtime-owned local prerequisites to be
  available; if Agent Core cannot rely on `RuntimeCognitionService`, retained
  runtime-private memory depth, or the required local substrate, the call must
  fail with `UNAVAILABLE`
- the required local memory substrate boundary referenced here is the runtime-private contract in `K-MEMSUB-*`, not a public local-engine target
- Realm replication unavailability does not authorize pseudo-success; initialization may proceed only when local bootstrap truth is sufficient and pending replication remains observable
- Life Track model failure, memory write failure, or scheduler admission failure must produce an observable agent event or reasoned rejection
- pending hooks may be rescheduled or canceled explicitly, but they must not disappear silently after a failed life-turn attempt

## K-AGCORE-009 Hook Lifecycle Store

`RuntimeAgentCoreService` must keep hook lifecycle truth in a runtime-owned store.

It owns:

- admitted pending-hook persistence
- status transitions for `pending`, `running`, `completed`, `failed`, `canceled`, `rescheduled`, and `rejected`
- host-owned cancellation checks
- life-track execution-state projection derived from hook lifecycle truth

Fixed rules:

- `ListPendingHooks` must read from runtime-owned hook state, not from caller-supplied projection or ephemeral renderer memory
- `CancelHook` may only transition hooks that remain host-cancelable; terminal hook outcomes must stay immutable
- typed `next-hook intent` and typed trigger detail must be validated before a hook becomes admitted scheduler truth
- hook status transitions must persist before event publication so that replayed event cursors and hook listing observe the same committed truth
- runtime may keep terminal hook outcomes visible for audit/history, but active hook visibility must remain distinguishable from terminal outcomes

## K-AGCORE-010 Agent Event Stream Source

`SubscribeAgentEvents` must stream from a runtime-owned committed agent event log.

Fixed rules:

- lifecycle, hook, memory, budget, and replication events must be appended only after the corresponding runtime-owned state transition or admission outcome is committed
- cursor resume semantics must read from the committed event log rather than re-synthesizing events from current snapshots
- hook-related events must originate from hook lifecycle transitions, not from thin wrappers around RPC responses
- subscriber filtering may narrow delivery, but it must not invent missing hook outcomes or hide committed cancellation / failure / reschedule events

## K-AGCORE-011 WORLD_SHARED Runtime Admission Boundary

`RuntimeAgentCoreService` may admit `WORLD_SHARED` canonical memory only when runtime-owned world context is sufficiently typed for the bank owner contract.

Fixed rules:

- runtime-owned admission requires explicit `world_id` truth matching the `WORLD_SHARED` bank owner shape
- runtime must not infer an extra owner dimension from account, app, or renderer-local context
- when runtime-owned world context has not yet been admitted on the Agent Core path, `WORLD_SHARED` query/write behavior must remain fail-closed inside runtime
- deferring `WORLD_SHARED` on the runtime path does not authorize app, SDK, or Realm bypasses for canonical agent writes

## K-AGCORE-012 Life Track Runtime Loop

`RuntimeAgentCoreService` owns the internal Life Track execution loop as a runtime-private lifecycle, not as an app-facing RPC surface.

Fixed rules:

- the loop must scan committed hook store truth rather than caller-provided snapshots
- due-hook execution must emit outcomes and events through the same committed hook store and committed event log path used by public read surfaces
- the loop must be startable and stoppable with daemon lifecycle so shutdown does not leave hidden background execution running
- when runtime has not yet admitted a concrete Life Track executor, due hooks must fail closed with an explicit terminal rejection or failure outcome rather than silent retention or pseudo-success
- host-owned trigger admission remains authoritative; non-admitted trigger timing must not be synthesized into immediate execution inside the loop

## K-AGCORE-013 Runtime-Private Life Turn Executor

`RuntimeAgentCoreService` may execute Life Track turns through an in-process runtime-private executor.

It owns:

- hook gate and scheduler truth
- admitted Life Turn input assembly
- canonical memory admission and write projection
- status projection mutation
- budget accounting
- committed event emission

The AI layer may supply model execution only. It does not own scheduler truth, agent truth, memory truth, or public agent contracts.

Fixed rules:

- the admitted runtime-private Life Turn request must include committed `AgentRecord`, committed `AgentStateProjection`, the triggering `PendingHook`, admitted canonical recall set, and autonomy snapshot
- the admitted runtime-private Life Turn result is limited to `status_text` diff, canonical memory candidates, typed `next_hook_intent`, summary, and token usage
- the runtime-private executor must not admit arbitrary attribute mutation, free-form hook logic, direct world/user state mutation, or proactive app-facing initiate-chat semantics
- canonical memory candidates returned by the executor must still pass Agent Core owned canonical class and bank-scope admission before Memory Service writes occur
- typed `next_hook_intent` returned by the executor must still pass the same runtime-owned validator and hook-admission path used elsewhere on Agent Core
- invalid executor output must fail closed with observable terminal hook failure rather than implicit completion, pseudo-success, or silent drop

## K-AGCORE-014 Replication Event Projection Source

`RuntimeAgentCoreService` must project replication events from the committed
retained runtime-private memory replication update source.

Fixed rules:

- `AGENT_EVENT_TYPE_REPLICATION` must derive from committed `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` events rather than from immediate write-result decoration or snapshot inference
- Agent Core may project only canonical bank scopes admitted on its public path; infra-scope memory banks must not synthesize canonical agent replication events
- `AGENT_CORE` and `AGENT_DYADIC` replication updates project to the owning `agent_id`
- `WORLD_SHARED` replication updates project to agents whose committed `active_world_id` matches the world-scoped bank owner
- Agent Core cursor replay and live subscription must observe the same replication event ordering as the committed memory replication source after Agent Core projection commit

## K-AGCORE-015 Runtime-Private Behavioral Posture Truth

`RuntimeAgentCoreService` owns behavioral posture as runtime-private machine truth for live agent execution.

It owns:

- committed posture state
- posture validation
- truth-basis binding
- chat-track and life-track posture transitions
- projection of posture into human-readable state text

It does not own:

- public renderer-local posture truth
- Memory Service storage for admitted truths

Fixed rules:

- behavioral posture must remain distinct from `AgentStateProjection.status_text`; `status_text` is a projection, not the authoritative posture state
- posture truth must retain explicit linkage to the admitted truth ids that constrain it when such linkage is present
- chat-track and life-track outputs may propose posture mutation only through admitted runtime-private typed contracts validated by Agent Core
- invalid posture output must fail closed rather than silently mutating committed state
- behavioral posture remains outside the public Agent Core RPC surface unless a later rule explicitly admits it

## K-AGCORE-016 Canonical Review Ownership

`RuntimeAgentCoreService` owns canonical review for agent-facing memory scopes.

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

- canonical review for `AGENT_CORE`, `AGENT_DYADIC`, and admitted `WORLD_SHARED` scopes must execute through an Agent Core owned runtime-private review path
- retired public `Reflect` semantics on the runtime cognition cutover path must
  not be reintroduced as the canonical review scheduler by implication
- canonical review must use a dedicated runtime-private review executor contract rather than extending the admitted `Life Turn` result contract
- admitted review output is limited to narrative candidates, truth candidates, optional relation candidates, summary, token usage, and review-window metadata
- extracting review storage mechanics into a runtime-owned internal memory library does not transfer review ownership, scheduling, admission policy, or recovery semantics away from Agent Core
- truth candidate admission and conflict handling remain Agent Core owned even when Memory Service persists the resulting state

## K-AGCORE-017 Runtime-Private Chat Track Sidecar Contract

`RuntimeAgentCoreService` may consume a runtime-private sidecar result from Chat Track execution.

Fixed rules:

- sidecar parsing and validation must remain runtime-owned; renderer or client code must not become the semantic owner of sidecar payloads
- admitted sidecar output is limited to posture patch, hook cancellations, typed `next_hook_intent`, and canonical memory candidates
- sidecar output must not admit proactive initiate-chat semantics, arbitrary state mutation, direct world/user mutation, or free-form scheduling logic
- typed `next_hook_intent` and canonical memory candidates returned by the sidecar must pass the same runtime-owned validators used elsewhere on Agent Core
- invalid sidecar output must fail closed without silently mutating committed posture, hooks, or memory truth

## K-AGCORE-018 Runtime-Private Canonical Truth Read Boundary

`RuntimeAgentCoreService` must consume admitted truth and review-input data
through a runtime-private typed read boundary provided by retained
runtime-private memory depth.

Fixed rules:

- Agent Core must not read admitted truths, narrative context, canonical review inputs, or review checkpoints by direct database access
- runtime-private truth read surfaces must return typed runtime contract data rather than raw store rows or provider-native blobs
- Agent Core must continue to consume this boundary through the retained
  runtime-private memory facade even if the underlying mechanics are implemented
  by a runtime-owned internal library
- prompt assembly may inject admitted truths and narrative context from this runtime-private read path, but that does not create a public truth API

## K-AGCORE-019 Canonical Review Coordination Model

`RuntimeAgentCoreService` owns cross-owner coordination for canonical review
runs, while retained runtime-private memory depth owns atomic persistence of
memory state.

Fixed rules:

- Agent Core must submit canonical review outcomes through a single runtime-private commit request identified by `review_run_id`
- Memory Service must commit all review-owned narrative / truth / lineage mutations atomically and idempotently for that `review_run_id`
- Agent Core must publish follow-up checkpoint, hook, or event truth only after the Memory Service commit succeeds
- internal library extraction must preserve this dual-phase coordination model rather than collapsing Agent Core into direct store mutation or distributed-transaction coupling
- Agent Core recovery and coordination must not absorb backlog/replay ownership or mutate pending replay truth outside the Memory Service owned boundary, even when internal helper extraction changes where storage mechanics live
- the admitted coordination model is idempotent dual-phase coordination, not distributed transaction coupling

## K-AGCORE-020 Chat/Life Evidence To Canonical Memory Admission Boundary

`RuntimeAgentCoreService` owns the runtime-private stabilization boundary between
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

- chat transcript, thread continuity, and life-turn conversational evidence are
  source evidence inputs, not canonical memory truth by default
- runtime-private chat-sidecar and life-turn outputs may emit canonical memory
  candidates only after Agent Core owned stabilization over the current evidence
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

`RuntimeAgentCoreService` may consume standalone cognition through explicit bridge paths, but it does not own cognition semantics.

Fixed rules:

- agent core remains the runtime owner of live agent execution, canonical admission, and runtime-private posture/hook truth
- if runtime consumes standalone cognition kernels, prompt context, or advisory outputs, that consumption must remain adapter-owned rather than semantic ownership
- cognition runtime bridge and prompt-serving boundaries are governed by `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`, `.nimi/spec/cognition/kernel/prompt-serving-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`
- agent core must not redefine cognition object model, cleanup semantics, or standalone public surface by implementation convention
- runtime/private cognition consumption does not authorize collapsing cognition authority back into runtime contracts

## K-AGCORE-027 Life-Track Cadence Ownership

`RuntimeAgentCoreService` owns proactive Life Track cadence as runtime-owned
scheduler truth.

It owns:

- explicit opt-in autonomy mode for proactive Life Track execution
- baseline cadence tick policy
- host-owned reconciliation between cadence tick and typed next-hook timing
- hook cadence-interaction semantics for long-running hooks
- spacing, suspension, and budget gates applied after cadence selection

It does not own:

- Desktop-only preset truth for cadence mode
- renderer-local scheduling logic
- provider/model-owned scheduling logic

Fixed rules:

- proactive Life Track execution must remain explicit opt-in and default-off
- admitted runtime-owned autonomy mode is bounded to `off`, `low`, `medium`,
  and `high` unless a later rule admits a wider family
- cadence and quota must remain distinct concerns; token budget is not primary
  frequency truth
- typed `next_hook_intent` may request callback timing, but host runtime
  remains the only owner of effective next-run computation
- admitted hook cadence interaction must remain typed rather than a freeform
  boolean or scheduler blob
- long-running hook suppression may delay baseline cadence tick only through
  admitted hook cadence interaction semantics validated by Agent Core
- `min_hook_interval` or its admitted successor remains a hard lower-bound
  spacing gate after cadence and callback timing are reconciled
- Chat Track remains reactive and available regardless of proactive Life Track
  cadence mode
