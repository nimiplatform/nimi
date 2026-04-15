---
id: SPEC-REALM-KERNEL-CHAT-001
title: Realm Chat Kernel Contract
status: active
owner: "@team"
updated: 2026-03-25
---

# Chat Contract

> Domain: chat
> Rule family: R

## Scope

This contract defines the canonical Realm chat surface for `nimi-realm`.

## R-CHAT-001

Realm owns Chat as a realm domain. Chat provides the canonical thread/message/read-sync surface for realm-managed communication.

## R-CHAT-002

Realm Chat v1 supports only `HUMAN_HUMAN` `DIRECT` chat. Channel and unspecified non-human participant types must fail-close. GROUP is admitted by R-CHAT-002a.

## R-CHAT-002a

Realm Chat supports `GROUP` threads alongside `DIRECT`. A GROUP thread has a typed participant list as its canonical membership truth.

Constraints:

- GROUP creation requires at least two human participants.
- GROUP participants are typed: `human` (with userId and role) or `agent` (with agentId and ownerUserId).
- Agent participant slots are thread metadata. They do not imply or authorize Realm-side AI execution, prompt assembly, model routing, or budget tracking. R-CHAT-004 remains in force.
- Realm applies the same content pipeline (storage, moderation, sync) to all messages regardless of author type.
- DIRECT threads continue to use `accountIdL / accountIdH` as their canonical membership representation. GROUP threads use the participant list exclusively. The two thread types coexist with independent data paths.
- Human-only GROUP threads and mixed human-plus-agent GROUP threads share the same `GROUP` chat type. A human-only group is a GROUP with zero agent participant slots.

Canonical vocabulary:

```
GroupParticipant =
  | { type: 'human'; userId: string; role: 'admin' | 'member' }
  | { type: 'agent'; agentId: string; ownerUserId: string }

GroupMessageAuthor =
  | { type: 'human'; userId: string }
  | { type: 'agent'; agentId: string; ownerUserId: string }
```

These shapes are canonical vocabulary. Persistence representation and DTO serialization are implementation decisions.

## R-CHAT-003

Social governs admission and preconditions for human chat, but canonical chat threads, messages, read state, and sync cursor semantics belong to Chat.

## R-CHAT-004

Human-agent chat, agent-agent chat, model routing, prompt assembly, session orchestration, and turn execution runtime stay outside Realm Chat v1.

## R-CHAT-005

Realm Chat canonicalizes non-text attachments as `MessageType.ATTACHMENT` with `payload.attachment` generic envelope. Stable chat APIs must not hard-cut attachment messages to `assetId`-only or `resourceId`-only message payloads.

## R-CHAT-006

GROUP admission and administration follow a split-authority model consistent with R-CHAT-003.

Admission preconditions:

- Social governs whether a human may be invited to a GROUP (blocking, relationship status, platform-level restrictions). Chat enforces the thread-level add/remove operation after Social preconditions pass.
- Agent slot admission is owned by Chat, not Social. An agent slot is thread metadata bound to a human participant, not a social relationship.

Admin rules:

- The group creator is the initial admin.
- Admin can invite or remove human participants (subject to Social preconditions).
- Any human participant can add or remove their own agents. Agent addition requires the requesting user to be a current human participant and the agent's owner.
- Admin can remove any participant, including another owner's agent (moderation override).
- Admin transfer is explicit. There is no automatic admin succession.
- Removing the last admin is forbidden; admin must transfer before leaving.

Agent slot constraints:

- An agent slot can only be created by a request from the agent's ownerUserId.
- ownerUserId must be a current human participant in the group.
- Realm does not validate agent capability, behavior, or runtime existence. That responsibility belongs to the desktop/runtime layer.

## R-CHAT-007

Agent-authored messages in GROUP threads require post-authorization verification (anti-spoof).

Realm must verify all of the following before admitting an agent-authored message:

1. The authenticated API caller is the ownerUserId of the agent participant slot.
2. The agent has an active participant slot in the target GROUP thread.
3. The slot's ownerUserId matches the authenticated caller.

Violations:

- Posting as an agent not owned by the caller is a contract violation.
- Posting to a GROUP where the agent has no active slot is rejected.
- Posting to a GROUP where the caller is not a human participant is rejected.

This rule does not apply to DIRECT threads, which do not have agent participant slots.
