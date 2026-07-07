# Runtime Agent Service Contract

> Owner Domain: `K-AGCORE-*`

Canonical naming note:

`RuntimeAgentService` is the steady-state design authority name on the canonical
spec path. Implementation-facing proto transport is now required to align to
`RuntimeAgentService`; `RuntimeAgentCoreService` is not an admitted steady-state
transport name.

## K-AGCORE-001 RuntimeAgentService Authority Home

`RuntimeAgentService` is the runtime-owned authority for live agent execution.

It owns:

- agent lifecycle
- agent identity projection
- conversation continuity through runtime-owned `ConversationAnchor`
- life state
- autonomy state
- hook scheduling admission
- agent memory policy
- transient turn/presentation projection
- agent event emission

It consumes `RuntimeCognitionService` plus retained runtime-private memory depth
and must not be collapsed into a cognition or memory engine.

Fixed rules:

- runtime is multi-agent by default and may host multiple live `agent_id`
  lifecycles concurrently
- runtime must not infer or persist any platform-level default/current agent
- every agent-scoped ingress must resolve to explicit `agent_id`; app-local
  current/default/pinned agent selection remains above runtime-owned truth

## K-AGCORE-002 Chat Track / Life Track Split

`RuntimeAgentService` must maintain two distinct execution tracks:

- `Chat Track`
  - reactive
  - driven by user/app interaction
  - consumes conversation-anchor continuity and agent projections
- `Life Track`
  - proactive
  - driven by runtime-owned hook admission
  - consumes life state, memory recall, world context, and autonomy policy

The two tracks may share agent state and memory policy, but they must not collapse into a single undifferentiated scheduling surface.

## K-AGCORE-003 Typed Hook Intent

Life Track model output may not emit free-form execution logic.

It must emit typed `HookIntent` only. Trigger kinds are defined by
`tables/runtime-memory-hook-trigger.yaml`.

Fixed rules:

- host-owned scheduler/admission is the only scheduling authority
- model output may request a typed intent, not executable logic
- scheduler owns timing, admission, cancellation, and budget checks
- active chat continuity may delay or suppress life hooks, but that suppression remains host-owned
- admitted implementation-facing transport must expose typed trigger-detail and
  hook-intent families with one branch per admitted trigger kind rather than a
  generic scheduler blob

## K-AGCORE-004 Agent Canonical Memory Policy

`RuntimeAgentService` is the semantic owner of canonical agent memory.

It decides:

- which events may become canonical memory
- which canonical class applies
- which bank scope may be written
- which memory layers may be recalled for agent execution
- which app-facing canonical memory bank mode/status is exposed
- whether a canonical agent memory bank bind request is admitted

Fixed rules:

- canonical classes continue to align to Realm `PUBLIC_SHARED`, `WORLD_SHARED`, and `DYADIC`
- infra scopes wider than canonical classes must not be reinterpreted as canonical memory by apps
- `RuntimeCognitionService` serves the runtime-facing overlap slice, while
  retained runtime-private memory depth stores canonical truth; in both cases
  `RuntimeAgentService` owns semantic admission
- app-facing canonical memory bank status and bind must go through
  `RuntimeAgentService`; SDK/apps must not compose canonical bank mode from
  editable host config, runtime-private embedding inspect state, or raw
  `GetBank` projections

## K-AGCORE-005 App Consumer Boundary

Apps consume `RuntimeAgentService` as controllers and projection readers.

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

`RuntimeAgentService` admits the following public operations:

- `InitializeAgent`
- `TerminateAgent`
- `GetAgent`
- `ListAgents`
- `OpenConversationAnchor`
- `GetConversationAnchorSnapshot`
- `ListAgentConversationSummaries`
- `RegisterAvatarLiveInstanceBinding`
- `ResolveAvatarLiveInstanceBinding`
- `GetPublicChatSessionSnapshot`
- `GetCompanionParticipationProjection`
- `RequestCompanionParticipation`
- `CancelCompanionParticipation`
- `OpenCompanionParticipationReplay`
- `GetAgentState`
- `UpdateAgentState`
- `EnableAutonomy`
- `DisableAutonomy`
- `SetAutonomyConfig`
- `ListPendingHooks`
- `CancelHook`
- `QueryAgentMemory`
- `WriteAgentMemory`
- `GetAgentCanonicalMemoryBankStatus`
- `RequestAgentCanonicalMemoryBankBind`
- `GetAgentCanonicalMemoryReviewStatus`
- `SubscribeAgentEvents`

Primary semantic outputs on this surface must use Nimi-owned typed messages:

- hook trigger detail must remain typed rather than free-form execution payload
- recalled agent memory must project typed memory records rather than raw provider JSON
- `QueryAgentMemory` may expose additive narrative projections, but it must not expose admitted truth state or behavioral posture as public wire truth
- when `QueryAgentMemory` exposes a stale narrative projection, the stale marker must remain explicit; RuntimeAgentService must not collapse stale narrative context into admitted truth state
- agent events must expose explicit failure / reschedule / budget states as typed event kinds
- app-facing transient turn / presentation / state projections must use the
  stable family-specific envelopes and detail shapes pinned in
  `tables/runtime-agent-event-projection.yaml`
- model-facing agent chat output for the Live2D companion substrate
  continuation is governed by `agent-output-wire-contract.md`; APML output must
  be validated and projected into typed runtime events before apps treat it as
  product truth
- dynamic envelopes remain limited to auxiliary details / extensions fields
- implementation-facing transport must distinguish read projections from mutation commands; public agent state mutation may not devolve into arbitrary blob replacement
- implementation-facing transport must reserve typed families for `HookIntent`,
  `HookOutcome`, canonical memory candidate/view, and constrained state mutation
  payloads
- admitted implementation-facing transport must expose hook outcome detail as typed completed / failed / canceled / rescheduled / rejected families, and app-facing state mutation as a typed command/patch union rather than full-state replacement
- no public RuntimeAgentService method may admit proactive initiate-chat, public truth read/write, or public posture mutation unless a later rule explicitly admits those surfaces
- runtime-owned `AgentPresentationProfile` plus admitted
  `runtime.agent.turn.*` / `runtime.agent.presentation.*` /
  `runtime.agent.state.status_text_changed` /
  `runtime.agent.state.execution_state_changed` /
  `runtime.agent.state.emotion_changed` /
  `runtime.agent.state.posture_changed` projections may be exposed on read or
  subscription surfaces, but renderer-local session state must remain out of
  the public runtime truth model

Typed family registry is defined by
`tables/runtime-agent-service-typed-family.yaml`.

## K-AGCORE-006a Public Chat Conversation Cutover Prerequisites

Runtime Agent Chat transcript and session truth already belongs to
`RuntimeAgentService`, but deleting host-local projection caches requires an
admitted app-facing replacement for the product journeys those caches currently
serve.

Before a host removes an Agent Chat `chat_agent_*` projection-cache store,
Runtime / SDK must provide admitted coverage for:

- conversation summary listing scoped to the authenticated calling app,
  explicit local agent identity, and owner context
- recovery of a selected conversation through `ConversationAnchor` plus
  `GetPublicChatSessionSnapshot`
- a close / delete / clear policy for user-visible conversation history
- message-level delete / redact policy before any app exposes per-message
  deletion or redaction controls
- a single-active-conversation policy for each SourceMaterializationPacket
  provenance / LocalAgent projection
- explicit rejection of Agent Chat draft persistence, rename/archive
  conversation semantics, and Desktop offline transcript recovery

These prerequisites do not admit Desktop-local transcript, message, turn, beat,
or projection rebuild truth. They only define the Runtime / SDK replacement
surface that must exist before host-local migration stores can be removed.

## K-AGCORE-006b Public Chat Conversation Summary Listing

`RuntimeAgentService` admits `ListAgentConversationSummaries` as a read-only
conversation-summary query for Runtime-owned Agent Chat anchors.

Fixed rules:

- the query must be scoped to the calling app, explicit local agent identity,
  owner context, and Runtime-owned `ConversationAnchor` truth
- summaries must be ordered by `updated_at DESC, conversation_anchor_id ASC`
  and use runtime pagination fields
- each summary may expose a display `title`, but that title is derived
  presentation text, not a separate persisted Runtime conversation-title truth
- each summary may expose last-message role / text / id and transcript count
  only as projection data derived from Runtime-owned session transcript state
- `GetPublicChatSessionSnapshot` remains the recovery source for selected
  conversation transcript and turn detail
- this query does not admit close, delete, clear, archive, rename, draft, or
  multi-conversation mutation policy; clear/delete/redact actions remain covered
  by K-AGCORE-006a prerequisites until explicitly admitted elsewhere
- Agent Chat rename and archive are not product surfaces. Runtime must not add
  persistent user-authored conversation titles, archive flags, or multi-session
  management for Agent Chat unless a later product decision admits them.
- Runtime must present one active Agent Chat conversation per runtime source
  snapshot / LocalAgent projection. `ListAgentConversationSummaries` may page over
  different agents and historical Runtime anchors as migration evidence, but it
  must not become a user-facing multi-conversation product model.

## K-AGCORE-006c Public Chat Transcript Envelope Projection

`GetPublicChatSessionSnapshot` owns the app-facing replay envelope for
Runtime-owned Agent Chat transcript messages.

Fixed rules:

- every transcript entry projected by `GetPublicChatSessionSnapshot` must carry
  Runtime-owned replay identity fields (`id`, `created_at`, `updated_at`).
  If Runtime cannot produce those fields, the transcript entry is not
  replayable and SDK/app consumers must fail closed instead of deriving them.
- transcript entry `status` and `kind` are projection metadata, not model
  output truth; text transcript entries default to `status=complete` and
  `kind=text`
- transcript entry ids may be derived from `conversation_anchor_id` plus stable
  transcript index until Runtime stores per-message ids directly; that
  derivation is Runtime-owned and must not be re-derived differently by apps
- transcript entry timestamps may be derived from Runtime anchor/session time
  until Runtime stores per-message timestamps directly; apps may display them
  but must not reinterpret them as provider event time
- richer fields such as reasoning text, trace id, media/artifact metadata,
  error state, and parent linkage may only be trusted when Runtime projects
  them. Parent linkage for ordinary text assistant replies is Runtime-owned
  replay metadata, not an app-local adjacency inference.
- this envelope does not admit Desktop-local transcript persistence; it exists
  to let apps replay Runtime session snapshots without fabricating transcript
  identity locally
- this envelope does not admit offline Agent Chat transcript recovery from app
  storage. If Runtime is unavailable, apps may retain in-memory display state for
  the current renderer session, but restart recovery must come from Runtime
  snapshots, not from Desktop-local transcript stores.

## K-AGCORE-006d Agent Chat Non-Equivalence Boundary

Runtime Agent Chat authority is scoped to Runtime Agent lifecycle. It must not
be generalized into a daemon-owned product chat-history service for ordinary
apps.

Agent Chat belongs to `RuntimeAgentService` because it consumes and mutates
agent-owned lifecycle state: explicit `agent_id`, runtime-owned
`ConversationAnchor`, agent memory policy, turn planning, presentation/action
projection, voice/media workflow execution, and agent event emission.

Fixed rules:

- Runtime Agent Chat session / transcript replay remains Runtime-owned.
- `runtime.agent` app-message traffic is a reserved Agent Chat consume seam, not
  a generic app chat bus.
- `RuntimeAiService` owns AI execution, provider/model routing, readiness,
  jobs, artifacts, and fail-closed enforcement; it does not own ordinary app
  product session, thread, message, or draft truth by default.
- Generic ChatGPT-like, Codex-like, domain-assistant, or simple LLM
  product-session history must not be added to Runtime solely because it uses
  Runtime AI consume.
- Reusable non-authoritative app AI session-loop support belongs in SDK DX
  surfaces; durable product session truth belongs to the owning app or Realm
  unless a later Runtime / Cognition / Platform rule explicitly admits it.

Any proposal for a new Runtime-owned AI conversation/session store outside
Agent lifecycle must include a separate authority rule naming the lifecycle,
security, data-correctness, audit, or cross-app invariant that requires Runtime
ownership. Absent that rule, ordinary app AI session persistence remains outside
Runtime.

## K-AGCORE-007 Token Budget Authority

`RuntimeAgentService` owns token budget policy for Life Track autonomy.

Fixed rules:

- token budget configuration is runtime-owned and belongs to agent autonomy state
- token budget remains a quota and safety guardrail, not the primary cadence truth
- budget state must be observable through agent state or agent events; hidden depletion is not admitted
- the default budget window is daily unless a stricter runtime-owned policy is admitted elsewhere
- budget exhaustion suspends or rejects Life Track execution only; Chat Track remains separately governed by runtime product policy
- model output must not mutate budget truth directly

## K-AGCORE-008 Failure Semantics

`RuntimeAgentService` must fail-close on substrate unavailability and keep hook outcomes observable.

Fixed rules:

- agent initialization requires runtime-owned local prerequisites to be
  available; if RuntimeAgentService cannot rely on `RuntimeCognitionService`, retained
  runtime-private memory depth, or the required local substrate, the call must
  fail with `UNAVAILABLE`
- the required local memory substrate boundary referenced here is the runtime-private contract in `K-MEMSUB-*`, not a public local-engine target
- Realm replication unavailability does not authorize pseudo-success; initialization may proceed only when local bootstrap truth is sufficient and pending replication remains observable
- Life Track model failure, memory write failure, or scheduler admission failure must produce an observable agent event or reasoned rejection
- pending hooks may be rescheduled or canceled explicitly, but they must not disappear silently after a failed life-turn attempt

## K-AGCORE-009 Hook Lifecycle Store

`RuntimeAgentService` must keep hook lifecycle truth in a runtime-owned store.

It owns:

- admitted pending-hook persistence
- admission-state transitions for `pending`, `running`, `completed`, `failed`,
  `canceled`, `rescheduled`, and `rejected`
- host-owned cancellation checks
- life-track execution-state projection derived from hook lifecycle truth

Fixed rules:

- `ListPendingHooks` must read from runtime-owned hook state, not from caller-supplied projection or ephemeral renderer memory
- `CancelHook` may only transition hooks that remain host-cancelable; terminal hook outcomes must stay immutable
- typed `HookIntent` and typed trigger detail must be validated before a hook
  becomes admitted scheduler truth
- hook admission-state transitions must persist before event publication so that
  replayed event cursors and hook listing observe the same committed truth
- runtime may keep terminal hook outcomes visible for audit/history, but active hook visibility must remain distinguishable from terminal outcomes

## K-AGCORE-010 Agent Event Stream Source

`SubscribeAgentEvents` must stream from a runtime-owned committed agent event log.

Fixed rules:

- lifecycle, hook, memory, budget, and replication events must be appended only after the corresponding runtime-owned state transition or admission outcome is committed
- cursor resume semantics must read from the committed event log rather than re-synthesizing events from current snapshots
- hook-related events must originate from hook lifecycle transitions, not from thin wrappers around RPC responses
- subscriber filtering may narrow delivery, but it must not invent missing hook outcomes or hide committed cancellation / failure / reschedule events

## K-AGCORE-011 WORLD_SHARED Runtime Admission Boundary

`RuntimeAgentService` may admit `WORLD_SHARED` canonical memory only when runtime-owned world context is sufficiently typed for the bank owner contract.

Fixed rules:

- runtime-owned admission requires explicit `world_id` truth matching the `WORLD_SHARED` bank owner shape
- runtime must not infer an extra owner dimension from account, app, or renderer-local context
- when runtime-owned world context has not yet been admitted on the RuntimeAgentService path, `WORLD_SHARED` query/write behavior must remain fail-closed inside runtime
- deferring `WORLD_SHARED` on the runtime path does not authorize app, SDK, or Realm bypasses for canonical agent writes

## K-AGCORE-012 Life Track Runtime Loop

`RuntimeAgentService` owns the internal Life Track execution loop as a runtime-private lifecycle, not as an app-facing RPC surface.

Fixed rules:

- the loop must scan committed hook store truth rather than caller-provided snapshots
- due-hook execution must emit outcomes and events through the same committed hook store and committed event log path used by public read surfaces
- the loop must be startable and stoppable with daemon lifecycle so shutdown does not leave hidden background execution running
- when runtime has not yet admitted a concrete Life Track executor, due hooks must fail closed with an explicit terminal rejection or failure outcome rather than silent retention or pseudo-success
- host-owned trigger admission remains authoritative; non-admitted trigger timing must not be synthesized into immediate execution inside the loop

## K-AGCORE-013 Runtime-Private Life Turn Executor

`RuntimeAgentService` may execute Life Track turns through an in-process runtime-private executor.

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
- the admitted runtime-private Life Turn result is limited to `status_text`
  diff, posture patch, emotion update, canonical memory candidates, typed
  `HookIntent`, summary, and token usage
- the model-facing Life Turn executor output contract is the APML
  `<life-turn>` root admitted by `agent-output-wire-contract.md`; JSON executor
  output compatibility is not admitted
- the runtime-private executor must not admit arbitrary attribute mutation, free-form hook logic, direct world/user state mutation, or proactive app-facing initiate-chat semantics
- canonical memory candidates returned by the executor must still pass RuntimeAgentService-owned canonical class and bank-scope admission before Memory Service writes occur
- typed `HookIntent` returned by the executor must still pass the same
  runtime-owned validator and hook-admission path used elsewhere on
  RuntimeAgentService
- invalid executor output must fail closed with observable terminal hook failure rather than implicit completion, pseudo-success, or silent drop

## K-AGCORE-014 Replication Event Projection Source

`RuntimeAgentService` must project replication events from the committed
retained runtime-private memory replication update source.

Fixed rules:

- `AGENT_EVENT_TYPE_REPLICATION` must derive from committed `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` events rather than from immediate write-result decoration or snapshot inference
- RuntimeAgentService may project only canonical bank scopes admitted on its public path; infra-scope memory banks must not synthesize canonical agent replication events
- `AGENT_CORE` and `AGENT_DYADIC` replication updates project to the owning `agent_id`
- `WORLD_SHARED` replication updates project to agents whose committed `active_world_id` matches the world-scoped bank owner
- RuntimeAgentService cursor replay and live subscription must observe the same replication event ordering as the committed memory replication source after RuntimeAgentService projection commit

## K-AGCORE-015 Runtime-Private Behavioral Posture Truth

`RuntimeAgentService` owns behavioral posture as runtime-private machine truth for live agent execution.

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
- chat-track and life-track outputs may propose posture mutation only through admitted runtime-private typed contracts validated by RuntimeAgentService
- invalid posture output must fail closed rather than silently mutating committed state
- behavioral posture remains runtime-private machine truth; only the narrower
  read-only `PostureProjection` admitted through `K-AGCORE-037` may cross the
  public RuntimeAgentService surface

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

## K-AGCORE-027 Life-Track Cadence Ownership

`RuntimeAgentService` owns proactive Life Track cadence as runtime-owned
scheduler truth.

It owns:

- explicit opt-in autonomy mode for proactive Life Track execution
- baseline cadence tick policy
- host-owned reconciliation between cadence tick and typed HookIntent timing
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
- typed `HookIntent` may request callback timing, but host runtime
  remains the only owner of effective next-run computation
- admitted hook cadence interaction must remain typed rather than a freeform
  boolean or scheduler blob
- long-running hook suppression may delay baseline cadence tick only through
  admitted hook cadence interaction semantics validated by RuntimeAgentService
- `min_hook_interval` or its admitted successor remains a hard lower-bound
  spacing gate after cadence and callback timing are reconciled
- Chat Track remains reactive and available regardless of proactive Life Track
  cadence mode

## K-AGCORE-028 Source/Profile And Binding Mutation Event Grammar

`RuntimeAgentService` owns the durable mutation-event grammar for
account-scoped source/profile truth and runtime binding truth.

It owns:

- committed mutation events for `account_agent_source_revision`
- committed mutation events for `runtime_agent_binding`
- replay-visible revision expectation and conflict posture
- replay-visible forceful replacement and binding cutover outcomes

It does not by itself admit:

- a final public RPC/update taxonomy
- full wire-format lock-in for mutation envelopes
- one final conflict-resolution algorithm

Fixed rules:

- source/profile mutation and binding mutation must not exist only as protocol
  traffic or host-local narrative reason text; they must commit through explicit
  durable mutation event families
- `expected_revision_id`, conflict, and forceful replacement semantics must stay
  reconstructable through committed mutation events and replay
- free-form `reason` text may remain auxiliary audit context, but it must not
  become the sole durable mutation truth
- this rule lands the canonical event-grammar requirement without by itself
  expanding the current public RPC method family

## K-AGCORE-029 Narrow Multi-Agent Delegation Authority Boundary

`RuntimeAgentService` admits a narrow multi-agent claim centered on durable
delegation lifecycle rather than a full delegated-authority trust model.

It owns:

- durable delegation lifecycle
- supervisor accountability
- scheduler attribution and coordination visibility
- runtime-visible delegation identity and recovery semantics

It does not yet own:

- delegated `on-behalf-of` authority minting
- delegated grant attenuation rules
- delegated approval inheritance
- delegated secret-scope semantics

Fixed rules:

- delegation does not mint new principal authority by itself
- worker-side externally governed effects remain constrained by ordinary
  principal, capability, approval, and trust gates
- any future delegated-authority model must land through a separate admitted
  packet or rule rather than being inferred from delegation existence alone

## K-AGCORE-030 Turn/Stream Terminal Coupling

`RuntimeAgentService` owns the minimum terminal-coupling rules between `turn`
truth and owned `stream` truth.

Fixed rules:

- one `turn` may own multiple `stream` units
- a `turn` must not enter `completed` while its owned foreground response
  streams remain in non-terminal live state
- turn interruption or abandonment must propagate interrupt or terminal
  semantics onto its still-live owned streams
- a `stream` may outlive one `turn` only when its longer-running `activity`
  anchor is explicit and replayable

## K-AGCORE-031 Temporal-Autonomy Deferral Boundary

`RuntimeAgentService` does not yet admit timer/deadline/wake-style
temporal-autonomy objects as canonical runtime truth.

Fixed rules:

- the admitted autonomy baseline remains the scheduler/budget/lease/cadence
  model already frozen elsewhere on the spec path, plus the narrow-admit
  `HookIntent` surface defined in `agent-hook-intent-contract.md`
- spec text must not imply canonical timer, deadline, wakeup, appointment, or
  alarm truth without a later dedicated admission
- admitted `HookIntent` does not create a general temporal object model; it is
  limited to relative delay and event-triggered follow-up continuation
- proactive cadence ownership under `K-AGCORE-027` does not by itself imply a
  full time-driven assistant object model

## K-AGCORE-032 App-Facing Reactive Chat Consume Seam

`RuntimeAgentService` owns one admitted app-facing reactive chat consume seam
for first-party host surfaces.

Fixed rules:

- the canonical transport target for that seam is the reserved runtime app
  target `runtime.agent`
- the admitted ingress families on that target are:
  `runtime.agent.turn.request`,
  and `runtime.agent.turn.interrupt`
- the admitted projection families on that target are:
  `runtime.agent.turn.accepted`,
  `runtime.agent.turn.started`,
  `runtime.agent.turn.reasoning_delta`,
  `runtime.agent.turn.text_delta`,
  `runtime.agent.turn.structured`,
  `runtime.agent.turn.message_committed`,
  `runtime.agent.turn.action_planned`,
  `runtime.agent.turn.action_started`,
  `runtime.agent.turn.artifact_ready`,
  `runtime.agent.turn.action_completed`,
  `runtime.agent.turn.action_failed`,
  `runtime.agent.turn.post_turn`,
  `runtime.agent.turn.completed`,
  `runtime.agent.turn.failed`,
  `runtime.agent.turn.interrupted`,
  and `runtime.agent.turn.interrupt_ack`
- full public chat session snapshot is a query and must use
  `RuntimeAgentService.GetPublicChatSessionSnapshot`; it must not be modeled as
  an app-message request/reply pair
- `runtime.agent.*` remains the steady-state lifecycle/state/memory/admin/read
  RPC projection and must not be restated as a second reactive-chat app-message
  family
- the reserved app target is only the carrier for this seam; semantic
  ownership of `runtime.agent.turn.*` / `runtime.agent.session.*` remains on
  `RuntimeAgentService`
- host surfaces must consume runtime-owned `session` / `turn` / `stream` truth
  through this seam rather than reconstructing shadow chat orchestration,
  provider-native sidecar parsing, or provider-native transcript truth locally
- host surfaces must bind or recover the appropriate `conversation_anchor_id`
  explicitly; runtime must not infer that all host surfaces attached to one
  `agent_id` belong to the same reactive conversation
- host surfaces must open or recover anchors through the runtime-owned
  `OpenConversationAnchor` / `GetConversationAnchorSnapshot` surface before
  sending `runtime.agent.turn.request`; app-local guessed anchor ids are not
  admitted continuity truth
- typed chat-sidecar / structured projection on this seam remains runtime-owned
  semantic output; hosts may render or act on it, but must not reinterpret raw
  provider output as canonical chat truth
- current transport authorization and subscription posture for turn ingress and
  turn projection remains governed by the admitted `RuntimeAppService` /
  app-messaging path; query surfaces are owned by `RuntimeAgentService` unary
  RPCs

## K-AGCORE-052 Scoped Binding Attachment For App-Facing Consume

Explicit binding-only first-party consume modes must attach a Runtime-issued
scoped binding to every app-facing reactive consume operation. Default Nimi
Avatar launch is not binding-only; it consumes runtime-agent through admitted
local first-party Runtime / SDK account and agent authorization paths.

Fixed rules:

- `runtime.agent.turn.request` and `runtime.agent.turn.interrupt` carried over
  `RuntimeAppService` must include `ScopedRuntimeBindingAttachment` with at
  least `binding_id`.
- `RuntimeAppService.SubscribeAppMessages` used to consume
  `runtime.agent.turn.*` or `runtime.agent.presentation.*` projections must
  include the same attachment.
- `RuntimeAgentService.GetPublicChatSessionSnapshot` used by binding-only
  consumers must include the same attachment on `AgentRequestContext`.
- `RuntimeAgentService.SubscribeAgentEvents` used by binding-only consumers to
  merge `runtime.agent.state.*`, hook, or presentation-adjacent projections
  must include the attachment on `AgentRequestContext`.
- Runtime must validate the attachment against the binding relation:
  `runtime_app_id`, app/window relation where available, `avatar_instance_id`
  where available, `agent_id`, `conversation_anchor_id` for anchor-scoped
  surfaces, optional `world_id`, required scope, state, expiry, and current
  authenticated account state.
- Missing, revoked, expired, stale, suspended, superseded, replayed,
  relation-mismatched, scope-mismatched, or account-non-authenticated bindings
  fail closed with typed unavailable / permission status.
- `subject_user_id` remains available for unrelated Web/cloud or
  external-principal paths, but it is never scoped binding proof.
- Default local first-party Avatar must not be forced through this binding
  attachment path solely because Desktop launched it.

## K-AGCORE-139 SourceMaterializationPacket LocalAgent Materialization

`InitializeAgent` is a Runtime-local creation operation for an opaque
LocalAgent identity. `RuntimeAgentService` may materialize a LocalAgent from a
validated `SourceMaterializationPacket` produced from Realm source content, but
Realm source provenance does not own the Runtime creation lifecycle. This rule
applies to every materialized runtime source, not only the Nimi guide.

For any materialization request, Runtime must:

- consume the `SourceMaterializationPacket` through admitted Realm/SDK
  source-core data, not through Desktop fixtures;
- validate packet schema, `packetHash`, Realm-issued proof, expiry, replay
  nonce, owner/audience, source hash, and source schema before local creation;
- generate an opaque Runtime-owned `local_agent_ref`;
- persist LocalAgent state and source provenance metadata without storing packet
  payload as a second source of truth;
- maintain a provenance index from source kind, source world id, source id, and
  source content hash to one or more `local_agent_ref` values;
- allow multiple LocalAgents to share the same source provenance;
- fail closed when owner identity, source hash, packet proof, or source schema
  does not match.

Creation trigger owner:

- Runtime authors the local creation result. Realm authorizes source reads and
  creates a by-value packet, but does not create durable provision intent,
  source-provenance linkage, or a deterministic LocalAgent identity.
- `InitializeAgent` may be idempotent only for an explicit Runtime request id or
  existing Runtime-owned `local_agent_ref`. It must not converge all repeated
  materialization attempts for the same source into one projection.
- Opening first chat may query Runtime local inventory/provenance. If no
  matching LocalAgent exists, the UI may request a fresh packet and create a new
  LocalAgent. If provenance is unavailable, Runtime surfaces unavailable
  provenance instead of reconstructing, rebasing, or recreating a LocalAgent
  from deterministic source metadata.
- Runtime local inventory/provenance is the only admitted discovery projection
  for an existing materialized source. SDK/Kit/Electron consumers may expose
  this projection, but must not convert environment variables, renderer cache,
  source ids, or source metadata into a `local_agent_ref`.

`MUST NOT`: Runtime must not create any LocalAgent — the guide source's or
any other source's — as a standalone local-only agent, fake contact,
server-bot bypass, Avatar instance, privileged Agent class, special
official-guide path, quota bypass, or default global agent.

## K-AGCORE-140 Nimi Guide Prompt And Documentation Context

When the Nimi guide LocalAgent is available through SourceMaterializationPacket
materialization, Runtime may initialize the first conversation from Nimi guide
welcome copy and may attach built-in Nimi usage documentation as product
knowledge/context.

Source of truth:

- the Nimi guide welcome copy and guide system prompt are ordinary source
  content carried on the admitted SourceMaterializationPacket, reached through
  the same source-core path used for any runtime source;
- the Nimi guide / Archivist source is available only when admitted Realm
  source-core data can produce a hash-bearing source reference and fresh
  SourceMaterializationPacket, or when Runtime inventory/provenance already
  contains a Runtime-owned LocalAgent for that source;
- Runtime MUST NOT hold a runtime-local hardcoded guide welcome string, guide
  prompt, or guide identity constant as parallel product truth;
- built-in Nimi usage documentation attached as context is product
  knowledge/context only and is not external Realm authority, not memory truth, and
  not a runtime-owned guide catalog.

`MUST NOT`: prompt/docs context must not create Agent authority, memory truth,
permission grant truth, Runtime setup truth, or profile/app configuration truth.
The guide may direct the user to product surfaces but cannot bypass setup
confirmations, permissions, install plans, app admission, or ordinary LocalAgent
mechanics.

## K-AGCORE-141 Runtime-Local LocalAgent Deletion And Reset

`TerminateAgent` is a Runtime-local deletion lifecycle for a Runtime-owned
LocalAgent projection. Realm source removal or source provenance changes do not
issue `TerminateAgent` and do not hard-delete LocalAgent state. This rule
applies to every Runtime-owned LocalAgent, not only the Nimi guide.

`TerminateAgent` deletion scope:

- `TerminateAgent` must remove the `runtime_local_agent` row for the target
  `local_agent_ref`, not merely flip a lifecycle status field;
- when explicitly invoked by Runtime-local delete/reset authority, it must
  remove the agent-scoped projections bound to that `local_agent_ref`:
  agent state projection, runtime-owned pending/terminal hooks, the agent event
  log, and the agent-scoped memory bank (`MEMORY_BANK_SCOPE_AGENT_CORE` and
  `MEMORY_BANK_SCOPE_AGENT_DYADIC` owned by that agent);
- the deletion is a hard delete: the projection and its agent-scoped memory are
  physically removed. `RuntimeAgentService` must not retain a `TERMINATED`
  tombstone row as the steady-state outcome of local delete/reset. A later
  materialization from the same source creates a new opaque LocalAgent identity
  through `K-AGCORE-139` rather than resurrecting deleted state.

Fixed rules:

- `TerminateAgent` must be idempotent. `TerminateAgent` for an already-absent
  `local_agent_ref` — including a LocalAgent that was never materialized —
  must succeed as a typed no-op rather than failing with a not-found error.
- runtime snapshot persistence must not re-insert a deleted `local_agent_ref`.
  A snapshot rewrite must exclude deleted projections so that a deleted agent
  never reappears after restart or snapshot replay.
- `TerminateAgent` must cancel any active hooks and in-flight execution for the
  target agent before the projection row is removed, so deletion does not strand
  live runtime work.
- substrate failure during deletion fails closed: if the row or agent-scoped
  memory cannot be deleted, `TerminateAgent` must return a typed failure status
  rather than reporting pseudo-success. Runtime owns retry/reporting of
  Runtime-local deletion failure and must not mask an incomplete deletion.
- `TerminateAgent` deletes the runtime-owned LocalAgent projection only. It must
  not mutate, delete, or write back the canonical Realm source identity, and it
  must not delete account-scoped truth wider than the target agent.

`MUST NOT`: `TerminateAgent` must not leave a partially deleted projection — a
`runtime_local_agent` row without its agent-scoped memory, or agent-scoped
memory without its row. Deletion of the row and its agent-scoped
state/hooks/event-log/memory either completes together or fails closed as a
typed error.

## K-AGCORE-142 Built-In Usage Documentation Corpus Authoring And Context Attachment

K-AGCORE-140 admits "built-in Nimi usage documentation attached as context" and
bounds what that documentation must not become. K-AGCORE-142 is the positive
counterpart: it names where the built-in usage documentation corpus is authored
and stored, and how it is admitted as the Nimi guide's per-turn context
attachment, without introducing a special official-guide path.

Authoring and storage:

- the built-in Nimi usage documentation corpus is ordinary source profile
  content authored alongside the guide source definition (the same
  Nimi-authored bootstrap definition that owns the guide `greeting` /
  `systemPromptBase`), not a separate platform-owned bespoke docs artifact and
  not a separate admitted docs schema;
- the corpus is stored inside the projected source's ordinary source-core
  profile knowledge payload, so it rides the same admitted source-core
  projection used for any runtime source's profile content;
- the corpus is bounded built-in product knowledge — first-run setup, Runtime,
  profiles, Apps, Worlds, RealmPersonas, LocalAgents, and Avatar — authored as
  static structured text;
- the corpus is ordinary source profile content: any admitted source profile may
  carry a built-in documentation knowledge payload through the same field. It
  is not a guide-only schema, not a privileged Agent class field, and not a
  quota/admission exception.

Context attachment:

- the corpus reaches the guide LocalAgent's chat turns as product
  knowledge/context through the same per-turn prompt-context path the guide
  `systemPromptBase` already uses — it augments the turn's assembled prompt
  context and is not a separate retrieval surface;
- attachment is per-turn context only: the corpus is not written into any
  memory bank, is not a runtime-resident catalog, and is not consulted through
  a privileged retrieval path.

Source of truth and authoring location remain ordinary:

- Runtime MUST NOT hold a runtime-local hardcoded usage documentation corpus,
  guide docs catalog, or guide identity constant as parallel product truth; the
  corpus is reached only through the admitted source-core projection,
  consistent with K-AGCORE-140;
- the desktop/consumer attaches the projected corpus to the per-turn context;
  it does not author a parallel renderer-local docs corpus.

`MUST NOT`: the built-in usage documentation corpus must not create Agent
authority, memory truth, permission grant truth, Runtime setup truth, or
profile/app configuration truth. It is product knowledge/context only,
identical to the K-AGCORE-140 bound. The corpus may describe and direct the
user to product surfaces, but it must not bypass setup confirmations,
permissions, install plans, app admission, or ordinary LocalAgent mechanics.

## K-AGCORE-143 Proactive Interruptibility Projection Boundary

`RuntimeAgentService` owns `proactive_interruptibility_v1` as the bounded
app-facing projection for proactive Life Track interruptibility. This is a
Runtime-owned projection and event seam over Runtime autonomy, HookIntent
admission, cadence, host scheduler admission, permission state, quiet-hours
policy, spacing/frequency gates, delivery/suppression outcomes, and audit
linkage. It is not a renderer scheduler, OS notification promise, or general
automation surface.

It owns:

- default-off autonomy-derived interruptibility mode
- trigger source classification for admitted Life Track cadence and HookIntent
  evidence
- `quiet_hours` state and owner/source metadata
- `frequency_cap` state and owner/source metadata
- `suppression_reason` values for typed fail-closed outcomes
- Runtime/host audit reference lineage for every projected outcome
- `runtime.agent.proactive.suggested`,
  `runtime.agent.proactive.delivered`, and
  `runtime.agent.proactive.suppressed` projection events

It does not own:

- renderer-local timers, polling loops, or scheduling logic
- app-owned permission grant truth
- OS notification delivery truth
- broad reminders, appointments, deadlines, wakeups, or calendar semantics
- proactive chat initiation beyond the admitted Runtime/host projection

Fixed rules:

- `proactive_interruptibility_v1` is default off. No app or SDK consumer may
  enable it by rendering UI state or fabricating projection fields.
- Every proactive suggested, delivered, or suppressed outcome must be projected
  as one of the `runtime.agent.proactive.*` events admitted in
  `tables/runtime-agent-event-projection.yaml` and must carry an `audit_ref`.
- `delivery_channel` is exactly `in_app_surface` or
  `notification.not_admitted`. `notification.not_admitted` is explicit
  non-delivery for OS notifications and must not be treated as a fake
  notification success.
- `quiet_hours` and `frequency_cap` are owner-projected fields. SDKs and apps
  may display or filter them, but must not infer them as authority.
- Missing, denied, revoked, expired, or otherwise unavailable permission
  evidence suppresses delivery with a typed `suppression_reason`.
- `proactive_interruptibility_v1` may reference admitted HookIntent ids as
  source evidence, but it does not widen HookIntent trigger/effect semantics
  beyond `follow-up-turn`.
- SDKs and apps must fail closed when required proactive projection fields are
  absent. They must not backfill the projection with app-local timers,
  permission guesses, or notification assumptions.

## K-AGCORE-144 Runtime Agent AI Config Authority Home

`RuntimeAgentService` owns Runtime Agent AI Config: one runtime-owned,
agent-instance-scoped committed AI consume config that decides which binding
the local agent uses for chat, lifecycle, memory embedding, cognition,
activity/query, image generation, voice generation, voice workflows, and future
agent work capabilities. The admitted capability set, readiness states, typed
reason vocabularies, scopes, and forbidden derived-state fields live in
`tables/runtime-agent-ai-config.yaml`.

It owns:

- the single committed Runtime Agent AI Config record for each Runtime Local
  Agent instance
- per-capability committed AI consume intent (`text.generate`, `text.embed`,
  `image.generate`, `audio.synthesize`, `voice_workflow.voice_clone`,
  `voice_workflow.voice_design`, and future admitted `agent.work.*`)
- config mutation admission, validation, revisioning, and change event emission
- readiness projection derived from the committed config

It does not own:

- provider/model routing execution (`RuntimeAiService` per K-AGCORE-006)
- connector custody, key-source legality, or model catalog truth
- desktop `AIProfile`/`AIConfig` portable configuration authority for
  non-agent app AI consume (D-AIPC-001)
- resolved embedding dimensions, memory bank bind/rebuild/cutover state, voice
  stream state, voice artifact materialization, avatar lipsync/render state, or
  runtime activity events

Fixed rules:

- there is exactly one committed Runtime Agent AI Config per Runtime Local Agent
  instance; all first-party and binding-only consumers read and mutate that
  record through the admitted RuntimeAgentService RPC surface
- apps, SDKs, hosts, and cognition bridges must not persist a parallel copy of
  agent AI consume truth, re-derive it from `AIConfig` overlays at submit time,
  or carry it as per-turn request payload once K-AGCORE-147 applies
- binding values must use v2 durable target refs (`K-RTARGET-*`) or another
  spec-admitted typed binding reference; descriptor or evidence fields forbidden
  by K-AIEXEC-001 must be rejected fail-closed
- this config is agent-domain committed state, not a runtime-global active AI
  profile; K-AIEXEC-005 continues to hold for the generic profile resolve/apply
  layer
- mutation requires the `runtime.agent.ai_config.write` scope and read requires
  `runtime.agent.ai_config.read` (or an admitted first-party host equivalence);
  Platform registry scopes are not a substitute

## K-AGCORE-145 Runtime Agent AI Config Revision And Persistence

The committed Runtime Agent AI Config carries an `agent_instance_id`, monotonic
`revision`, the mutating app id, and the commit timestamp, and persists in the
runtime-owned store.

Fixed rules:

- every successful mutation increments `revision` by exactly one and commits
  atomically through the runtime persistence write path
- mutation requests must carry `expected_revision`; a mismatch is a typed
  concurrent-modification rejection, never a silent last-writer win
- the committed config must survive daemon restart; readiness is recomputed
  after restart rather than restored as stale truth
- every mutation emits an observable config-changed event before or together
  with the first read that reflects it; hidden mutation is not admitted
- config mutation and its evidence enter the audit trail (K-AUDIT-001)

## K-AGCORE-146 Runtime Agent AI Config Readiness Projection

`RuntimeAgentService` projects per-capability readiness for the committed
Runtime Agent AI Config. Readiness is a projection, not an execution gate or a
prepare/readiness substitute (K-AIEXEC-009).

Fixed rules:

- readiness state per capability is exactly one of `ready`, `not_configured`,
  or `unavailable`, with typed reason codes from
  `tables/runtime-agent-ai-config.yaml`
- `not_configured` (no committed binding for the capability) and `unavailable`
  (committed binding whose route is currently not usable) are distinct truths
  and must never be collapsed
- readiness recomputes at daemon start, on every config mutation, and on
  provider/route health change evidence; a startup-only probe that is never
  refreshed is not admitted
- readiness carries `config_revision` and probe timestamps so consumers can
  detect staleness; consumers must not cache readiness as their own truth
- readiness success does not admit an action, validate a prompt payload, or
  replace explicit profile prepare; execution-time enforcement remains
  fail-closed

## K-AGCORE-147 Turn Admission Consumes Runtime Agent AI Config Only

Agent turn execution binds to committed Runtime Agent AI Config at turn
admission time.

Fixed rules:

- Chat Track public turn admission resolves AI consume bindings from committed
  Runtime Agent AI Config; request-carried `execution_bindings`,
  `runtimeFields`, app `AIConfig`, or provider/model payloads are not admitted
  and must be rejected with a typed invalid-argument failure
- turn admission fixes the resolved bindings and the `config_revision` into the
  turn execution snapshot (K-AIEXEC-003); a config mutation during an in-flight
  turn affects the next turn only
- the conversation-anchor-sticky binding rule (anchor-committed bindings with
  mismatch rejection) is retired; anchors do not own binding truth
- Life Track, canonical review, chat-track sidecar, and companion participation
  executors consume the same committed Runtime Agent AI Config `text.generate`
  binding; runtime-private hardcoded model constants are not admitted as
  execution binding truth
- a missing required `text.generate` binding at admission is a typed
  fail-closed rejection, never a silent fallback to another route

## K-AGCORE-148 Available Actions Derive From Runtime Agent AI Config And Readiness

The action affordances offered to the model on a turn (including the APML
output contract prompt) derive from committed Runtime Agent AI Config presence
plus readiness, never from what a caller attached.

Fixed rules:

- image action availability on a turn is a tri-state derived at admission:
  available (committed binding, readiness not `unavailable`),
  `not_configured`, and `unavailable`
- the model-facing output contract must state the matching truth for the
  non-available states; telling the model an image route is unconfigured when a
  committed binding exists is not admitted
- planned actions whose capability is not available must fail as typed
  `action_failed` events with reason codes from
  `tables/runtime-agent-ai-config.yaml`; silent action drop or pseudo-success is
  not admitted
- voice generation, voice workflow, and embedding-dependent actions follow the
  same config-plus-readiness rule; Desktop, Zhiyu, and Avatar may display or
  render Runtime projections but must not generate voice, synthesize image
  provider truth, or persist embedding binding truth
- apps map typed reasons to product copy only; they must not re-derive action
  availability from app-local route state

## K-AGCORE-149 Runtime Agent AI Config Event Seam

Runtime Agent AI Config changes and readiness changes reach apps through a
dedicated runtime-owned subscription seam.

Fixed rules:

- config/readiness subscription delivers an initial snapshot followed by change
  events carrying `config_revision`
- the seam is domain-scoped; agent-scoped `AgentEvent` envelopes
  (K-AGCORE-037) must not be widened to carry domain config events
- subscription requires the same read authority as config read; events must not
  leak connector secrets, key material, or runtime-private descriptor evidence

## K-AGCORE-150 Runtime Agent AI Config Bootstrap Seeding

Runtime seeds Runtime Agent AI Config exactly once for a Runtime Local Agent
instance when no committed record exists.

Fixed rules:

- the seed commits `text.generate` bound to the runtime-owned local default
  alias (`local/default`, resolved per K-CFG-013 and `texttarget` resolution)
  and `text.embed` bound to the runtime-owned local embedding default
  (`local/default-embedding`, resolved through admitted runtime memory/cognition
  embedding execution)
- optional image, audio synthesize, and voice workflow capabilities are absent
  (`not_configured`) until explicitly configured
- seeding is a normal committed mutation: it produces revision `1`, an audit
  record, and a change event
- after seeding, a missing config row is an internal fail-closed error;
  turn-time silent fallback to bundled defaults is not admitted
- the seed must not overwrite an existing committed config, including after
  daemon upgrade or restart
