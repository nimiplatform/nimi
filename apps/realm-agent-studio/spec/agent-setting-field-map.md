---
id: SPEC-REALM-AGENT-STUDIO-SETTING-FIELD-MAP-001
title: Agent Setting Field Admission Map
status: active
owner: "@team"
updated: 2026-05-21
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
| Agent handle | Presentation / identity create input | `POST /api/agent` / `AgentsService.agentControllerCreate`; `CreateAgentDto.handle` exists (`sdk/src/realm/generated/operation-map.ts:272` to `:290`; `sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted for owner create only through `AgentsService.agentControllerCreate`. Owner-created uniqueness and update semantics remain Realm/app admission gaps. |
| Display name | Presentation / identity create input | `CreateAgentDto.displayName`; `UpdateCreatorAgentDto.displayName` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:6549` to `:6558`). | Admitted for owner create through `AgentsService.agentControllerCreate`. The exact owner update and Account/Profile split is a Realm source gap. |
| Public bio | Presentation / projection input candidate | `UpdateCreatorAgentDto.bio` (`sdk/src/realm/generated/schema.ts:6549` to `:6558`); `WorldAgentSummaryDto.bio` projection evidence (`sdk/src/realm/generated/schema.ts:7055` to `:7071`). | Source exists as DTO evidence. Canonical owner field is not admitted here. |
| World selection | Truth input / derivation scope | `CreateAgentDto.worldId` is required (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `OASIS` is canonical main world (`.nimi/spec/realm/kernel/truth-contract.md:47` to `:53`); `GET /api/world` / `WorldsService.worldControllerListWorlds` exists as current generated SDK evidence. | Product decision: all Realm `listWorlds` results are selectable for Studio creation. OASIS defaulting must resolve from the source-backed list and submit that `id`. |
| Selected world basic setting preview | Projection output | Existing world detail SDK surface, including `GET /api/world/by-id/{id}/detail-with-agents` / `WorldsService.worldControllerGetWorldDetailWithAgents` evidence (`.nimi/spec/realm/kernel/truth-contract.md:55` to `:57`). | Uses existing world detail SDK surface before submit. Preview source failure must not block valid draft preservation. |
| Concept / free-form creation text | Owner setting input / truth create input | `CreateAgentDto.concept` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted for owner create through `AgentsService.agentControllerCreate`. It is not durable truth until Realm create returns canonical `id`. |
| Description | Presentation / projection create input | `CreateAgentDto.description` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Admitted as optional owner create body field through `AgentsService.agentControllerCreate`. Canonical update owner remains not fully pinned. |
| Personality | Owner setting input / truth derivation candidate | `CreateAgentDto.dna`, `dnaPrimary`, `dnaSecondary` exist (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `AgentRule` anchors agent truth (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`). | Partial source. Studio may collect owner personality intent, but accepted values need a canonical owner-scoped ingress that derives truth without making raw `dna` or raw rule editing the default owner UX. |
| Worldview / background | Owner setting input / truth derivation candidate | `CreateAgentDto.dna`; `AgentIdentityDto.worldview` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`); `AgentRule` truth anchor. | Gap. No complete admitted owner write surface exists. Studio may treat this as owner setting intent only until a canonical owner-scoped ingress is admitted. |
| Public role | Owner setting input / truth or presentation candidate | `AgentIdentityDto.role` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`). | Gap. Current create/update owner path for this exact field is not fully pinned. |
| Greeting / opening voice | Presentation / runtime consumption candidate | `AgentProfileDto.greeting` exists and is described as ordinary first-turn opening message (`sdk/src/realm/generated/schema.ts:3898` to `:3907`). | Read/source exists. Owner update path is not admitted. |
| Content style | Owner setting input / truth derivation candidate | `CreateAgentRulesDto` and `UpdateAgentRuleDto` carry rule text and rule fields (`sdk/src/realm/generated/schema.ts:4558` to `:4577`; `:6447` to `:6468`). | Studio may collect content-style intent, but accepted values must derive canonical `AgentRule` truth through an owner-scoped ingress. Hidden personality/worldview/provider/model content is not admitted. |
| Allowed themes | Owner setting input / truth derivation candidate | Rule fields can carry statements, category, hardness, scope, structured payload. | Gap if product wants a dedicated field. Default Studio semantics are owner setting intent that compiles to canonical rule truth, not raw rule CRUD. |
| Disallowed themes / boundaries | Owner setting input / truth derivation candidate | `UpdateAgentRuleDto` can update rule statements and hardness. | Gap if product wants a dedicated field. Default Studio semantics are owner setting intent that compiles to canonical rule truth, not raw rule CRUD. |
| Target audience / positioning | Owner setting input / presentation or truth candidate | `UpdateCreatorAgentDto.tags` and `bio` exist (`sdk/src/realm/generated/schema.ts:6549` to `:6558`). | Gap. No admitted target-audience truth field. |
| Canonical `AgentRule` review | Truth review / expert semantics | `AgentRule` truth anchor (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`); `CreateAgentRulesDto` / `UpdateAgentRuleDto`; `AgentRulesService` world-scoped rule CRUD surfaces (`sdk/src/realm/generated/operation-map.ts:97` to `:115`; `:209` to `:220`; `sdk/src/realm/generated/schema.ts:4601` to `:4623`; `:6493` to `:6512`; `:12688` to `:12721`). | Canonical rule truth may be shown for review, audit, replay, or expert confirmation. It is not the default owner editing model, and `AgentRulesService` world-scoped CRUD must not be reused as the Studio owner save path. |
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
  owner-approved public/creator-owned context.
- Owner create uses `AgentsService.agentControllerCreate` / `POST /api/agent`
  only. `/api/creator/agents` is World Creator / Maintainer evidence and must
  not be used as an owner create path or fallback.
- Accepted owner setting edits need a canonical owner-scoped Realm
  settings/truth ingress that compiles or derives canonical truth writes. That
  ingress direction is required authority even where the exact backend contract
  remains a gap.
- `AgentRulesService` world-scoped `/api/world/.../rules` CRUD surfaces must
  not be reused as the default Studio owner save path.
