# Kit Feature: Model Config

## What It Is
Reusable AI model configuration surface for capability-scoped binding, profile
apply UX, capability-local params editors, and the AI Model hub composition
that unifies how apps present the canonical capability catalog.

## Public Surfaces
- `@nimiplatform/kit/features/model-config`
- `@nimiplatform/kit/features/model-config/headless`
- `@nimiplatform/kit/features/model-config/ui`
- `@nimiplatform/kit/core/model-config` (pure-logic seam; shared
  `SharedAIConfigService` / `AppModelConfigSurface` /
  `ModelSettingsService` / controller factory)

## Canonical Ownership

This module owns the following shared Nimi app surfaces:

- Consumer shell for the canonical capability catalog published by
  `@nimiplatform/kit/core/runtime-capabilities`
  (`CANONICAL_CAPABILITY_CATALOG`). The catalog is spec-resident per
  `P-CAPCAT-001..003` and is codegen-owned by `kit/core/runtime-capabilities`;
  this module consumes it and never re-declares, mutates, or shadows it.
- The complete params editor set for every `editorKind !== null` capability
  (`text`, `audio-synthesize`, `audio-transcribe`, `voice-workflow`, `image`,
  `video`), with matching `ParamsState` types, default constants, `parse*`
  helpers, and `create*EditorCopy(t)` defaults.
- The default profile controller factory (`createModelConfigProfileControllerCore`
  in `kit/core/model-config` + `useModelConfigProfileController` react hook)
  that enforces D-AIPC-005 atomic overwrite semantics across three apply paths:
  `remote-success`, `remote-fail-without-user-profile`, `network-error`.
- The `ModelConfigAiModelHub` composition, including its Header +
  SectionCards + `ModelConfigCapabilityDetail` detail router. Import AI
  Profile renders exactly once inside the hub header action slot via
  `ProfileConfigSection variant='import-button'`.
- The `ModelSettingsService` contract for Runtime Agent consumers that already
  receive the dedicated model-settings projection. It preserves provider/model
  route identity and decimal configuration revisions without reconstructing an
  app-level `AIConfig`.
- The `AppModelConfigSurface` consumer-injection contract wiring `AIScopeRef`,
  `SharedAIConfigService`, provider resolver, projection resolver, optional
  local asset source, and capability overrides.
- `defaultModelConfigProfileCopy(t)` — full `ModelConfigProfileCopy` bundle,
  single i18n namespace `ModelConfig.profile.*`.
- `summarizeAiModelAggregate` (moved from desktop chat) — pure aggregate tone
  summary for hub headers and section cards.

## What Stays Outside

- `AIProfile` / `AIConfig` / `AISnapshot` authority (D-AIPC-001..012). The
  kit never persists AIConfig and never fabricates a placeholder apply
  result. `SharedAIConfigService` is the host-owned persistence seam.
- Runtime route provider creation, capability health/projection logic, and
  AIProfile-to-AIConfig materialization; those remain SDK / host-service owned.
  Kit consumers inject `SharedAIConfigService`, not a raw schema applier.
- Scheduling preflight / banners (K-SCHED-*). Consumers pass scheduling UX via
  the hub `footer` slot if needed.
- App navigation, scope selection, and `AIScopeRef` ownership.
- Profile catalog editing / admission / versioning — the kit controller only
  reads and applies.

## Canonical Hub Invariants

- `ProfileConfigSection` renders exactly once per hub, in the header action
  slot, using `variant='import-button'`. Peer or footer placements are
  forbidden by the hub layout contract; this is asserted by the kit tests.
- Section cards render only for canonical section ids admitted by the injected
  SDK `AICapabilityRequirementDeclaration` slices intersected with
  `CANONICAL_CAPABILITY_CATALOG_BY_ID`, in
  `CapabilitySectionId` enum order (`chat | tts | stt | image | video | voice
  | embed | world`).
- A capability with `editorKind !== null` whose editor is missing must fail
  closed in review; the kit ships a complete editor set so this cannot happen
  at runtime.

## When To Use It

- Reuse it whenever an app or module needs the AI Model configuration hub
  (chat settings, app workbenches, or future workspaces).
- Reuse `useModelConfigProfileController` instead of reimplementing profile
  apply flow; never redefine D-AIPC-005 semantics downstream.
- Reuse `defaultModelConfigProfileCopy(t)` instead of per-app
  `createProfileCopy` helpers.

## Before Building Locally

- Check this module and `@nimiplatform/kit/core/model-config` before
  adding another app-local model settings shell, capability enum, params
  editor, profile controller, or hub layout.
- `AIConfig` / `AIProfile` authority stays in the app host bridge that
  implements `SharedAIConfigService`; do not move it into kit.
- Reuse `features/model-picker` providers and triggers before introducing a
  second route-selection primitive.

## Current Consumers

Desktop chat/profile settings and Tester app settings consume the shared hub
through `AppModelConfigSurface` + `SharedAIConfigService`. App-specific code
owns scope selection, profile library editing, provider resolution, and copy.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit`
- `pnpm check:canonical-capability-catalog`
