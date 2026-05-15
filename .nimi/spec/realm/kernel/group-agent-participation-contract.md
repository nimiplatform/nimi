---
id: SPEC-REALM-KERNEL-GROUP-AGENT-PARTICIPATION-001
title: Realm Group Agent Participation Contract
status: active
owner: "@team"
updated: 2026-05-15
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

The only admitted Realm commit-handoff operation for group agent candidates is
`POST /api/human/group-chats/{chatId}/agent-message-candidate-commits` with
`CommitRealmGroupMessageCandidateInputDto`. The historical direct
`POST /api/human/group-chats/{chatId}/agent-messages` operation and
`SendGroupAgentMessageInputDto` are not admitted as compatibility aliases and
must be removed from implementation and OpenAPI.

### Imported R-CHAT-013

Realm Group candidate commit requests must not accept raw `text`, `payload`,
`prompt`, `systemPrompt`, `provider`, `model`, `messageId`, `senderId`, or
caller-owned `agentAccountId` as commit authority. A canonical `messageId` may
appear only in the Realm commit result after validation and storage succeed.

### Imported R-CHAT-014

SDK and Desktop consumers must preserve split Runtime candidate and Realm commit
facades. Collapsed generate-and-commit helpers, Desktop direct REST, Runtime
internal imports, `sendGroupMessage` substitution, `runtime.agent.turn.request`
substitution, renderer-local committed truth, and synthetic candidate or message
success are forbidden.

### Imported R-CHAT-015

Realm Group candidate commit may carry only typed
`REALM_GROUP_MESSAGE_CANDIDATE` output fields derived from the local Runtime
candidate evidence read. Realm validates authenticated user authority, group
membership, active `realmGroupAgentSlotId`, `localAgentRef`, agent participant
projection, candidate kind, trigger, idempotency, expiry, canonical payload hash,
body/refusal hash, and moderation/refusal posture before storage. Realm must not
require Runtime authorship proof, Runtime attestation, Realm-side Runtime
verifier, evidence escrow, or Realm direct Runtime access for this group chat
commit path.

### Imported R-CHAT-016

`realmGroupAgentSlotId` is the durable Realm identity for a local Agent
participation binding inside a specific `GROUP` thread. The executable local
Agent reference is `localAgentRef = local-agent:${ownerUserId}:${realmAgentId}`;
`realmAgentId` alone is not a valid group participation slot or executable local
Agent reference.
