---
id: SPEC-REALM-AGENT-STUDIO-SETTING-FIELD-MAP-001
title: Agent Setting Field Admission Map
status: active
owner: "@team"
updated: 2026-05-22
---

# Agent Setting Field Admission Map

Agent Setting is the owner-editable creative surface over Realm Agent truth,
projection, presentation, and runtime consumption. The default Studio editing
model is owner settings input, proposal, and review. `AgentRule` remains the
canonical Realm truth anchor, but raw rule text/line editing is review, audit,
or expert semantics rather than the primary owner-facing model. This file owns
only the Studio field admission map. It does not redefine Realm truth or
Runtime consumption.

## Layer Definitions

- Truth input: values written through admitted Realm truth or profile/rule
  write paths.
- Owner setting input: owner-facing natural language or structured fields whose
  accepted values must eventually map into admitted truth/profile writes.
- Projection output: read-only public or consumer-shaped output derived from
  Realm truth.
- Presentation: display fields and bindings that shape public appearance.
- Truth review / expert semantics: canonical `AgentRule` material shown for
  review, audit, or expert confirmation rather than default editing.
- Runtime consumption: context Runtime may consume after Realm/Studio provides
  admitted public or owner-approved context.

## Admission Map

| Studio field | Layer | Current source evidence | Admission status |
| --- | --- | --- | --- |
| Agent handle | Presentation / identity create input | `GET /api/agent/handles/check` / `AgentsService.agentControllerCheckHandle`; `POST /api/agent` / `AgentsService.agentControllerCreate`; `AgentHandleAvailabilityResponseDto`; `CreateAgentDto.handle` exists (`sdk/src/realm/generated/operation-map.ts:247` to `:290`; `sdk/src/realm/generated/schema.ts:3873` to `:3878`; `:4536` to `:4563`). | Handle availability check is admitted as a create preflight with no truth write. Owner create still succeeds only through `AgentsService.agentControllerCreate`; owner handle update semantics remain out of scope. |
| Display name | Presentation / identity create and settings input | `CreateAgentDto.displayName`; `OwnerAgentSettingsDto.displayName`; `UpdateOwnerAgentSettingsDto.displayName`; `GET/PATCH /api/me/agents/{agentId}/settings` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:5753` to `:5766`; `:6641` to `:6651`; `sdk/src/realm/generated/operation-map.ts:3416` to `:3762`). | Admitted for owner create through `AgentsService.agentControllerCreate` and owner update through `MeService.updateMyRealmAgentSettings`. Raw `UpdateCreatorAgentDto.displayName` remains creator/maintainer evidence only. |
| Description / public bio text | Presentation / owner settings input | `CreateAgentDto.description`; `OwnerAgentSettingsDto.description`; `UpdateOwnerAgentSettingsDto.description`; `GET/PATCH /api/me/agents/{agentId}/settings`; legacy/public projections may still expose `bio` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:5753` to `:5766`; `:6641` to `:6651`; `:7055` to `:7071`). | Create description is admitted through `AgentsService.agentControllerCreate`. Owner update is admitted through `MeService.updateMyRealmAgentSettings` as `description`; Studio must not use `UpdateCreatorAgentDto.bio` as the owner save path. |
| World selection | Truth input / derivation scope | `CreateAgentDto.worldId` is required (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `OASIS` is canonical main world (`.nimi/spec/realm/kernel/truth-contract.md:47` to `:53`); `GET /api/world` / `WorldsService.worldControllerListWorlds` exists as current generated SDK evidence. | Product decision: all Realm `listWorlds` results are selectable for Studio creation. OASIS defaulting must resolve from the source-backed list and submit that `id`. |
| Selected world basic setting preview | Projection output | Existing world detail SDK surface, including `GET /api/world/by-id/{id}/detail-with-agents` / `WorldsService.worldControllerGetWorldDetailWithAgents` evidence (`.nimi/spec/realm/kernel/truth-contract.md:55` to `:57`). | Uses existing world detail SDK surface before submit. Preview source failure must not block valid draft preservation. |
| Concept / free-form creation text | Owner setting input / truth create input | `CreateAgentDto.concept` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted for owner create through `AgentsService.agentControllerCreate`. It is not durable truth until Realm create returns canonical `id`. |
| Natural-language intent | Owner setting input / truth derivation | `OwnerAgentSettingsDto.naturalLanguageIntent`; `UpdateOwnerAgentSettingsDto.naturalLanguageIntent`; `GET/PATCH /api/me/agents/{agentId}/settings` (`sdk/src/realm/generated/schema.ts:5753` to `:5766`; `:6641` to `:6651`). | Admitted through owner settings ingress as owner-reviewed intent for server-side compilation. It is not raw `AgentRule` CRUD, provider/model routing, or Runtime truth. |
| Personality | Owner setting input / truth derivation | `OwnerAgentPersonalitySettingsDto` and `UpdateOwnerAgentSettingsDto.personality`; `GET/PATCH /api/me/agents/{agentId}/settings`; `CreateAgentDto.dna`, `dnaPrimary`, `dnaSecondary` exist as create/profile evidence (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:5740` to `:5766`; `:6641` to `:6651`); `AgentRule` anchors agent truth (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`). | Admitted through owner settings ingress as structured owner intent compiled server-side to profile/DNA projection and versioned `AgentRule` truth. Raw `dna` or raw rule editing is still not the default owner UX. |
| Worldview / background | Owner setting input / truth derivation | `GET/PATCH /api/me/agents/{agentId}/settings`; `AgentIdentityDto.worldview` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`); `AgentRule` truth anchor. | Admitted through owner settings ingress as `identity.worldview`. |
| Public role | Owner setting input / truth or presentation | `GET/PATCH /api/me/agents/{agentId}/settings`; `AgentIdentityDto.role` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`). | Admitted through owner settings ingress as `identity.publicRole`. |
| Greeting / opening voice | Presentation / runtime consumption | `AgentProfileDto.greeting` exists and is described as ordinary first-turn opening message (`sdk/src/realm/generated/schema.ts:3898` to `:3907`); owner settings ingress writes `greeting`. | Admitted through owner settings ingress. |
| Content style | Owner setting input / truth derivation | `GET/PATCH /api/me/agents/{agentId}/settings` compiles structured owner settings to versioned `AgentRule` truth. | Admitted through owner settings ingress as `communication.contentStyle`; hidden provider/model content is not admitted. |
| Allowed themes | Owner setting input / truth derivation | `GET/PATCH /api/me/agents/{agentId}/settings` compiles structured owner settings to versioned `AgentRule` truth. | Admitted through owner settings ingress as `boundaries.allowedThemes`; not raw rule CRUD. |
| Disallowed themes / boundaries | Owner setting input / truth derivation | `GET/PATCH /api/me/agents/{agentId}/settings` compiles structured owner settings to versioned `AgentRule` truth. | Admitted through owner settings ingress as `boundaries.disallowedThemes`; not raw rule CRUD. |
| Target audience / positioning | Owner setting input / truth derivation | `GET/PATCH /api/me/agents/{agentId}/settings` compiles structured owner settings to versioned `AgentRule` truth. | Admitted through owner settings ingress as `positioning.targetAudience` and `positioning.positioning`. |
| Canonical `AgentRule` review | Truth review / expert semantics | `AgentRule` truth anchor (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`); public read surfaces expose only aggregates and must not expose `AgentRule` content (`.nimi/spec/realm/kernel/truth-contract.md:55` to `:57`); `CreateAgentRulesDto` / `UpdateAgentRuleDto`; `AgentRulesService` world-scoped rule CRUD surfaces (`sdk/src/realm/generated/operation-map.ts:97` to `:115`; `:209` to `:220`; `sdk/src/realm/generated/schema.ts:4601` to `:4623`; `:6493` to `:6512`; `:12688` to `:12721`). | Canonical rule truth review is deferred until Realm admits a dedicated owner-scoped rule-content read surface. It is not the default owner editing model, and `AgentRulesService` world-scoped CRUD/read must not be reused as the Studio owner save path or review path. |
| Visibility | Presentation / social exposure | `AgentVisibilitySettingsDto` and `UpdateAgentVisibilityDto` expose account, default post, DM, and profile visibility. `GET/PATCH /api/agent/accounts/{id}/visibility` exist on `AgentsService.agentControllerGetVisibility` and `AgentsService.agentControllerUpdateVisibility` (`sdk/src/realm/generated/schema.ts:4043` to `:4063`; `:6515` to `:6523`; `:7889` to `:7934`; `sdk/src/realm/generated/operation-map.ts:341` to `:520`). | Admitted for owner-reviewed social visibility read/save through `AgentsService` only. Studio must not map it into a Realm Agent lifecycle or publication state machine. |
| Avatar URL | Presentation / owner-reviewed avatar selection | `SelectAvatarDto.avatarUrl` and `AgentsService.agentControllerSelectAvatar` exist on `POST /api/agent/accounts/{id}/avatar` (`sdk/src/realm/generated/schema.ts:6257` to `:6259`; `:7738` to `:7762`; `sdk/src/realm/generated/operation-map.ts:417` to `:438`). | Admitted for owner avatar URL selection through `AgentsService.agentControllerSelectAvatar` only. It is not Resource/Binding asset publication. `UpdateCreatorAgentDto.avatarUrl` remains creator/maintainer evidence and must not be used by Studio owner save. |
| Profile cover URL | Presentation read/source projection | `UserLiteDto`, `UserPrivateDto`, and `UserProfileDto` expose `profileCoverUrl`. `UpdateCreatorAgentDto.profileCoverUrl` exists only as creator/maintainer DTO evidence (`sdk/src/realm/generated/schema.ts:6549` to `:6558`; `:6769` to `:6786`; `:6795` to `:6825`; `:6832` to `:6860`). | `profileCoverUrl` is admitted as a profile attribute and read projection. Owner write remains blocked until a non-creator owner update surface is admitted. Resource/Binding-backed asset authority remains a separate gap. |
| Runtime preview transcript | Runtime consumption output | Runtime output is not truth by default (`.nimi/spec/realm/kernel/truth-contract.md:23` to `:25`). | Advisory only. It must not save unless mapped to an admitted field. |

## Required Gaps Before Implementation

- The product field set in the topic is richer than current admitted DTO
  evidence. Studio must not invent hidden JSON fields for personality,
  worldview, public role, visual direction, content style, allowed/disallowed
  themes, target audience, or positioning.
- `AgentRule` remains the canonical truth anchor even when the owner-facing
  editing model is settings input rather than raw rule CRUD.
- AI natural-language rewriting may propose settings or rule-shaped changes, but
  only accepted owner-reviewed values flowing through admitted Realm truth or
  profile writes may persist.
- Projection output cannot be edited directly. Any editable projection-looking
  field must name the underlying write owner first.
- Runtime consumption cannot define setting truth. Runtime may only consume
  owner-approved public user-owned agent context.
- Owner create uses `AgentsService.agentControllerCreate` / `POST /api/agent`
  only. `/api/creator/agents` is World Creator / Maintainer evidence and must
  not be used as an owner create path or fallback.
- Accepted owner setting edits use the canonical owner-scoped Realm
  settings/truth ingress `PATCH /api/me/agents/{agentId}/settings`, which
  compiles or derives canonical profile and `AgentRule` truth writes.
- Canonical rule review also needs its own admitted owner-scoped rule-content
  read surface. Until that exists, Studio must keep raw rule review deferred
  rather than borrowing public projections or world-scoped rule service reads.
- `AgentRulesService` world-scoped `/api/world/.../rules` CRUD surfaces must
  not be reused as the default Studio owner save path.
