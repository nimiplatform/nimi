---
id: SPEC-REALM-KERNEL-CHAT-001
title: Realm Chat Kernel Contract
status: active
owner: "@team"
updated: 2026-05-15
---

# Chat Contract

> Domain: chat
> Rule family: R

## Scope

This contract defines the canonical Realm chat surface for `nimi-realm`, including its `DIRECT` and `GROUP` substrates.

## R-CHAT-001

Realm owns Chat as a realm domain. Chat provides the canonical thread, message, read-sync, membership, group lifecycle, and agent-slot metadata surface for realm-managed communication.

## R-CHAT-002

Realm Chat v1 admits `DIRECT` and `GROUP` as canonical chat substrates. `GROUP` threads may contain human participants and agent slots/authors. Realm Chat does not own AI execution, prompt assembly, model routing, session orchestration, or turn execution. `CHANNEL` and any unsupported chat shape must fail-close.

## R-CHAT-003

Social governs admission preconditions for human participants, but canonical chat threads, messages, read state, and sync cursor semantics belong to Chat.

## R-CHAT-004

Human-agent chat, agent-agent chat, model routing, prompt assembly, session orchestration, and turn execution runtime stay outside Realm Chat v1, and group membership does not transfer those responsibilities into Realm.

## R-CHAT-005

Realm Chat canonicalizes non-text attachments as `MessageType.ATTACHMENT` with `payload.attachment` generic envelope. Stable chat APIs must not hard-cut attachment messages to `assetId`-only or `resourceId`-only message payloads.

## R-CHAT-006

Realm Chat owns group admission/admin authority for `GROUP` threads, including lifecycle transitions, roster management, membership roles, and agent-slot metadata. Social only gates human admission preconditions; it does not own group lifecycle or agent-slot state.

## R-CHAT-007

Agent-authored group posts and messages must validate the thread owner/slot binding before commit, read visibility, or sync fanout. Spoofed agent authorship must fail-close.

## R-CHAT-008

Realm Group Agent Participation is a Realm `GROUP` product surface and Runtime
Agent Participation consumer. Realm owns the `GROUP` thread, membership, roster,
agent-slot metadata, transcript, read/sync, user-visible product controls, and
authenticated message commit. Runtime owns AI execution, prompt assembly,
provider/model routing, memory and capability verdicts, participation
concurrency, candidate output, audit/replay, and same-room orchestration.

## R-CHAT-009

Realm owns the agent slot lifecycle for `GROUP` threads. A group agent slot
identifies the Realm-visible agent participant binding, display state, role, and
enablement posture. Slot lifecycle state must not imply Runtime prompt,
provider/model, memory, capability, concurrency, queue, or execution ownership.

## R-CHAT-010

Realm Group agent triggers are closed to mention, explicit user action, admitted
automation, or product-disabled posture. Each admitted trigger must carry Realm
evidence for thread, membership, slot binding, actor authority, and trigger event
identity before Runtime participation admission. Trigger policy must not define a
group-local scheduler, raw prompt payload, provider/model selection, memory
write, or app-local reply queue.

## R-CHAT-011

Runtime may return only a `REALM_GROUP_MESSAGE_CANDIDATE` for group agent
participation. Realm must authenticate candidate lineage, target chat, target
agent slot, author authority, evidence hash, runtime trace reference,
idempotency, moderation/refusal posture, and audit record before creating a
canonical `GROUP` message. Runtime direct commit into Realm `GROUP` transcript
truth is forbidden.

## R-CHAT-012

The only admitted Realm commit-handoff operation for group agent candidates is
`POST /api/human/group-chats/{chatId}/agent-message-candidate-commits` with
`CommitRealmGroupMessageCandidateInputDto`. The historical direct
`POST /api/human/group-chats/{chatId}/agent-messages` operation and
`SendGroupAgentMessageInputDto` are not admitted as compatibility aliases and
must be removed from implementation and OpenAPI.

## R-CHAT-013

Realm Group candidate commit requests must not accept raw `text`, `payload`,
`prompt`, `systemPrompt`, `provider`, `model`, `messageId`, `senderId`, or
caller-owned `agentAccountId` as commit authority. A canonical `messageId` may
appear only in the Realm commit result after validation and storage succeed.

## R-CHAT-014

SDK and Desktop consumers must preserve split Runtime candidate and Realm
commit facades. Collapsed generate-and-commit helpers, Desktop direct REST,
Runtime internal imports, `sendGroupMessage` substitution,
`runtime.agent.turn.request` substitution, renderer-local committed truth, and
synthetic candidate or message success are forbidden.

## R-CHAT-015

Realm Group candidate commit may carry only typed
`REALM_GROUP_MESSAGE_CANDIDATE` output fields derived from the local Runtime
candidate evidence read: candidate ids/refs, `evidenceHash`, `runtimeTraceRef`,
output/audit/policy refs, creation/expiry timestamps, `commitDisposition`, and
either validated `TEXT` body plus `bodyHash` or validated refusal code/reason
plus `refusalHash`. Realm validates authenticated user authority, group
membership, active `realmGroupAgentSlotId`, `localAgentRef`, agent participant
projection, candidate kind, trigger, idempotency, expiry, canonical payload hash,
body/refusal hash, and moderation/refusal posture before storage. Realm must not
require Runtime authorship proof, Runtime attestation, Realm-side Runtime
verifier, evidence escrow, or Realm direct Runtime access for this group chat
commit path. Commit requests must still not carry raw prompt text, raw provider
output, provider/model selection, untyped payload, caller-owned `messageId`,
caller-owned `senderId`, or caller-owned agent identity as commit authority.

## R-CHAT-016

`realmGroupAgentSlotId` is the durable Realm identity for a local Agent
participation binding inside a specific `GROUP` thread. It is distinct from the
Realm Agent source identity (`realmAgentId`) and from human membership identity.
The executable local Agent reference is
`localAgentRef = local-agent:${ownerUserId}:${realmAgentId}`; multiple users may
have private local forks of the same `realmAgentId`. Realm Group candidate
commit must validate that the candidate snapshot binds the same active
`realmGroupAgentSlotId`, target `chatId`, and `localAgentRef` before creating a
message. `realmAgentId` must not be used alone as a group participation slot or
executable local Agent reference.

## R-CHAT-017

Realm Agent source identity and executable local Agent identity are distinct.
`realmAgentId` identifies the Realm Agent source entity, including Realm truth,
Realm projection, world relationships, social visibility, and friendship
relationships. `localAgentRef = local-agent:${ownerUserId}:${realmAgentId}`
identifies the owner-scoped executable local fork. Local execution, direct
Human-Agent local chat, local memory, local projection, avatar binding, Agent
Center resources, Runtime Agent records, SDK/IPC conversation anchors, and group
Runtime candidate handoff must not be keyed or authorized by bare `realmAgentId`
or `agentId`.

## R-CHAT-018

Human-Agent `DIRECT` chat is admitted only as a Private Desktop local-chat
product route after Realm friendship/admission checks. It must create or reuse
the owner-scoped local Agent fork identified by
`localAgentRef = local-agent:${ownerUserId}:${realmAgentId}` and must persist
local thread identity by `localAgentRef`. Realm `DIRECT` cloud transcript truth
remains Human-Human only for this path; Desktop, SDK, Runtime, and local stores
must not convert Human-Agent local chat into a Realm cloud `DIRECT` transcript
or use `realmAgentId` alone as the local thread key.

## R-CHAT-019

All consumers of local Agent execution identity must carry both Realm source
metadata and local execution identity. The required minimum identity tuple is
`ownerUserId`, `realmAgentId`, and `localAgentRef`; `realmAgentId` may be stored
only as source metadata and must not be sufficient authority for execution,
memory, projection, avatar, Agent Center package/config, or conversation-anchor
selection. Missing or mismatched tuple fields must fail-close. Legacy aliases,
dual read/write compatibility, synthetic success, and renderer-local shadow
truth are forbidden.

## R-CHAT-020

V1 admits exactly one canonical local Agent execution fork for a given
`ownerUserId + realmAgentId` pair, addressed by
`localAgentRef = local-agent:${ownerUserId}:${realmAgentId}`. Any product need
for multiple simultaneous local forks of the same Realm Agent for one owner, or
for an opaque persisted `localAgentId` distinct from that deterministic
`localAgentRef`, requires a new admitted authority decision before
implementation. Until such authority exists, implementation must hard-cut to the
deterministic `localAgentRef` identity and fail closed on ambiguous fork
cardinality.
