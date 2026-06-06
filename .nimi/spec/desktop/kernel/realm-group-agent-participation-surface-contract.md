# Realm Group Agent Participation Surface Contract

> Authority: Desktop Kernel

## Scope

This contract owns the Desktop/Web product surface boundary for Realm Group
Agent Participation. It defines controls, projections, and hardcut gates for
group agent participation while consuming SDK, Runtime, and Realm authority.
Desktop and Web do not own agent execution, prompt assembly, provider/model
routing, memory policy, same-room orchestration, or Realm GROUP message commit.

## D-LLM-088 — Surface Authority Home

Desktop/Web may present Realm Group Agent Participation controls and status for
Realm `GROUP` threads only as consumers of:

- SDK contract `S-RUNTIME-221` through `S-RUNTIME-226`
- Realm product contract `R-CHAT-008` through `R-CHAT-014`
- Runtime consumer contract `K-AGCORE-119` through `K-AGCORE-124`
- Runtime room orchestration `realm_group` row and overlay under
  `K-AGCORE-107` through `K-AGCORE-118`

Desktop/Web must not define app-local group agent execution, local AI adapters,
prompt builders, provider/model routing, memory policy, reply queue truth, or
same-room scheduler authority.

## D-LLM-089 — Control Surface Inputs

Desktop/Web controls may initiate mention, explicit user action, admitted
automation display, or product-disabled posture only through typed SDK/Realm
references. Controls must pass group thread, membership snapshot, agent slot,
trigger event, read cursor, optional reply target, and room orchestration
references without exposing raw prompt payloads, provider/model hints, direct
commit handles, or unbounded transcript dumps.

## D-LLM-090 — Candidate, Commit, And Read Surface Split

Desktop/Web may render Runtime `REALM_GROUP_MESSAGE_CANDIDATE` status and Realm
committed `GROUP` messages, but must preserve the owner split. Runtime candidate
output is not a committed message, and Realm authenticated commit/read/sync
truth is not Runtime execution success. Desktop/Web must not synthesize commit
success from candidate output or write GROUP transcript truth locally.

## D-LLM-091 — Queue Status And Refusal Projection

Desktop/Web may display queued, running, refused, cancelled, timed-out, and
candidate states only from typed Runtime `runtime.agent.*` projection and Realm
read/sync truth. Desktop/Web must not create a public
`runtime.orchestration.*` product namespace, local queue store, or semantic
status truth for same-room orchestration.

## D-LLM-092 — Hardcut Gates

Desktop/Web implementation must fail closed on:

- public prompt assembly for group agent execution
- provider/model selection
- local memory/capability/concurrency verdicts
- group-local same-room queue, fairness, budget, cancellation, or timeout truth
- `GROUP_LIMITED` as a capability enum
- Runtime direct Realm GROUP commit
- direct Realm REST bypass where SDK/Realm typed calls are required
- raw Tauri IPC or local adapter paths that bypass SDK and Runtime authority

## D-LLM-093 — Implementation Status

This contract freezes the consumer hardcut plan only. It does not require
Desktop/Web implementation changes, SDK generated client changes, Runtime
implementation changes, proto changes, or Realm backend changes. Future
implementation admissions must cite this contract and prove no app-local
participation execution truth is introduced.

## Traceability

- `.nimi/spec/sdks/kernel/realm-group-agent-participation-client-contract.md`
- `.nimi/spec/realm/kernel/group-agent-participation-contract.md`
- `.nimi/spec/runtime/kernel/realm-group-participation-consumer-contract.md`
- `.nimi/spec/runtime/kernel/multi-agent-room-orchestration-contract.md`
