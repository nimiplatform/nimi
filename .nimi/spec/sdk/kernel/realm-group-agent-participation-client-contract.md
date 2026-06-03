# SDK Realm Group Agent Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

The SDK consumes Realm Group Agent Participation as a typed client facade over
Realm `GROUP` evidence, Runtime Agent Participation, and Runtime Room
Orchestration. It does not own prompt assembly, provider/model routing, memory
policy, participation concurrency, same-room queues, or Realm GROUP commit
truth.

## S-RUNTIME-221 Realm Group Client Boundary

SDK may expose Realm Group Agent Participation only as typed methods that bind:

- Realm group product authority `R-CHAT-008` through `R-CHAT-014`
- Runtime consumer authority `K-AGCORE-119` through `K-AGCORE-124`
- Runtime room orchestration `realm_group` row and overlay under
  `K-AGCORE-107` through `K-AGCORE-118`

SDK must not define a separate group-agent execution lane, local prompt builder,
provider/model selector, memory policy, reply queue, same-room scheduler, or
Realm commit shortcut.

## S-RUNTIME-222 Realm Evidence Projection

SDK group agent requests must carry typed Realm references only: group thread,
membership snapshot, agent slot, trigger event, read cursor, optional reply
target, room orchestration projection, and commit handoff references aligned to
`.nimi/spec/runtime/kernel/tables/realm-group-participation-context.yaml`.

SDK must not accept raw prompt blobs, unbounded transcript dumps, app-local
participant lists, canonical chat history defaults, direct commit handles, or
provider/model hints as public group agent inputs.

## S-RUNTIME-223 Candidate And Commit Split

SDK must preserve the split between Runtime candidate output and Realm
authenticated commit. Runtime-facing calls may return
`REALM_GROUP_MESSAGE_CANDIDATE`; Realm-facing calls may submit or observe
authenticated Realm commit. SDK must not expose a helper that makes Runtime
directly write a Realm `GROUP` message.

## S-RUNTIME-224 Status And Refusal Projection

SDK may expose queued, running, refused, cancelled, timed-out, and candidate
states only through typed Runtime `runtime.agent.*` projections plus Realm
commit/read/sync truth. SDK must not publish or normalize a public
`runtime.orchestration.*` namespace for group participation status.

## S-RUNTIME-225 Consumer Hardcut Gates

SDK must fail closed if a Desktop, Web, Avatar, app attempts
to pass public prompt text for execution, choose providers or models, override
Runtime memory/capability/concurrency verdicts, own same-room ordering/fairness/
budget/cancellation/timeout, use `GROUP_LIMITED` as a capability enum, or bypass
Realm authenticated commit.

## S-RUNTIME-226 Implementation Status

This contract freezes the SDK consumer plan only. It does not require production
SDK method implementation, generated client code, proto changes, Desktop/Web UI
work, or app migration. Those changes require downstream implementation
admissions that cite this contract and preserve the hardcut gates.

## Traceability

`S-RUNTIME-221` through `S-RUNTIME-226` define the SDK consumer hardcut for
Realm Group Agent Participation. The SDK remains a typed projection and command
facade over Realm and Runtime owners.

- `S-RUNTIME-221`: client boundary.
- `S-RUNTIME-222`: Realm evidence projection.
- `S-RUNTIME-223`: candidate and commit split.
- `S-RUNTIME-224`: status and refusal projection.
- `S-RUNTIME-225`: consumer hardcut gates.
- `S-RUNTIME-226`: implementation status.
