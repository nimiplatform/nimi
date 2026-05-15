# Companion Participation Projection Contract

> Owner Domain: `K-AGCORE-*`

This contract defines the Runtime-owned projection emitted to Avatar
companion/persona, Desktop, SDK, and debug/probe consumers for participation
status. It is downstream of Runtime Agent Participation and room orchestration.

## K-AGCORE-125 Projection Ownership

Runtime owns `CompanionParticipationProjection`. Apps and SDKs may render or
transport it but must not reinterpret it as execution, queue, memory, or commit
truth.

## K-AGCORE-126 Required Projection Shape

Every projection must include:

- `projection_id`
- `agent_id`
- `surface_kind`
- `profile_ref`
- `trigger_source`
- `status`
- `audit_ref`

Domain or multi-participant contexts must also include
`room_orchestration_ref`.

Execution outcomes must use `candidate_ref`, `commit_ref`, and
`refusal_reason` fields instead of embedding raw prompt, raw APML, raw domain
payload, or provider output.

Runtime exposes the projection and control boundary through
`RuntimeAgentService`:

- `GetCompanionParticipationProjection`
- `RequestCompanionParticipation`
- `CancelCompanionParticipation`
- `OpenCompanionParticipationReplay`

These methods are the canonical product-code Runtime entrypoint for Avatar
companion participation. They may bridge to canonical Runtime chat execution,
but the projection object itself remains ref/status only.

## K-AGCORE-127 Status Values

Closed status values:

- `idle`
- `admission_pending`
- `blocked`
- `running`
- `candidate_ready`
- `committed_by_owner`
- `failed`
- `canceled`

Unknown status values fail closed at SDK/app consumers.

## K-AGCORE-128 Candidate And Commit Boundary

`candidate_ready` means Runtime produced a candidate. It does not authorize
domain commit, canonical chat commit, memory write, cognition write, or
AgentRule mutation.

`committed_by_owner` may be projected only after the owning domain or canonical
chat authority reports a typed commit reference.

## K-AGCORE-129 Raw Payload Hard Cut

Runtime must not expose raw prompt blobs, raw APML/debug payloads, provider
request/response payloads, MCP/A2A protocol payloads, memory material, or domain
state blobs through the companion projection.

`RequestCompanionParticipation` may carry bounded user-authored text as control
input for a `user_explicit` turn. Runtime must convert it into canonical
Runtime-owned chat execution and must not echo that text, generated APML,
provider payloads, or model output through `CompanionParticipationProjection`,
replay refs, audit refs, candidate refs, or commit refs.

## K-AGCORE-130 Trigger Source Boundary

Trigger sources are causes, not authority grants. `user_explicit`,
`scheduled_proactive`, and `domain_event` must pass through Runtime
participation admission and room/session orchestration when applicable.

## K-AGCORE-131 Failure And Refusal Projection

Runtime refusal, missing domain evidence, invalid room orchestration, budget
denial, cancellation, policy denial, and profile mismatch must project as
`blocked`, `failed`, or `canceled` with a typed `refusal_reason`. Apps must not
turn these into synthetic candidates.

## K-AGCORE-132 Overlay Binding

The `avatar_companion_presentation_room` row in
`tables/room-orchestration-domain-overlays.yaml` is a projection overlay. It
does not create a new participation profile or execution owner.
