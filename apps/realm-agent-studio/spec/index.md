---
id: SPEC-REALM-AGENT-STUDIO-INDEX-001
title: Realm Agent Studio Spec Index
status: active
owner: "@team"
updated: 2026-05-22
---

# Realm Agent Studio Spec Index

Realm Agent Studio is the owner operation center for user-owned public Realm
Agents as durable Agent IP. `apps/realm-agent-studio/spec/**` is the admitted
app-slice authority root for this product in the repo. This first stage keeps
the current flat document set as active authority; it does not start UI design,
route design, or app implementation.

## Admission Status

- This directory is the only active Realm Agent Studio app-spec authority root.
- Topic files listed below are evidence inputs only after absorption here; they
  are not active app authority.
- Future structure work may reorganize these documents, but this stage does not
  require `kernel/` or `tables/`.

## Canonical Surface Summary

- `GET /api/me/agents` is the Studio canonical my-agents portfolio list
  surface.
- `GET /api/me/agents/{agentId}` is the Studio canonical my-agents detail
  surface.
- `POST /api/agent` / `AgentsService.agentControllerCreate` is the Studio
  owner-scoped Realm Agent create surface.
- `GET /api/agent/handles/check` /
  `AgentsService.agentControllerCheckHandle` is the Studio create preflight
  handle availability surface. It writes no truth and must not replace Realm
  create confirmation.
- `GET/PATCH /api/me/agents/{agentId}/settings` /
  `MeService.getMyRealmAgentSettings` and
  `MeService.updateMyRealmAgentSettings` are the Studio owner-scoped settings
  read/write surfaces. The write surface compiles owner-reviewed structured
  settings into Realm profile writes and versioned `AgentRule` truth writes; it
  is not raw `AgentRule` CRUD or rule-content review authority.
- `POST /api/agent/accounts/{id}/avatar` /
  `AgentsService.agentControllerSelectAvatar` is the Studio owner-scoped avatar
  URL selection surface. It is not a Resource/Binding upload path.
- `GET/PATCH /api/agent/accounts/{id}/visibility` /
  `AgentsService.agentControllerGetVisibility` and
  `AgentsService.agentControllerUpdateVisibility` are owner-scoped social
  visibility setting surfaces. They must not be mapped into a Realm Agent
  lifecycle or publication state machine.
- `GET /api/creator/agents` and `GET /api/agent/dev/my-agents` are evidence
  inputs only and are not Studio canonical surfaces. `/api/creator/agents` is
  World Creator / Maintainer evidence only and must not be used for owner
  creation.
- Top-level `friendCount` is the only admitted first-version owner-visible
  metric field.

## Read Order

1. `product-scope.md`
2. `realm-agent-object.md`
3. `agent-setting-field-map.md`
4. `asset-and-binding.md`
5. `post-publishing.md`
6. `runtime-ai-consumption.md`
7. `metrics-and-realm-gaps.md`
8. `failure-semantics.md`
9. `storybook.md`

## Authority Inputs

Active inputs:

- `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/product-document.md`
- `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/user-storybook-detailed.md`
- `.nimi/topics/ongoing/2026-05-21-realm-agent-studio-product-flow-storybook/topic.yaml`
- `.nimi/spec/realm/kernel/truth-contract.md`
- `.nimi/spec/realm/kernel/feed-contract.md`
- `.nimi/spec/realm/kernel/attachment-contract.md`
- `.nimi/spec/realm/kernel/resource-contract.md`
- `.nimi/spec/realm/kernel/asset-contract.md`
- `.nimi/spec/realm/kernel/binding-contract.md`
- `.nimi/spec/realm/kernel/social-contract.md`
- `.nimi/spec/runtime/kernel/tables/capability-vocabulary-mapping.yaml`
- `.nimi/spec/runtime/kernel/rpc-surface.md`
- `sdk/src/runtime/types-media.ts`
- `sdk/src/realm/generated/schema.ts` as current generated DTO evidence only.

Superseded topic files `product-flow.md` and `user-storybook.md` are retained
as history and are not active app authority.

## Source Drift

Any topic wording that implies removing Post world attachment is source drift and
is not admitted here. Current Realm Feed authority says Post truth is
world-attached and carries `worldId` (`.nimi/spec/realm/kernel/feed-contract.md:47`
to `:54`). The correct Realm Agent Studio product boundary is that creator UX
does not expose a selected post destination world, and Create Post must not
accept caller-owned `worldId`; Realm server authority resolves `worldId` from
author context (`.nimi/spec/realm/kernel/feed-contract.md:107` to `:118`).

## Boundary

Realm Agent Studio owns only the owner workflow for user-owned public Realm
Agents:

- public identity and owner-editable presentation;
- public setting inputs and visible rule content;
- public visual/media candidates and active public writes through admitted Realm
  paths;
- agent-authored Realm posts after human review;
- owner-visible source status and admitted source-backed signals.

It does not own LocalAgent private runtime state, memory, emotion, cognition,
direct chat, world-owned agents, world NPC tooling, Forge package provenance,
provider/model routing, moderation authority, or Realm truth itself.

This spec tree must not create app-local shadow truth. Every public success state
must resolve to Realm, Runtime, or SDK authority owned outside this app spec.

## UX And App Architecture Guardrail

Realm Agent Studio implementation must follow the established `apps/parentos`
and `apps/desktop` posture for shell, bootstrap, session, navigation, failure
states, and SDK client construction. `apps/parentos/src/shell/renderer/App.tsx`
and `apps/parentos/src/shell/renderer/app-shell/**` are the current concrete
architecture reference for provider composition, shell layout, and auth/session
ownership.

UI implementation must use `nimi-kit` and shared components first. Importing
`nimi-kit` tokens is not sufficient: the first screen, loading states, failure
states, navigation, cards, forms, and reviewed-action surfaces must render as a
coherent kit-first application. Realm Agent Studio must not create a parallel
component system; custom components require a recorded kit gap before
implementation.

Realm and Runtime access must go through the `@nimiplatform/sdk` surfaces. App
code must not use app-local REST bypasses, hardcoded provider/model routing, or
app-owned long-lived auth token storage. When a temporary environment-token
development path exists, it is not acceptable as final app architecture and must
remain visible as an architecture gap until replaced by the shared session
posture used by parentOS/desktop.
