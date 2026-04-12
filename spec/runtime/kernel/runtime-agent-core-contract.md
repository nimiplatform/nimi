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
- Realm replication unavailability does not authorize pseudo-success; initialization may proceed only when local bootstrap truth is sufficient and pending replication remains observable
- Life Track model failure, memory write failure, or scheduler admission failure must produce an observable agent event or reasoned rejection
- pending hooks may be rescheduled or canceled explicitly, but they must not disappear silently after a failed life-turn attempt
