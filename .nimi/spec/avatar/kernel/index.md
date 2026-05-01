# Nimi Avatar Kernel Authority Map

This document defines the contract surface that governs Nimi Avatar. It is admitted as Avatar normative authority.

## Authority Scope

Nimi Avatar is a **first-party app** consuming platform-level Nimi contracts.
This kernel defines **Avatar-local** normative content only; platform contracts
(APML / activity ontology / runtime projection seam / event contract convention /
SDK API / presentation timeline) are consumed as upstream references.

## Contracts

### [`backend-branch-contract.md`](backend-branch-contract.md)

Multi-backend carrier abstraction (Wave 0 of topic
`2026-04-30-avatar-vrm-backend-branch` admit):

- `BackendKind` closed union (`'live2d' | 'vrm'`)
- `BackendBranch` discriminated union (kind narrowing exposes Live2D-only
  `live2dExtension`)
- `BackendNominalBounds` / `BackendHitRegion` / `BackendAudioConsumer` /
  `BackendProjection` / `BackendSurface` types
- `createBackendBranch(model)` factory exhaustive switch (only allowed `kind`
  branch site)

### [`vrm-backend-contract.md`](vrm-backend-contract.md)

VRM backend branch implementation contract (Wave 0 admit):

- VRM lifecycle (load / context-lost recovery / dispose)
- MToon outline policy
- `.vrma` motion preset registry + per-model override semantics
- VRM expression preset names (viseme + emotion)
- Tauri webview quirks (createImageBitmap suspend)
- Nominal bounds derivation + framing intent

### [`embodiment-projection-contract.md`](embodiment-projection-contract.md)

Backend-agnostic embodiment projection truth (re-anchored at Wave 0 of topic
`2026-04-30-avatar-vrm-backend-branch` to BackendProjection ontology surface;
parameter-id path is now Live2D-only escape hatch via `Live2DBackendExtension`):

- runtime / SDK semantic bundle enters avatar app here
- Avatar-local projection cues are named independently from any renderer backend
- shell consumes projection-produced surface bounds / hit masks
- backend-specific execution is delegated to renderer branches

### [`app-shell-contract.md`](app-shell-contract.md)

Desktop shell and window surface:

- Transparent, always-on-top window without chrome
- Dynamic window size based on active embodiment surface bounds
- Window drag (reposition pet on desktop)
- Click-through outside model hit region
- Small UI button near pet for chat trigger (Phase 2 surface)
- App lifecycle events (`avatar.app.*`)

### [`live2d-render-contract.md`](live2d-render-contract.md)

Current shipped backend-specific rendering branch:

- Cubism SDK for Web integration boundaries
- Model loading from `<model-pkg>/runtime/` (official Live2D folder structure)
- Live2D backend driver + parameter API
- Default lipsync behavior (Phase 2)
- Physics / expression / motion playback

### [`live2d-asset-compatibility-contract.md`](live2d-asset-compatibility-contract.md)

Existing Live2D asset adaptation:

- Compatibility tiers for render-only, semantic-basic, and complete companion behavior
- Adapter manifest format and validation diagnostics
- Semantic mapping for motions, expressions, pose, lip-sync ids, physics, hit regions, and NAS fallback
- Legal fixture and no-redistribution posture
- Avatar carrier visual acceptance linkage

### [`carrier-visual-acceptance-contract.md`](carrier-visual-acceptance-contract.md)

Avatar app carrier visual acceptance:

- evidence taxonomy for real runtime path, deterministic harness, fixture path,
  Desktop renderer evidence, and closed historical evidence
- current Live2D branch canvas/WebGL proof requirements
- negative closure rules that block placeholder, fixture-only, or Desktop-only
  visual success

### [`agent-script-contract.md`](agent-script-contract.md)

NimiAgentScript (NAS) handler convention:

- Directory layout (`<model>/runtime/nimi/activity/` / `event/` / `continuous/` / `lib/`)
- File name normalization (activity id / event name → filename)
- Handler interface (3 types: activity / event / continuous)
- Embodiment projection API surface for handlers
- Default fallback (convention-based)
- Hot reload semantics backed by Tauri `notify` watcher + atomic registry reload
- Worker-backed capability-RPC sandbox boundary

### [`avatar-event-contract.md`](avatar-event-contract.md)

`avatar.*` namespace events produced and consumed:

- `avatar.user.*` (click / drag / hover)
- `avatar.activity.*` (activity start / end / cancel)
- `avatar.motion.*` / `avatar.expression.*` / `avatar.pose.*` / `avatar.lookat.*`
- `avatar.speak.*` / `avatar.lipsync.*` (Phase 2)
- `avatar.app.*` lifecycle

### [`mock-fixture-contract.md`](mock-fixture-contract.md)

Explicit fixture tooling:

- Scenario file format
- Event injection into NAS runtime
- Time-based and trigger-based event emission
- Scenario validation rules
- Explicit mock vs real data source boundary

## Tables

### [`tables/feature-matrix.yaml`](tables/feature-matrix.yaml)

Phase 1 / 2 / 3 feature phasing. **Drift check**: code features must map to declared phase.

### [`tables/activity-mapping.yaml`](tables/activity-mapping.yaml)

Current Live2D backend branch default fallback mapping (used when NAS handler not provided for the activity).

### [`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml)

Existing Live2D asset compatibility tier requirements and forbidden success states.

### [`tables/scenario-catalog.yaml`](tables/scenario-catalog.yaml)

Named mock scenarios available for development / testing.

### [`tables/vrm-emote-states.yaml`](tables/vrm-emote-states.yaml)

VRM emote bundle recipes — emotion ontology id → multi-weight expression
preset bundle. Wave 0 of topic `2026-04-30-avatar-vrm-backend-branch` admit;
11 emotes (10 ontology emotion + `relaxed` VRM-only fallback).

### [`tables/vrm-motion-presets.yaml`](tables/vrm-motion-presets.yaml)

VRM motion preset registry — preset id → `.vrma` asset + license + source.
Wave 0 admits 4 entries (`idle_subtle / listen_lean / nod_yes / shake_no`):
`idle_subtle` is the airi MIT fork-copy PoC, while the other three are
internal author targets. 3 external-license entries deferred to wave_3.

### [`tables/window-bounds-policy.yaml`](tables/window-bounds-policy.yaml)

Dynamic window sizing rules. Wave 4 admit baseline + Wave 0 of topic
`2026-04-30-avatar-vrm-backend-branch` extension (per-backend
nominal_bounds_default + `BackendBranch.nominalBounds` source authority).

## Upstream Platform Contracts (Referenced)

These are **not** redefined here. App consumes them:

| Upstream | Location |
|----------|----------|
| APML wire format | `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` |
| APML LLM compliance | `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` plus Desktop prompt contract |
| Activity ontology | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`, `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`, and Avatar-local `tables/activity-mapping.yaml` |
| Runtime conversation anchor | `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md` |
| Runtime transient presentation seam | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` |
| Event contract + app convention | `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`, `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`, and this Avatar-local `avatar-event-contract.md` |
| SDK Event API | `.nimi/spec/sdk/kernel/runtime-contract.md` |
| Presentation Timeline | Deferred candidate only unless later admitted by `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`; current active surface is runtime turn/presentation/state projection |

When upstream changes, impact on this kernel is reviewed and documented per-contract.

## Authority Priority

When conflicting:

1. Platform contracts (upstream) take precedence for wire format / semantic meaning
2. This kernel defines Avatar-local implementation & product-form surface
3. Source code follows kernel; drift from kernel is a defect

This kernel must not create a parallel substitute for runtime-owned projection,
session, hook, or emotion truth.

## Review & Update

All kernel changes must:

1. Update `.md` or `.yaml` first
2. Sync code to match
3. Run `check:spec-consistency` and fix drift
4. Update `INDEX.md` if contracts added / removed
