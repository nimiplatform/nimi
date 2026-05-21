---
id: SPEC-REALM-AGENT-STUDIO-METRICS-GAPS-001
title: Metrics And Realm Gaps
status: active
owner: "@team"
updated: 2026-05-21
---

# Metrics And Realm Gaps

Studio may show only source-backed owner-visible signals. Unavailable source is
a product state, not zero.

## friendCount

`friendCount` / 好友数 is the only first-version eligible metric and is now
source backed for owner portfolio reads through Realm support. Studio may show
`UserLiteDto.friendCount` only when it is present on Realm DTOs; an absent field
remains source unavailable, not zero.

Current Realm Social authority admits AgentFriend relationships as ordinary
Friendship rows and keeps Social separate from runtime/model execution
(`.nimi/spec/realm/kernel/social-contract.md:18` to `:32`; `:34` to `:52`).
That relationship authority does not by itself admit an owner-visible aggregate
count surface for Studio.

Current DTO evidence closes the owner-visible count gap:

- `UserLiteDto.friendCount` is the owner-visible count field
  (`sdk/src/realm/generated/schema.ts:6769` to `:6786`). For RealmAgent users,
  Realm derives it from active `HUMAN_AGENT` Friendship rows attached to the
  user/agent;
- owner portfolio user projections carry `agent`, `agentProfile`,
  `profileCoverUrl`, and `friendCount`;
- `AgentFriendLimitDto.used` is the current user's quota usage, not a public
  owner-visible count for a specific Realm Agent
  (`sdk/src/realm/generated/schema.ts:3801` to `:3808`).

Studio must not infer `friendCount` from LocalAgent forks, adoption data,
quota usage, or runtime-local state.

## World List

Product decision: all worlds returned by Realm `listWorlds` are selectable for
Realm Agent creation. Studio admission no longer treats selectable-world
semantics as an open product gap; it only needs to cite the existing Realm
world-list and world detail SDK surfaces used by the app.

Current source evidence:

- `GET /api/world` is listed as a secondary Realm truth operation
  (`.nimi/spec/realm/kernel/tables/truth-contract.yaml:195` to `:198`);
- generated schema exposes `GET /api/world` / `WorldController_listWorlds` as
  "List worlds (defaults to ACTIVE)" with optional `status` query and
  `WorldDetailDto[]` response
(`sdk/src/realm/generated/schema.ts:2900` to `:2908`;
  `sdk/src/realm/generated/schema.ts:12117` to `:12135`);
- `OASIS` is the unique system main world and `GET /api/world/oasis` is a
  formal truth read surface (`.nimi/spec/realm/kernel/truth-contract.md:47` to
  `:53`).

Remaining citation/details work:

- whether Studio defaulting to `OASIS` means resolving `GET /api/world/oasis`
  and submitting its `id`, or whether Realm should admit server-side defaulting;
- which fields in the existing world detail SDK response constitute "selected
  world's basic setting";
- which permission failures and empty-list states apply to Studio creation.

Studio must not maintain an app-local world catalog as product truth.

## Portfolio Read Surface

Studio uses the current-user owner-owned RealmAgent list/read surface as the
first-version my-agents / owner-created-agents portfolio read surface. Its
backend semantics are current authenticated user scope and `MASTER_OWNED` only;
`WORLD_OWNED` / NPC agents are not Studio portfolio items.

Current evidence:

- `GET /api/me/agents` / `listMyRealmAgents` returns `UserLiteDto[]`
  (`sdk/src/realm/generated/schema.ts:2674` to `:2686`; `:11802` to `:11819`);
- `GET /api/me/agents/{agentId}` / `getMyRealmAgent` returns one `UserLiteDto`
  (`sdk/src/realm/generated/schema.ts:2694` to `:2706`; `:11822` to `:11844`);
- `UserLiteDto` carries `agent`, `agentProfile`, `profileCoverUrl`, and
  `friendCount` projections (`sdk/src/realm/generated/schema.ts:6769` to
  `:6786`);
- `AgentOwnershipType` is `MASTER_OWNED | WORLD_OWNED`
  (`sdk/src/realm/generated/schema.ts:3889`).

`GET /api/creator/agents` remains creator/world-creator evidence and must not
be cited as Studio canonical my-agents. `GET /api/agent/dev/my-agents` remains
Agent Development evidence and must not pull limit/stats/delete/unbind or
lifecycle-ish state management semantics into Studio.

Remaining portfolio gaps are pagination/sort/filter semantics, the final
field-level portfolio DTO, and app-local draft reconciliation. Studio must not
map Realm-created agents into a draft/public/paused/archived lifecycle.

## Deferred Metrics

The following remain out of current admitted scope:

- `friendCount` trend;
- profile views and page clicks;
- post performance;
- reactions, shares, reposts, comments, and likes as portfolio metrics;
- activity freshness scoring;
- portfolio health score;
- gift, revenue, settlement, payout, or economic views;
- asset or setting change impact attribution.

If an operation log or recent failure is shown near a metric, it must be labeled
as operation context, not causal performance evidence.
