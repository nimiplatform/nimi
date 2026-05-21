---
id: SPEC-REALM-AGENT-STUDIO-SETTING-FIELD-MAP-001
title: Agent Setting Field Admission Map
status: active
owner: "@team"
updated: 2026-05-21
---

# Agent Setting Field Admission Map

Agent Setting is the owner-editable creative surface over Realm Agent truth,
projection, presentation, and runtime consumption. This file owns only the
Studio field admission map. It does not redefine Realm truth or Runtime
consumption.

## Layer Definitions

- Truth input: values written through admitted Realm truth or profile/rule
  write paths.
- Projection output: read-only public or consumer-shaped output derived from
  Realm truth.
- Presentation: display fields and bindings that shape public appearance.
- Runtime consumption: context Runtime may consume after Realm/Studio provides
  admitted public or owner-approved context.

## Admission Map

| Studio field | Layer | Current source evidence | Admission status |
| --- | --- | --- | --- |
| Agent handle | Presentation / identity create input | `POST /api/agent` / `AgentsService.agentControllerCreate`; `CreateAgentDto.handle` exists (`sdk/src/realm/generated/operation-map.ts:272` to `:290`; `sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted for owner create only through `AgentsService.agentControllerCreate`. Owner-created uniqueness and update semantics remain Realm/app admission gaps. |
| Display name | Presentation / identity create input | `CreateAgentDto.displayName`; `UpdateCreatorAgentDto.displayName` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:6549` to `:6558`). | Admitted for owner create through `AgentsService.agentControllerCreate`. The exact owner update and Account/Profile split is a Realm source gap. |
| Public bio | Presentation / projection input candidate | `UpdateCreatorAgentDto.bio` (`sdk/src/realm/generated/schema.ts:6549` to `:6558`); `WorldAgentSummaryDto.bio` projection evidence (`sdk/src/realm/generated/schema.ts:7055` to `:7071`). | Source exists as DTO evidence. Canonical owner field is not admitted here. |
| World selection | Truth input / derivation scope | `CreateAgentDto.worldId` is required (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `OASIS` is canonical main world (`.nimi/spec/realm/kernel/truth-contract.md:47` to `:53`); `GET /api/world` / `WorldsService.worldControllerListWorlds` exists as current generated SDK evidence. | Product decision: all Realm `listWorlds` results are selectable for Studio creation. OASIS defaulting must resolve from the source-backed list and submit that `id`. |
| Selected world basic setting preview | Projection output | Existing world detail SDK surface, including `GET /api/world/by-id/{id}/detail-with-agents` / `WorldsService.worldControllerGetWorldDetailWithAgents` evidence (`.nimi/spec/realm/kernel/truth-contract.md:55` to `:57`). | Uses existing world detail SDK surface before submit. Preview source failure must not block valid draft preservation. |
| Concept / free-form creation text | Truth create input | `CreateAgentDto.concept` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted for owner create through `AgentsService.agentControllerCreate`. It is not durable truth until Realm create returns canonical `id`. |
| Description | Presentation / projection create input | `CreateAgentDto.description` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted as optional owner create body field through `AgentsService.agentControllerCreate`. Canonical update owner remains not fully pinned. |
| Personality | Truth input candidate | `CreateAgentDto.dna`, `dnaPrimary`, `dnaSecondary` exist (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `AgentRule` anchors agent truth (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`). | Partial source. Field-level DTO ownership remains a gap beyond DNA/rule carrier. |
| Worldview / background | Truth input candidate | `CreateAgentDto.dna`; `AgentIdentityDto.worldview` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`); `AgentRule` truth anchor. | Gap. No complete Studio write field is admitted for background/worldview. |
| Public role | Truth input / presentation candidate | `AgentIdentityDto.role` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`). | Gap. Current create/update owner path for this exact field is not fully pinned. |
| Greeting / opening voice | Presentation / runtime consumption candidate | `AgentProfileDto.greeting` exists and is described as ordinary first-turn opening message (`sdk/src/realm/generated/schema.ts:3898` to `:3907`). | Read/source exists. Owner update path is not admitted. |
| Content style | Truth create input candidate | `CreateAgentRulesDto` and `UpdateAgentRuleDto` carry rule text and rule fields (`sdk/src/realm/generated/schema.ts:4558` to `:4577`; `:6447` to `:6468`). | Create may include only visible owner-reviewed `CreateAgentRulesDto` lines. Hidden personality/worldview/provider/model content is not admitted. |
| Allowed themes | Truth input candidate | Rule fields can carry statements, category, hardness, scope, structured payload. | Gap if product wants a dedicated field; otherwise use visible `AgentRule`. |
| Disallowed themes / boundaries | Truth input candidate | `UpdateAgentRuleDto` can update rule statements and hardness. | Gap if product wants a dedicated field; otherwise use visible `AgentRule`. |
| Target audience / positioning | Presentation or rule candidate | `UpdateCreatorAgentDto.tags` and `bio` exist (`sdk/src/realm/generated/schema.ts:6549` to `:6558`). | Gap. No admitted target-audience truth field. |
| Visibility | Presentation / social exposure | `AgentVisibilitySettingsDto` and `UpdateAgentVisibilityDto` expose account, default post, DM, and profile visibility. `GET/PATCH /api/agent/accounts/{id}/visibility` exist on `AgentsService.agentControllerGetVisibility` and `AgentsService.agentControllerUpdateVisibility` (`sdk/src/realm/generated/schema.ts:4043` to `:4063`; `:6515` to `:6523`; `:7889` to `:7934`; `sdk/src/realm/generated/operation-map.ts:341` to `:520`). | Admitted for owner-reviewed social visibility read/save through `AgentsService` only. Studio must not map it into a Realm Agent lifecycle or publication state machine. |
| Avatar URL | Presentation / owner-reviewed avatar selection | `SelectAvatarDto.avatarUrl` and `AgentsService.agentControllerSelectAvatar` exist on `POST /api/agent/accounts/{id}/avatar` (`sdk/src/realm/generated/schema.ts:6257` to `:6259`; `:7738` to `:7762`; `sdk/src/realm/generated/operation-map.ts:417` to `:438`). | Admitted for owner avatar URL selection through `AgentsService.agentControllerSelectAvatar` only. It is not Resource/Binding asset publication. `UpdateCreatorAgentDto.avatarUrl` remains creator/maintainer evidence and must not be used by Studio owner save. |
| Profile cover URL | Presentation read/source projection | `UserLiteDto`, `UserPrivateDto`, and `UserProfileDto` expose `profileCoverUrl`. `UpdateCreatorAgentDto.profileCoverUrl` exists only as creator/maintainer DTO evidence (`sdk/src/realm/generated/schema.ts:6549` to `:6558`; `:6769` to `:6786`; `:6795` to `:6825`; `:6832` to `:6860`). | `profileCoverUrl` is admitted as a profile attribute and read projection. Owner write remains blocked until a non-creator owner update surface is admitted. Resource/Binding-backed asset authority remains a separate gap. |
| Runtime preview transcript | Runtime consumption output | Runtime output is not truth by default (`.nimi/spec/realm/kernel/truth-contract.md:23` to `:25`). | Advisory only. It must not save unless mapped to an admitted field. |

## Required Gaps Before Implementation

- The product field set in the topic is richer than current admitted DTO
  evidence. Studio must not invent hidden JSON fields for personality,
  worldview, public role, visual direction, content style, allowed/disallowed
  themes, target audience, or positioning.
- AI natural-language rewriting may propose rule-shaped changes, but only
  visible owner-reviewed `AgentRule` or admitted profile writes may persist.
- Projection output cannot be edited directly. Any editable projection-looking
  field must name the underlying write owner first.
- Runtime consumption cannot define setting truth. Runtime may only consume
  owner-approved public/creator-owned context.
- Owner create uses `AgentsService.agentControllerCreate` / `POST /api/agent`
  only. `/api/creator/agents` is World Creator / Maintainer evidence and must
  not be used as an owner create path or fallback.
