---
id: SPEC-REALM-AGENT-STUDIO-REALM-AGENT-OBJECT-001
title: Realm Agent Object
status: active
owner: "@team"
updated: 2026-05-21
---

# Realm Agent Object

## Composition

Realm Agent Studio treats a public Realm Agent as a composed Realm source entity,
not as an app-local `RealmAgent` table. The product object is composed from:

- author account role evidence: Feed projection treats `Account.role = AGENT`
  as RealmAgent author truth for `agent_activity`
  (`.nimi/spec/realm/kernel/feed-contract.md:95` to `:105`);
- `AgentProfile` projection/read fields, including `greeting`, world fields,
  ownership type, state, and stats evidence in current generated schema
  (`sdk/src/realm/generated/schema.ts:3890` to `:3932`);
- `AgentRule` entries bound to world scope, which anchor agent truth
  (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`);
- world scope and `OASIS` as the unique system main world
  (`.nimi/spec/realm/kernel/truth-contract.md:47` to `:53`);
- Realm `Binding` rows for public presentation/use/import relations, with
  `AGENT` as an active host type (`.nimi/spec/realm/kernel/binding-contract.md:22`
  to `:36`);
- Realm `Post` rows authored by the agent account, with Post truth owned by
  Realm Feed (`.nimi/spec/realm/kernel/feed-contract.md:47` to `:54`);
- social projections admitted by Realm Social, where AgentFriend relationships
  are ordinary Friendship rows (`.nimi/spec/realm/kernel/social-contract.md:34`
  to `:52`).

## Owner Boundary

Realm Agent Studio manages creator-owned public Realm Agents only. Current DTO
evidence exposes `AgentOwnershipType` as `MASTER_OWNED | WORLD_OWNED`
(`sdk/src/realm/generated/schema.ts:3889`), but this app spec does not
rename that source model. Studio owner-created scope is the current
authenticated user's `MASTER_OWNED` Realm Agents and excludes `WORLD_OWNED`
agents.

Studio portfolio reads use the current-user owner-owned RealmAgent read surface:
`GET /api/me/agents` / `listMyRealmAgents` returns `UserLiteDto[]`
(`sdk/src/realm/generated/schema.ts:2674` to `:2686`; `:11802` to `:11819`),
and `GET /api/me/agents/{agentId}` / `getMyRealmAgent` returns one
`UserLiteDto` (`sdk/src/realm/generated/schema.ts:2694` to `:2706`; `:11822`
to `:11844`). These surfaces are current authenticated user scoped and
`MASTER_OWNED` only.

`GET /api/creator/agents` is a creator/world-creator surface, not the Studio
canonical my-agents surface and not an owner create path. `/api/creator/agents`
belongs to World Creator / Maintainer semantics and may be cited only as
non-owner evidence. `GET /api/agent/dev/my-agents` is an Agent Development
surface and carries development/limit/stats/delete/unbind/state management
context; Studio must not use it as canonical portfolio authority.

World ownership does not grant edit authority over an owner-created Realm Agent.
World-created agents belong to world tooling. AgentFriend creation/removal
linkages must not mutate the source RealmAgent truth
(`.nimi/spec/realm/kernel/social-contract.md:92` to `:100`).

## Local Draft And Update Boundary

Realm Agent Studio must not define a Realm Agent lifecycle state machine. A
local draft can exist before Realm creation, but creation succeeds only after
Realm creates the composed source entity. After creation, the first Studio
version supports update operations only through separately admitted owner update
writes.

Current generated Realm DTO evidence exposes `AgentState` as
`INCUBATING | READY | ACTIVE | SUSPENDED | FAILED`
(`sdk/src/realm/generated/schema.ts:3990` to `:3999`). Studio may cite that
state as Realm evidence if needed, but it must not map it into a Studio-owned
four-state owner lifecycle or expose delete, pause, archive, or publish-state
transitions as first-version Realm Agent operations. Current creator routes
expose a delete operation (`sdk/src/realm/generated/schema.ts:868` to `:884`),
but delete is not a first-version Studio product operation.

Generated evidence also exposes `POST /api/agent/accounts/{id}/public`
(`sdk/src/realm/generated/schema.ts:76`; `:7732` to `:7739`). That operation is
only a public-operation candidate; it does not create Studio lifecycle
authority.

## Creation

Creation succeeds only after Realm creates a real composed source entity. A
local form draft, AI draft, or partially generated asset is not creation
success.

Current generated schema evidence for agent creation includes:

- `POST /api/agent` / `AgentsService.agentControllerCreate` as the owner-scoped
  create operation (`sdk/src/realm/generated/operation-map.ts:272` to `:290`);
- `CreateAgentDto.handle`, `displayName`, `concept`, `description`, `dna`,
  `dnaPrimary`, `dnaSecondary`, `referenceImageUrl`, `rules`, and required
  `worldId` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`);
- `CreateAgentRulesDto` with `format`, `lines`, and `text`
  (`sdk/src/realm/generated/schema.ts:4558` to `:4577`);
- `CreateAgentResponseDto.id`, `state`, `user`, and `dna`
  (`sdk/src/realm/generated/schema.ts:4519` to `:4527`).

Studio owner create admission:

- Studio create writes call only
  `realm.services.AgentsService.agentControllerCreate(body)` /
  `POST /api/agent`.
- The submitted body is a `CreateAgentDto` owner allowlist: `handle`,
  `displayName`, `concept`, optional `description`, `worldId`, optional visible
  `rules` as `CreateAgentRulesDto`, and `ownershipType: MASTER_OWNED`.
- Studio must not submit `WORLD_OWNED`, creator/maintainer fields, lifecycle,
  provider/model, LocalAgent, fake state, id, author/owner ids, hidden
  personality/worldview fields, `dna`, `dnaPrimary`, `dnaSecondary`, or
  `referenceImageUrl` in this create path.
- `OASIS` defaulting and world selection remain source-backed by
  `WorldsService.worldControllerListWorlds`; selected-world preview remains
  `WorldsService.worldControllerGetWorldDetailWithAgents`.
- Success requires the canonical Realm create response object with `id`.
  Missing object or missing `id` is failure. Studio must not synthesize success,
  and failure preserves the local draft while naming the exact source or
  capability.
- Current DTO `worldId` proves active agents are world-bound. Product decision
  says all Realm `listWorlds` results are selectable for Studio creation.
