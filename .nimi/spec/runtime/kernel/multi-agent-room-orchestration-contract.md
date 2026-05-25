# Multi-Agent Room Orchestration Contract

> Owner Domain: `K-AGCORE-*`

This contract admits Runtime-owned same-room/session orchestration authority for
multi-agent and external-participant contexts.

It materializes wave-1 of
`2026-05-03-multi-agent-room-orchestration-authority`. It does not create SDK,
proto, Desktop, Web, Avatar, Realm, Scenario, OASIS/world, external-entry,
MCP/A2A, app, or runtime implementation surfaces.

## K-AGCORE-107 Room Orchestration Authority

Runtime owns one horizontal same-room/session orchestration authority.

Runtime owns:

- room/session orchestration admission
- participant ordering
- trigger arbitration
- fairness and starvation policy
- queueing policy
- cancellation and timeout policy
- per-room and per-agent budget arbitration
- queue visibility and status projection posture
- external participant admission posture
- commit-race handoff policy

Runtime does not own:

- Realm GROUP thread, membership, message, read-state, sync, or commit truth
- Scenario package, run, branch, replay, transcript, or product truth
- OASIS/world state, event log, ontology, or product truth
- external protocol wire truth
- canonical chat transcript truth
- Desktop, Web, or Avatar UI truth

## K-AGCORE-108 Parent Participation Boundary

Room orchestration extends, but does not reopen, Runtime Agent Participation.

The parent contract remains authoritative for:

- participation prompt assembly and output candidates
- participation profile and axis registries
- `K-AGCORE-073` execution concurrency
- `K-AGCORE-086` concurrency policy table
- memory, capability, promotion, and external-entry participation verdicts

This contract must not add values to
`tables/agent-participation-axis-model.yaml`,
`tables/agent-participation-profiles.yaml`, or
`tables/agent-participation-concurrency-policy.yaml`.

## K-AGCORE-109 Closed Room Orchestration Axis Model

Room orchestration axes are closed and defined by
`tables/room-orchestration-axis-model.yaml`.

The fixed axis families are:

- `room_session_owner`
- `participant_set_source`
- `trigger_arbitration`
- `turn_ordering`
- `fairness_starvation_policy`
- `budget_owner`
- `queue_status_projection`
- `cancellation_timeout_owner`
- `external_participant_admission`
- `commit_race_handoff`

Apps, SDKs, and product domains must not submit open string axis values or
domain-local axis extensions.

## K-AGCORE-110 Domain Matrix Co-Freeze

The room orchestration domain matrix is closed and defined by
`tables/room-orchestration-domain-matrix.yaml`.

The required rows are:

- `realm_group`
- `scenario_sandbox`
- `oasis_world`
- `avatar_companion_presentation_room`
- `external_entry_inside_room`
- `canonical_chat_adjacency`

The matrix columns must match `K-AGCORE-109`. Every required cell must name:

- owner
- allowed evidence source
- forbidden parallel truth
- handoff or refusal posture

Wave-2 may refine domain overlays only after this matrix is closed. Wave-2 must
not first-define rows, columns, owner cells, schedulers, queues, budgets,
cancellation, timeout, external admission, status truth, or commit-race policy.

## K-AGCORE-111 Trigger Arbitration And Turn Ordering

Trigger arbitration, turn ordering, fairness, and starvation rules are defined
by `tables/room-orchestration-trigger-arbitration.yaml`.

Product domains may provide trigger evidence, such as a group message event,
scenario step, world event, avatar presentation event, external protocol signal,
or canonical chat turn reference. Product domains do not own same-room
arbitration, ordering, fairness, or starvation policy.

Missing trigger evidence is fail-closed. Conflicting trigger evidence must be
resolved by Runtime policy before any participant acts.

## K-AGCORE-112 Budget, Cancellation, And Timeout Policy

Room orchestration budget, cancellation, timeout, and exhaustion refusal policy
is defined by `tables/room-orchestration-budget-policy.yaml`.

Per-room and per-agent budget admission remains Runtime-owned and must preserve:

- `K-AGCORE-007` token budget authority
- `K-AGCORE-073` execution concurrency axis
- `K-AGCORE-086` concurrency policy table

Desktop, Web, Avatar, Realm, Scenario, OASIS/world, external-entry, and SDK
must not own room budget, fairness, queue, cancellation, timeout, or
exhaustion decisions.

## K-AGCORE-113 Queue Visibility And Status Projection

Room orchestration status uses existing `runtime.agent.*` projection authority.

Status projection must extend
`tables/runtime-agent-event-projection.yaml` and must not create a public
`runtime.orchestration.*` status namespace.

Allowed room status facts are projection facts only:

- admitted
- queued
- running
- canceled
- timed_out
- refused
- candidate_ready
- handed_off

Projection does not create transcript truth, commit truth, protocol truth, or
UI state truth.

## K-AGCORE-114 External Participant Room Admission

External participants may enter a room only through Runtime gateway verdict
posture.

Required authority references:

- `delegated-capability-gateway-contract.md`
- `delegated-output-firewall-contract.md`
- `delegated-mcp-adapter-contract.md`
- `delegated-a2a-future-seam-contract.md`
- `tables/agent-participation-external-entry-boundaries.yaml`

Protocol-native MCP/A2A readiness, remote agent state, tool availability, or
provider metadata is evidence only. It cannot admit a participant into a room
without Runtime gateway verdict, firewall posture when protocol execution
occurs, credential custody evidence, and audit lineage.

## K-AGCORE-115 Commit-Race Handoff Boundary

Runtime room orchestration may produce output candidates and handoff verdicts.
It must not directly commit domain truth.

Commit truth remains owned by:

- Realm for GROUP transcript/message commit
- Scenario for scenario transcript, run, branch, and replay truth
- OASIS/world for world state, event log, and ontology truth
- canonical chat authority for canonical chat history
- external domain owners for external protocol/domain truth

When multiple participants produce candidates for the same room, Runtime owns
commit-race handoff ordering and refusal posture. The target domain owner owns
whether and how a candidate is committed.

## K-AGCORE-116 Domain Overlay Limitation

Domain overlays may refine presentation, evidence binding, and product-specific
context after the wave-1 matrix is closed.

Domain overlays are registered in
`tables/room-orchestration-domain-overlays.yaml`. That table is overlay truth
only: it may bind product/domain evidence, display/projection guidance, refusal
posture, and future packet references to existing wave-1 matrix rows, but it
must not add or redefine matrix axes, rows, columns, owner cells, schedulers,
queues, budget, cancellation, timeout, external admission, status truth, or
commit-race policy.

Domain overlays must not:

- add matrix rows
- add matrix columns
- add owner cells
- define private schedulers
- define app-local room queues
- define budget, cancellation, timeout, fairness, or starvation policy
- bypass Runtime gateway verdict for external participants
- define direct Runtime domain commits
- split status projection into `runtime.orchestration.*`

## K-AGCORE-117 Room Orchestration Negative Gates

Room orchestration fails closed if any of these appear outside this contract and
its tables:

- app-local room queue as steady-state authority
- Realm, Scenario, OASIS/world, external-entry, Avatar, Desktop, Web, or SDK
  ownership of room ordering, fairness, budget, cancellation, or timeout
- Runtime direct commit of Realm GROUP, Scenario, OASIS/world, canonical chat,
  or external domain truth
- external participant room entry based only on protocol readiness
- new Runtime Participation profile, axis, or concurrency value by implication
- public `runtime.orchestration.*` status truth
- wave-2 first-definition of an axis, row, column, or owner cell

## K-AGCORE-118 Room Orchestration Closure Gates

Wave-1 closure requires all of the following:

- `multi-agent-room-orchestration-contract.md` exists and is referenced by
  `kernel/index.md`
- `room-orchestration-axis-model.yaml` exists and contains every
  `K-AGCORE-109` axis
- `room-orchestration-domain-matrix.yaml` exists and contains every
  `K-AGCORE-110` row and axis column
- `room-orchestration-trigger-arbitration.yaml` exists and covers trigger
  priority, ordering, fairness, and starvation
- `room-orchestration-budget-policy.yaml` exists and covers per-room budget,
  per-agent budget, cancellation, timeout, and exhaustion refusal
- no required axis, row, column, or owner cell is marked TBD, future, later, or
  deferred
- wave-2 is explicitly limited to overlays against the wave-1 matrix
