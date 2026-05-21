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
| Agent handle | Presentation / identity write candidate | `CreateAgentDto.handle` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Source exists. Owner-created uniqueness and update semantics remain Realm/app admission gaps. |
| Display name | Presentation / identity write candidate | `CreateAgentDto.displayName`; `UpdateCreatorAgentDto.displayName` (`sdk/src/realm/generated/schema.ts:4536` to `:4563`; `:6549` to `:6558`). | Source exists. The exact owner and Account/Profile split is a Realm source gap. |
| Public bio | Presentation / projection input candidate | `UpdateCreatorAgentDto.bio` (`sdk/src/realm/generated/schema.ts:6549` to `:6558`); `WorldAgentSummaryDto.bio` projection evidence (`sdk/src/realm/generated/schema.ts:7055` to `:7071`). | Source exists as DTO evidence. Canonical owner field is not admitted here. |
| World selection | Truth input / derivation scope | `CreateAgentDto.worldId` is required (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `OASIS` is canonical main world (`.nimi/spec/realm/kernel/truth-contract.md:47` to `:53`); `GET /api/world` / `listWorlds` exists as current generated SDK evidence. | Product decision: all Realm `listWorlds` results are selectable for Studio creation. Admission needs citation to the exact SDK surface and defaulting behavior, not a new selectable-world decision. |
| Selected world basic setting preview | Projection output | Existing world detail SDK surface, including `GET /api/world/by-id/{id}/detail-with-agents` evidence (`.nimi/spec/realm/kernel/truth-contract.md:55` to `:57`). | Uses existing world detail SDK surface. Exact DTO fields for "basic setting" require citation before implementation. |
| Concept / free-form creation text | Truth candidate / authoring input | `CreateAgentDto.concept` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Source exists. It is not by itself durable truth until Realm create succeeds. |
| Description | Presentation / projection input candidate | `CreateAgentDto.description` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Source exists. Canonical profile owner is not fully pinned. |
| Personality | Truth input candidate | `CreateAgentDto.dna`, `dnaPrimary`, `dnaSecondary` exist (`sdk/src/realm/generated/schema.ts:4536` to `:4563`); `AgentRule` anchors agent truth (`.nimi/spec/realm/kernel/truth-contract.md:31` to `:33`). | Partial source. Field-level DTO ownership remains a gap beyond DNA/rule carrier. |
| Worldview / background | Truth input candidate | `CreateAgentDto.dna`; `AgentIdentityDto.worldview` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`); `AgentRule` truth anchor. | Gap. No complete Studio write field is admitted for background/worldview. |
| Public role | Truth input / presentation candidate | `AgentIdentityDto.role` evidence (`sdk/src/realm/generated/schema.ts:3836` to `:3842`). | Gap. Current create/update owner path for this exact field is not fully pinned. |
| Greeting / opening voice | Presentation / runtime consumption candidate | `AgentProfileDto.greeting` exists and is described as ordinary first-turn opening message (`sdk/src/realm/generated/schema.ts:3898` to `:3907`). | Read/source exists. Owner update path is not admitted. |
| Content style | Truth input candidate | `CreateAgentRulesDto` and `UpdateAgentRuleDto` carry rule text and rule fields (`sdk/src/realm/generated/schema.ts:4558` to `:4577`; `:6447` to `:6468`). | Must be rule-shaped unless Realm admits a separate field. |
| Allowed themes | Truth input candidate | Rule fields can carry statements, category, hardness, scope, structured payload. | Gap if product wants a dedicated field; otherwise use visible `AgentRule`. |
| Disallowed themes / boundaries | Truth input candidate | `UpdateAgentRuleDto` can update rule statements and hardness. | Gap if product wants a dedicated field; otherwise use visible `AgentRule`. |
| Target audience / positioning | Presentation or rule candidate | `UpdateCreatorAgentDto.tags` and `bio` exist (`sdk/src/realm/generated/schema.ts:6549` to `:6558`). | Gap. No admitted target-audience truth field. |
| Visibility | Presentation / social exposure | `UpdateAgentVisibilityDto` exposes account, default post, DM, and profile visibility (`sdk/src/realm/generated/schema.ts:6469` to `:6478`). | Source exists. This is visibility evidence only; Studio must not map it into a Realm Agent lifecycle state machine. |
| Avatar URL | Presentation candidate | `UpdateCreatorAgentDto.avatarUrl` exists. | Gap for public asset authority. Raw URL update does not replace Resource/Binding admission. |
| Profile cover URL | Presentation candidate | `UpdateCreatorAgentDto.profileCoverUrl` and read projections on `UserLiteDto`, `UserPrivateDto`, and `UserProfileDto` exist (`sdk/src/realm/generated/schema.ts:6549` to `:6558`; `:6769` to `:6786`; `:6795` to `:6825`; `:6832` to `:6860`). | Source exists. It is the admitted profile cover attribute; Resource/Binding-backed asset authority remains a separate gap. |
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
