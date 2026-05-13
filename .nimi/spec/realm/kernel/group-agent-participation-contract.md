---
id: SPEC-REALM-KERNEL-GROUP-AGENT-PARTICIPATION-001
title: Realm Group Agent Participation Contract
status: active
owner: "@team"
updated: 2026-05-13
---

# Group Agent Participation Contract

> Domain: chat
> Rule family: R-CHAT

## Scope

This contract defines the Realm-owned product surface for Nimi agent participation
inside Realm `GROUP` chat threads. It refines Realm Chat ownership for group
membership, agent slots, trigger evidence, transcript visibility, and
authenticated message commit while consuming Runtime Agent Participation and
Runtime Room Orchestration as upstream execution authorities.

Canonical `R-CHAT-*` rule statements live in `chat-contract.md`. This document
is a slice-specific projection of those rules plus context tables; it must not
create a second rule catalog for the same identifiers.

## Authority Imports

- Realm Chat authority: `R-CHAT-001`, `R-CHAT-002`, `R-CHAT-006`, `R-CHAT-007`.
- Runtime Agent Participation authority: `K-AGCORE-061`, `K-AGCORE-073`,
  `K-AGCORE-086`, `K-AGCORE-104`.
- Runtime Room Orchestration authority: `K-AGCORE-107` through `K-AGCORE-118`,
  especially the closed `realm_group` matrix row and overlay.

### Imported R-CHAT-008

Realm Group Agent Participation is a Realm `GROUP` product surface and Runtime
Agent Participation consumer. Realm owns the `GROUP` thread, membership, roster,
agent-slot metadata, transcript, read/sync, user-visible product controls, and
authenticated message commit. Runtime owns AI execution, prompt assembly,
provider/model routing, memory and capability verdicts, participation
concurrency, candidate output, audit/replay, and same-room orchestration.

### Imported R-CHAT-009

Realm owns the agent slot lifecycle for `GROUP` threads. A group agent slot
identifies the Realm-visible agent participant binding, display state, role, and
enablement posture. Slot lifecycle state must not imply Runtime prompt,
provider/model, memory, capability, concurrency, queue, or execution ownership.

### Imported R-CHAT-010

Realm Group agent triggers are closed to mention, explicit user action, admitted
automation, or product-disabled posture. Each admitted trigger must carry Realm
evidence for thread, membership, slot binding, actor authority, and trigger event
identity before Runtime participation admission. Trigger policy must not define a
group-local scheduler, raw prompt payload, provider/model selection, memory
write, or app-local reply queue.

### Imported R-CHAT-011

Runtime may return only a `REALM_GROUP_MESSAGE_CANDIDATE` for group agent
participation. Realm must authenticate the thread owner, slot binding, author
identity, moderation/refusal posture, and commit authority before creating a
canonical `GROUP` message. Runtime direct commit into Realm `GROUP` transcript
truth is forbidden.

### Imported R-CHAT-012

Realm Group agent participation consumes Runtime profile `realm_group_agent`
defaults. Group context defaults to `DYADIC_PRIVATE_EXCLUDED` memory read scope,
`WRITE_NONE` memory write default, and `PROFILE_LIMITED` capability scope.
Product copy may describe the experience as "group limited", but `GROUP_LIMITED`
is not an admitted Runtime capability enum and must not appear in Realm or
Runtime spec tables.

### Imported R-CHAT-013

Realm and apps may present queued, running, refused, cancelled, timed-out, or
committed group agent participation status only as typed projections sourced
from Runtime `runtime.agent.*` projection authority and Realm commit/read/sync
truth. Realm must not create a public `runtime.orchestration.*` namespace or a
parallel same-room status truth.

### Imported R-CHAT-014

Realm Group agent participation must fail closed if a consumer attempts Desktop
or Web prompt assembly, provider/model routing, group-local queue ownership,
Realm-owned AI execution, app-local memory policy, direct Runtime group commit,
private same-room scheduler, or Runtime Participation axis/profile reopening.
