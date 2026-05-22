---
id: SPEC-REALM-AGENT-STUDIO-PRODUCT-SCOPE-001
title: Realm Agent Studio Product Scope
status: active
owner: "@team"
updated: 2026-05-22
---

# Product Scope

## Product Position

Realm Agent Studio is for agent owners who incubate and operate user-owned
public Realm Agents as durable Agent IP. It is not a general agent management
center. It does not manage LocalAgent private runtime forks, world-created
agents, world NPCs, or Forge package sources.

The primary user is an agent owner who may operate one public Realm Agent or a
portfolio of public Realm Agents. The first-version depth is owner-only: no
invited editors, no team workspace, and no world-owner override over
owner-created agents.

## In Scope

- Portfolio scan of user-owned Realm Agents with app-local draft or
  Realm-created status, selected world, last updated state, and source
  availability.
- Create Realm Agent with public identity, `OASIS` default world, optional world
  selection from any Realm `listWorlds` result by product decision,
  handle availability preflight, selected-world basic setting preview from
  existing world detail, and visible public fields before submit.
- Update canonical public setting through owner settings input: natural
  language, structured setting fields, AI proposal/review, and canonical rule
  review only when an admitted owner-scoped rule-content read surface exists.
- Generate or upload visual/media candidates, keep app-local preview/history
  only, and mark assets public only after Realm write succeeds.
- Generate voice-demo candidates through Runtime `audio.synthesize` when the
  route is available, with current SDK use through `media.tts.synthesize`.
- Compose agent-authored Realm posts with canonical attachment envelope targets,
  human review, moderation status, and Realm publish result.
- App-local single schedule for one human-reviewed local post draft.
- `friendCount` / 好友数 from Realm `UserLiteDto.friendCount` when the source
  field is present. For RealmAgent users, Realm derives it from human-agent
  Friendship rows.
- App shell, session posture, navigation, loading/failure states, and SDK client
  construction must follow `apps/parentos` / `apps/desktop` patterns. The app
  must use `nimi-kit` as the visible interaction system and `@nimiplatform/sdk`
  for Realm/Runtime access.

## Out Of Scope

- LocalAgent private memory, emotion, cognition, runtime state, or app-specific
  memory fragments.
- RealmAgent direct chat as a Studio feature.
- World-created agents, world-owned NPCs, package-derived world agents, and
  world maintainer tooling.
- Forge `agentBlueprint` provenance or package-to-RealmAgent import mapping.
- World transfer.
- Team collaboration, invited editors, shared operation, or workspace roles.
- Explicit raw `AgentRule` CRUD as the default owner-facing editing model.
- Setting version history, rollback, diff impact attribution, and productized
  notification to existing LocalAgent forks.
- Campaign calendars, recurring schedules, auto queues, bulk automation, and
  post performance analytics.
- Gift, revenue, settlement, payout, and economic surfaces.
- Profile-view metrics until Realm admits view-event authority.
- A standalone visual shell, ad hoc design system, app-owned long-lived auth
  token storage, or app-level REST bypass around the SDK.

## First-Version Depth

Many-agent operation is list, filter, sort, and manual action. Saved filters may
exist only as app-local view preferences and must not become queue, cohort, or
campaign truth.

AI is embedded inside concrete owner workflows. AI output is draft or candidate
material until the owner accepts it and the relevant Realm write succeeds.

`AgentRule` remains the canonical Realm truth anchor for owner-created agent
behavior and policy. Studio does not make explicit raw `AgentRule` editing the
default owner UX. The default owner model is settings input, proposal, review,
and acceptance; raw rule text/lines are review, audit, or expert semantics only
after an admitted owner-scoped rule-content read surface exists.

Accepted owner setting edits flow through the canonical owner-scoped Realm
ingress `PATCH /api/me/agents/{agentId}/settings`, which derives or compiles
canonical truth writes. Studio must not reuse `AgentRulesService` world-scoped
`/api/world/.../rules` CRUD semantics as the default owner save path.

Public success requires the authoritative operation to succeed. Local draft
save, local asset preview, AI generation, and local schedule creation are never
Realm publish or public asset success.

## Source References

- Topic product authority draft:
  `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/product-document.md`
- Topic detailed storybook:
  `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/user-storybook-detailed.md`
- Topic boundary and forbidden shortcuts:
  `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/topic.yaml`
