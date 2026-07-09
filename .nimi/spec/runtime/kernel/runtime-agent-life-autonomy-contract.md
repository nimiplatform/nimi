# Runtime Agent Life And Autonomy Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent Life Track, autonomy cadence, mutation event, delegation, and turn/stream boundary authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

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
