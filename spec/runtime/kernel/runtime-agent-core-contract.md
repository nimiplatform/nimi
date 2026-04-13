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

It consumes `RuntimeMemoryService` and must not be collapsed into a memory engine.

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
- `RuntimeMemoryService` stores and recalls memory; `RuntimeAgentCoreService` owns semantic admission

## K-AGCORE-005 App Consumer Boundary

Apps consume `RuntimeAgentCoreService` as controllers and projection readers.

Apps may:

- initialize agents
- read state and memory projections
- update state through admitted commands
- configure autonomy
- subscribe to agent events

Apps may not:

- own renderer-local canonical agent identity
- own renderer-local canonical memory truth
- directly schedule life-track execution
- directly mutate canonical agent bank scopes through Memory Service

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
- agent events must expose explicit failure / reschedule / budget states as typed event kinds
- dynamic envelopes remain limited to auxiliary details / extensions fields
- implementation-facing transport must distinguish read projections from mutation commands; public agent state mutation may not devolve into arbitrary blob replacement
- implementation-facing transport must reserve typed families for `NextHookIntent`, `HookOutcome`, canonical memory candidate/view, and constrained state mutation payloads
- admitted implementation-facing transport must expose hook outcome detail as typed completed / failed / canceled / rescheduled / rejected families, and app-facing state mutation as a typed command/patch union rather than full-state replacement

Typed family registry is defined by `tables/runtime-agent-core-typed-family.yaml`.

## K-AGCORE-007 Token Budget Authority

`RuntimeAgentCoreService` owns token budget policy for Life Track autonomy.

Fixed rules:

- token budget configuration is runtime-owned and belongs to agent autonomy state
- budget state must be observable through agent state or agent events; hidden depletion is not admitted
- the default budget window is daily unless a stricter runtime-owned policy is admitted elsewhere
- budget exhaustion suspends or rejects Life Track execution only; Chat Track remains separately governed by runtime product policy
- model output must not mutate budget truth directly

## K-AGCORE-008 Failure Semantics

`RuntimeAgentCoreService` must fail-close on substrate unavailability and keep hook outcomes observable.

Fixed rules:

- agent initialization requires runtime-owned local prerequisites to be available; if Agent Core cannot rely on Memory Service or required local substrate, the call must fail with `UNAVAILABLE`
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

`RuntimeAgentCoreService` must project replication events from the committed `RuntimeMemoryService` replication update source.

Fixed rules:

- `AGENT_EVENT_TYPE_REPLICATION` must derive from committed `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` events rather than from immediate write-result decoration or snapshot inference
- Agent Core may project only canonical bank scopes admitted on its public path; infra-scope memory banks must not synthesize canonical agent replication events
- `AGENT_CORE` and `AGENT_DYADIC` replication updates project to the owning `agent_id`
- `WORLD_SHARED` replication updates project to agents whose committed `active_world_id` matches the world-scoped bank owner
- Agent Core cursor replay and live subscription must observe the same replication event ordering as the committed memory replication source after Agent Core projection commit
