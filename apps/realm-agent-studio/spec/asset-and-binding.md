---
id: SPEC-REALM-AGENT-STUDIO-ASSET-BINDING-001
title: Asset And Binding Admission
status: active
owner: "@team"
updated: 2026-05-21
---

# Asset And Binding

Creative assets are candidate material until the owner selects them and the
admitted Realm write path succeeds. Local preview/history is app-local only,
not cross-device public truth.

## Realm Authority

- `Resource` is the typed content carrier. Active resource types are `IMAGE`,
  `VIDEO`, `AUDIO`, and `TEXT`; `VOICE` is not active
  (`.nimi/spec/realm/kernel/resource-contract.md:18` to `:40`).
- `OwnableAsset` is independently ownable asset truth with explicit lifecycle
  (`.nimi/spec/realm/kernel/asset-contract.md:18` to `:36`).
- `Binding` is the only durable object-to-host relation family
  (`.nimi/spec/realm/kernel/binding-contract.md:18` to `:36`).
- Active binding host types include `AGENT`; active object types are `RESOURCE`,
  `ASSET`, and `BUNDLE` (`.nimi/spec/realm/kernel/tables/domain-enums.yaml:60`
  to `:67`).
- Active agent-oriented binding points currently include `AGENT_AVATAR`,
  `AGENT_PORTRAIT`, `AGENT_EXPRESSION`, `AGENT_OUTFIT`, `AGENT_CANDIDATE`, and
  `AGENT_VOICE_SAMPLE` (`.nimi/spec/realm/kernel/tables/domain-enums.yaml:72`
  to `:92`).

## Candidate Lifecycle

Every generated or uploaded creative asset follows this product state sequence:

1. Generated or uploaded.
2. Locally previewed.
3. Selected by owner.
4. Written through an admitted Realm `Resource`, `OwnableAsset`, `Binding`, or
   profile path.
5. Active on public profile or attached to a post only after Realm confirms.

Failure in an earlier state must not be projected as success in a later state.

## Write Path Map

| Candidate | Required public path | Source evidence | Admission status |
| --- | --- | --- | --- |
| Avatar image | Owner-reviewed avatar URL selection may write through `POST /api/agent/accounts/{id}/avatar` / `AgentsService.agentControllerSelectAvatar`. Resource-backed avatar publication prefers `Resource(IMAGE)` or `OwnableAsset` plus `Binding(PRESENTATION, hostType=AGENT, bindingPoint=AGENT_AVATAR)`. | `SelectAvatarDto.avatarUrl` and the non-creator `AgentsService.agentControllerSelectAvatar` operation exist (`sdk/src/realm/generated/schema.ts:6257` to `:6259`; `:7738` to `:7762`; `sdk/src/realm/generated/operation-map.ts:417` to `:438`). Binding enum and upsert DTO support `AGENT_AVATAR`, `hostType=AGENT`, `objectType=RESOURCE/ASSET/BUNDLE` (`sdk/src/realm/generated/schema.ts:4212` to `:4289`; `:13298` to `:13320`). | URL selection pinned for owner-reviewed avatar URL only. Resource/Binding-backed avatar asset truth remains partial and must not be claimed from local preview alone. Raw `UpdateCreatorAgentDto.avatarUrl` remains creator/maintainer evidence and is not the Studio owner path. |
| Portrait/reference image | `Resource(IMAGE)` or `OwnableAsset` plus `AGENT_PORTRAIT` or `AGENT_CANDIDATE` binding. | Binding points exist; `CreateAgentDto.referenceImageUrl` exists (`sdk/src/realm/generated/schema.ts:4536` to `:4563`). | Gap for active public meaning. Reference image URL is not enough for public asset truth. |
| Profile cover | Realm `profileCoverUrl` profile attribute. | `UserLiteDto`, `UserPrivateDto`, and `UserProfileDto` read projections exist. `UpdateCreatorAgentDto.profileCoverUrl` exists only as creator/maintainer DTO evidence (`sdk/src/realm/generated/schema.ts:6549` to `:6558`; `:6769` to `:6786`; `:6795` to `:6825`; `:6832` to `:6860`). | Profile cover attribute is admitted for read/source projection. Owner write remains blocked until a non-creator owner update surface is admitted. Binding enum still does not expose separate agent banner/background/cover binding points; world/scene binding points must not be reused by analogy. |
| Post image candidate | `Resource(IMAGE)` or readable `ASSET/BUNDLE`, then post `attachments[*]` envelope. | Resource supports `IMAGE`; direct image upload/finalize evidence exists (`sdk/src/realm/generated/schema.ts:2728`; `:11942`); attachment targets are `RESOURCE`, `ASSET`, `BUNDLE` (`.nimi/spec/realm/kernel/attachment-contract.md:18` to `:32`). | Pinned for post attachment if target is READY/readable and Create Post succeeds. |
| Post video candidate | `Resource(VIDEO)` or readable `ASSET/BUNDLE`, then post `attachments[*]` envelope. | Resource supports `VIDEO`; video upload evidence exists (`sdk/src/realm/generated/schema.ts:2762`); attachment envelope supports typed target references. | Pinned for post attachment if target is READY/readable and Create Post succeeds. |
| Voice-demo candidate | `Resource(AUDIO)` plus optional `Binding(PRESENTATION, hostType=AGENT, bindingPoint=AGENT_VOICE_SAMPLE)`. | Resource supports `AUDIO`; direct audio upload evidence exists (`sdk/src/realm/generated/schema.ts:2711`); `AGENT_VOICE_SAMPLE` exists. | Partially pinned. It is a voice-demo/sample path only; custom voice design remains out of active Resource `VOICE` model. |

## Current DTO Evidence

Generated schema currently exposes:

- direct upload/finalize resource metadata with `agentId`, `controllerId`,
  `controllerKind`, `deliveryAccess`, `sourceJobId`, `sourceArtifactId`, and
  media dimensions (`sdk/src/realm/generated/schema.ts:4611` to `:4640`;
  `:4988` to `:5010`);
- `CreateAssetDto` with `resourceRefs`, `previewResourceId`, lifecycle status,
  transfer/use policies, and structured payload
  (`sdk/src/realm/generated/schema.ts:4589` to `:4610`);
- batch binding upsert under `/api/worlds/{worldId}/bindings`
  (`sdk/src/realm/generated/schema.ts:3605` to `:3617`).

These surfaces are evidence, not complete Studio admission. Studio still needs
an explicit Realm-approved path for each public profile asset family before
displaying it as active public truth.
