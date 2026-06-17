---
id: SPEC-RUNTIME-KERNEL-REALM-GROUP-PARTICIPATION-CONSUMER-001
title: Realm Group Participation Consumer Contract
status: active
owner: "@team"
updated: 2026-05-13
---

# Realm Group Participation Consumer Contract

> Domain: K-AGCORE
> Rule family: K

## Scope

This contract defines the Runtime-side consumer boundary for Realm `GROUP` agent
participation. It binds the `realm_group_source` Runtime Participation profile to
Realm-owned group thread, membership, slot, trigger, and commit evidence without
creating a new Runtime Participation axis, Room Orchestration axis, or app-local
execution path.

## Authority Imports

- Runtime Agent Participation: `K-AGCORE-061`, `K-AGCORE-073`,
  `K-AGCORE-086`, `K-AGCORE-104`.
- Runtime Room Orchestration: `K-AGCORE-107` through `K-AGCORE-118`.
- Realm Group product authority: `R-CHAT-008` through `R-CHAT-014`.

## K-AGCORE-119

Realm Group participation is a Runtime Agent Participation consumer bound to the
existing `realm_group_source` profile. Runtime must not create a new participation
profile, concurrency axis value, capability scope, or memory policy for this
product surface.

## K-AGCORE-120

Runtime `realm_group_source` admission must consume only typed Realm group context
references declared in `tables/realm-group-participation-context.yaml`. Context
may include thread, membership snapshot, agent slot, trigger event, read cursor,
reply target, room orchestration, and Realm commit handoff references. Raw prompt
blobs, provider/model hints, unbounded transcript dumps, app-local participant
lists, and direct commit handles are forbidden context inputs.

## K-AGCORE-121

Runtime may produce `REALM_GROUP_MESSAGE_CANDIDATE` output only. Candidate output
must carry enough lineage for Realm to validate thread owner, slot binding,
trigger evidence, moderation/refusal posture, and audit/replay before commit.
Runtime must not directly write Realm `GROUP` messages or mark Realm commit as
successful.

## K-AGCORE-122

Realm Group participation inherits Runtime Agent Participation policy for memory
read scope, memory write default, capability scope, and same-agent concurrency.
The product default remains `DYADIC_PRIVATE_EXCLUDED`, `WRITE_NONE`, and
`PROFILE_LIMITED`. Runtime must fail closed if a consumer requests `GROUP_LIMITED`
or group-local memory write/default concurrency values outside the closed
participation tables.

## K-AGCORE-123

Same-room ordering, fairness, queueing, budget allocation, cancellation, timeout,
status projection, external participant admission, and commit-race handoff for
Realm Group participation are owned by Runtime Room Orchestration. Runtime
consumers must bind to the closed `realm_group` matrix row and overlay and must
not accept a Realm, SDK, Desktop, Web, or app-local same-room scheduler.

## K-AGCORE-124

Realm Group participation consumer implementation must fail closed on Desktop or
Web prompt assembly, provider/model routing, app-local reply queue truth,
Runtime direct Realm commit, public `runtime.orchestration.*` status namespace,
external participant gateway bypass, or any reopening of `K-AGCORE-073`,
`K-AGCORE-086`, the Runtime Participation profile registry, or the Room
Orchestration axis/matrix/overlay registries.
