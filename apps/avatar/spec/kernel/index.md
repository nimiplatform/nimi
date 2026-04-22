# Nimi Avatar Kernel Authority Map

This document defines the contract surface that governs Nimi Avatar. It is admitted as app-local normative authority.

## Authority Scope

Nimi Avatar is a **first-party app** consuming platform-level Nimi contracts.
This kernel defines **app-local** normative content only; platform contracts
(APML / activity ontology / runtime projection seam / event contract convention /
SDK API / presentation timeline) are consumed as upstream references.

## Contracts

### [`app-shell-contract.md`](app-shell-contract.md)

Desktop shell and window surface:

- Transparent, always-on-top window without chrome
- Dynamic window size based on Live2D model bounds
- Window drag (reposition pet on desktop)
- Click-through outside model hit region
- Small UI button near pet for chat trigger (Phase 2 surface)
- App lifecycle events (`avatar.app.*`)

### [`live2d-render-contract.md`](live2d-render-contract.md)

Live2D rendering pipeline:

- Cubism SDK for Web integration boundaries
- Model loading from `<model-pkg>/runtime/` (official Live2D folder structure)
- Rendering driver + parameter API
- Default lipsync behavior (Phase 2)
- Physics / expression / motion playback

### [`agent-script-contract.md`](agent-script-contract.md)

NimiAgentScript (NAS) handler convention:

- Directory layout (`<model>/runtime/nimi/activity/` / `event/` / `continuous/` / `lib/`)
- File name normalization (activity id / event name → filename)
- Handler interface (3 types: activity / event / continuous)
- Live2D Plugin API v1 surface
- Default fallback (convention-based)
- Hot reload semantics
- Sandbox placeholder (specific mechanism deferred)

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

Activity id → Live2D motion group default mapping (used when NAS handler not provided for the activity).

### [`tables/scenario-catalog.yaml`](tables/scenario-catalog.yaml)

Named mock scenarios available for development / testing.

## Upstream Platform Contracts (Referenced)

These are **not** redefined here. App consumes them:

| Upstream | Location |
|----------|----------|
| APML wire format | `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md` |
| APML LLM compliance | `...apml-llm-compliance.md` |
| Activity ontology | `...activity-ontology.md` |
| Runtime conversation anchor | `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md` |
| Runtime transient presentation seam | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` |
| Event contract + app convention | `...event-hook-contract.md` |
| SDK Event API | `...sdk-event-api.md` |
| Presentation Timeline | `...presentation-timeline.md` |

When upstream changes, impact on this kernel is reviewed and documented per-contract.

## Authority Priority

When conflicting:

1. Platform contracts (upstream) take precedence for wire format / semantic meaning
2. This kernel defines app-local implementation & product-form surface
3. Source code follows kernel; drift from kernel is a defect

This kernel must not create a parallel substitute for runtime-owned projection,
session, hook, or emotion truth.

## Review & Update

All kernel changes must:

1. Update `.md` or `.yaml` first
2. Sync code to match
3. Run `check:spec-consistency` and fix drift
4. Update `INDEX.md` if contracts added / removed
