# Nimi Avatar Kernel Authority Map

This document defines the contract surface that governs Nimi Avatar. It is admitted as Avatar normative authority.

## Authority Scope

Nimi Avatar is a **first-party app** consuming platform-level Nimi contracts.
This kernel defines **Avatar-local** normative content only; platform contracts
(APML / activity ontology / runtime projection seam / event contract convention /
SDK API / presentation timeline) are consumed as upstream references.

## Contracts

### [`backend-branch-contract.md`](backend-branch-contract.md)

Multi-backend carrier abstraction:

- `BackendKind` closed union (`'live2d' | 'vrm' | 'nimi2d'`)
- `BackendBranch` discriminated union (kind narrowing exposes Live2D-only
  `live2dExtension`)
- `BackendNominalBounds` / `BackendHitRegion` / `BackendAudioConsumer` /
  `BackendProjection` / `BackendSurface` types
- `createBackendBranch(model)` factory exhaustive switch (only allowed `kind`
  branch site)

### [`nimi2d-backend-contract.md`](nimi2d-backend-contract.md)

Nimi2D backend branch admission boundary:

- admits `kind: 'nimi2d'` as an Avatar-local backend branch for admitted Nimi2D
  packages
- keeps default generated tier-1 viability gated by Nimi2D Generation Bench
- requires package `proven_tier`, validator evidence, default outfit, and
  fail-closed live-action lanes
- current implementation admits a PixiJS renderer foundation/composer proof and
  deterministic offscreen pixel proof for valid package/profile input while
  mounted-surface release visual acceptance remains open

### [`nimi2d-live-action-bench-contract.md`](nimi2d-live-action-bench-contract.md)

Nimi2D Live Action Bench authority:

- exercises a real Avatar `kind: 'nimi2d'` backend surface
- measures default outfit visibility, projection latency, state legibility,
  tier-1 jaw/amplitude mouth behavior, blend stability, and interrupt recovery
- reports gaze as `unsupported_v1` until a separate lane is admitted
- cannot close Nimi2D Generation Bench or mounted-surface release visual
  acceptance

### [`vrm-backend-contract.md`](vrm-backend-contract.md)

VRM backend branch implementation contract:

- VRM lifecycle (load / context-lost recovery / dispose)
- MToon outline policy
- generated motion provider integration; `.vrma` is interchange/authoring
  evidence, not APML runtime support proof
- VRM expression preset names (viseme + emotion)
- Tauri webview quirks (createImageBitmap suspend)
- Nominal bounds derivation + framing intent

### [`generated-motion-provider-contract.md`](generated-motion-provider-contract.md)

Avatar generated motion provider authority:

- Avatar consumes typed `runtime.agent.*` projection, never parser diagnostics
  from the APML raw namespace
- backend route ids, capability profiles, mapping sidecars, and provider
  fail-closed semantics live under `.nimi/spec/avatar/**`
- public APML direct motion / expression / lookat / pose / clear-pose syntax
  remains not admitted
- `.vrma` is interchange-only and not runtime support proof

### [`embodiment-projection-contract.md`](embodiment-projection-contract.md)

Backend-agnostic embodiment projection truth (anchored to BackendProjection ontology surface;
parameter-id path is now Live2D-only escape hatch via `Live2DBackendExtension`):

- runtime / SDK semantic bundle enters avatar app here
- Avatar-local projection cues are named independently from any renderer backend
- shell consumes projection-produced surface bounds / hit masks
- backend-specific execution is delegated to renderer branches

### [`projection-backpressure-smoothing-contract.md`](projection-backpressure-smoothing-contract.md)

Renderer-local projection smoothing:

- smooths only `EmbodimentProjectionApi.setSignal` / `addSignal` hot-path writes
- preserves read-your-write behavior for pending signal values
- flushes pending signal writes before motion, expression, pose, wait, bounds,
  or default-activity calls
- inherits Runtime PresentationTimeline authority (`K-AGCORE-051`) and does not
  own activity ordering, speech, lipsync, cancellation, or generated motion truth

### [`app-shell-contract.md`](app-shell-contract.md)

Desktop shell and window surface:

- Transparent, always-on-top window without chrome
- Dynamic window size based on scaled embodiment surface bounds
- Window drag on the embodiment stage
- Click-through outside model hit region
- Embodiment-first ready posture with transient overlays only; no permanent companion/default tool strip
- App lifecycle and composition surface events (`avatar.app.*`, `avatar.composition.*`)

### [`wake-local-audio-lifecycle-contract.md`](wake-local-audio-lifecycle-contract.md)

Wake-adjacent and local-audio lifecycle owner boundary:

- Runtime owns future wake phrase lifecycle admission, consent, policy, and
  state projection
- Avatar owns foreground-priority intent, local audio privacy feedback,
  playback/lipsync rendering, and fail-closed presence state; microphone
  capture lifecycle remains Runtime-owned
- Desktop owns host launch/window/OS permission surfaces only, not wake parsing
  or hidden microphone truth
- current slice admits Runtime-owned wake/listening orchestration projection;
  Avatar-local start/stop/commit listening controls remain unadmitted

### [`avatar-external-entry-consumer-contract.md`](avatar-external-entry-consumer-contract.md)

Avatar external-entry consumer boundary:

- consumes Runtime-admitted external-entry presentation projection only
- inherits `K-AGCORE-079..094` and external-entry boundary matrix semantics
- treats `direct_api` as Runtime provenance, not local raw state write authority
- forbids Avatar-local HTTP/WebSocket/state endpoints, protocol adapters,
  token/rate-limit/consent posture, provider/model routing, credential custody,
  and writeback
- fails closed on missing admission/verdict/provenance evidence

### [`companion-participation-consumer-contract.md`](companion-participation-consumer-contract.md)

Avatar companion/persona/debug participation consumer boundary:

- consumes Runtime-owned `CompanionParticipationProjection`
- defines surface kinds, trigger posture, status semantics, and fail-closed
  rendering requirements
- forbids app-local prompt execution, provider/model routing, raw APML/debug
  truth, memory/cognition writes, private schedulers, and domain commit
- keeps persona/package variants as Avatar configuration, not separate product
  or surface-kind truth

### [`kit-ui-consumption-contract.md`](kit-ui-consumption-contract.md)

Avatar-local consumption contract for `@nimiplatform/kit`:

- Avatar concrete renderer adoption and composition inventories live under
  `.nimi/spec/avatar/kernel/tables/nimi-kit-*.yaml`
- platform design authority supplies shared primitives, tokens, material tiers,
  theme-pack schema, and generic integration rules only
- Avatar uses shared `nimi-accent` unless an Avatar-local theme manifest admits
  an app-specific accent pack
- app-local root design token registries are drift, not platform truth

### [`live2d-render-contract.md`](live2d-render-contract.md)

Current shipped backend-specific rendering branch:

- Cubism SDK for Web integration boundaries
- Model loading from `<model-pkg>/runtime/` (official Live2D folder structure)
- Live2D backend driver + parameter API
- Default lipsync behavior through admitted voice/lipsync authority
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
  Desktop renderer evidence, and historical process evidence
- current Live2D branch canvas/WebGL proof requirements
- negative closure rules that block placeholder, fixture-only, or Desktop-only
  visual success

### [`agent-script-contract.md`](agent-script-contract.md)

Reference appendices: [`agent-script-reference.md`](agent-script-reference.md)

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
- `avatar.speak.*` / `avatar.lipsync.*`
- `avatar.app.*` lifecycle

### [`avatar-debug-session-contract.md`](avatar-debug-session-contract.md)

Avatar debug session intake and backend evidence for Desktop Avatar
configuration/debug workbench:

- consumes Runtime-owned typed probe envelopes
- emits Avatar-owned backend evidence
- keeps package/profile resolver execution in Avatar after authorized
  Runtime/SDK projection
- forbids Desktop launch payload descriptors, raw APML, MCP/A2A, delegated
  provider output, app data, and auth material

### [`mock-fixture-contract.md`](mock-fixture-contract.md)

Explicit fixture tooling:

- Scenario file format
- Event injection into NAS runtime
- Time-based and trigger-based event emission
- Scenario validation rules
- Explicit mock vs real data source boundary

## Tables

### [`tables/feature-matrix.yaml`](tables/feature-matrix.yaml)

Avatar capability matrix. **Drift check**: code features must map to declared capability authority.

### [`tables/companion-participation-surface-kinds.yaml`](tables/companion-participation-surface-kinds.yaml)

Closed Avatar-owned companion participation surface-kind vocabulary.

### [`tables/companion-participation-trigger-policy.yaml`](tables/companion-participation-trigger-policy.yaml)

Closed trigger source policy for Avatar companion/persona/debug participation
consumers.

### [`tables/activity-mapping.yaml`](tables/activity-mapping.yaml)

Current Live2D backend branch default fallback mapping (used when NAS handler not provided for the activity).

### [`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml)

Existing Live2D asset compatibility tier requirements and forbidden success states.

### [`tables/live2d-adapter-manifest.schema.yaml`](tables/live2d-adapter-manifest.schema.yaml)

Closed v1 machine schema for Avatar-owned Live2D adapter manifests. It preserves
`manifest_kind: "nimi.avatar.live2d.adapter"`, `schema_version: 1`, exact-one
manifest source selection, current tier names, feature dispositions, and
fail-closed semantic mapping rules.

### [`tables/live2d-adapter-diagnostics.yaml`](tables/live2d-adapter-diagnostics.yaml)

Closed `AVATAR_LIVE2D_COMPAT_*` diagnostic code registry for Live2D existing
asset adaptation. Desktop may display these typed diagnostics but does not own
their meanings.

### [`tables/scenario-catalog.yaml`](tables/scenario-catalog.yaml)

Named mock scenarios available for development / testing.

### [`tables/vrm-emote-states.yaml`](tables/vrm-emote-states.yaml)

VRM emote bundle recipes — emotion ontology id → multi-weight expression
preset bundle. Active authority admits 11 emotes (10 ontology emotion +
`relaxed` VRM-only fallback).

### [`tables/vrm-motion-presets.yaml`](tables/vrm-motion-presets.yaml)

Interchange-only VRM motion preset registry — preset id → `.vrma` asset +
license + source. It is superseded by generated motion provider authority for
APML auto-adapter runtime support and may be used only as authoring or
interchange evidence.

### [`tables/vrm-sample-catalog.yaml`](tables/vrm-sample-catalog.yaml)

Representative VRM sample catalog for Avatar acceptance. Binaries are fetched
on demand into the app-local cache and must have concrete license/provenance,
minimum-size, and acceptance-purpose metadata before they can close carrier or
smoke proof.

### [`tables/generated-motion-routes.yaml`](tables/generated-motion-routes.yaml)

Avatar backend route ids for generated motion provider support. Route ids are
downstream of typed runtime projection and are not public APML tags.

### [`tables/nimi2d-live-action-routes.yaml`](tables/nimi2d-live-action-routes.yaml)

Avatar-local Nimi2D live-action route families. These routes consume typed
runtime projection and Nimi2D package capability evidence; they are not public
APML syntax and cannot close Generation Bench.

### [`tables/backend-capability-profile.schema.yaml`](tables/backend-capability-profile.schema.yaml)

Backend-agnostic capability profile schema with VRM, Live2D, and Nimi2D backend
sections. Profiles describe model/backend support and fail closed on missing
capability.

### [`tables/nimi2d-backend-capability-profile.schema.yaml`](tables/nimi2d-backend-capability-profile.schema.yaml)

Avatar-local Nimi2D backend capability profile schema. It consumes Nimi2D
package evidence and proves only Avatar runtime lane support, not default
generated asset viability.

### [`tables/acceptance-recording-matrix.yaml`](tables/acceptance-recording-matrix.yaml)

Recording-oriented Avatar acceptance matrix. It requires video evidence for
idle, hover, click, drag, Runtime-projected voice/listening, TTS/lipsync, interrupt,
runtime degraded, and both Live2D/VRM backends. Screenshots and unit tests do
not close this matrix by themselves.

### [`tables/mapping-sidecar.schema.yaml`](tables/mapping-sidecar.schema.yaml)

Mapping sidecar schema for route-to-backend/model name correspondence with
confidence, evidence, threshold, and manual confirmation semantics.

### [`tables/avatar-debug-session.schema.yaml`](tables/avatar-debug-session.schema.yaml)

Avatar debug session intake/evidence schema. It consumes Runtime probe ids and
Avatar backend refs; it does not own public Runtime probe status.

### Localization boundary

Avatar localization semantics are governed by `app-shell-contract.md`. Concrete
i18n key names, default copy, translation values, and consuming component paths
are app-owned implementation resources and must not be promoted into Avatar
kernel table authority.

### [`tables/window-bounds-policy.yaml`](tables/window-bounds-policy.yaml)

Dynamic window sizing rules, including per-backend nominal bounds defaults and
`BackendBranch.nominalBounds` source authority.

### [`tables/nimi-kit-adoption.yaml`](tables/nimi-kit-adoption.yaml)

Avatar renderer modules governed by shared kit UI adoption, including app
entrypoint theme imports and local forbidden patterns.

### [`tables/nimi-kit-compositions.yaml`](tables/nimi-kit-compositions.yaml)

Avatar-owned shell compositions that remain downstream of shared kit primitive
authority.

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
| SDK Event API | `.nimi/spec/sdks/kernel/runtime-contract.md` |
| Presentation Timeline | Not admitted here unless later admitted by `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`; current active surface is runtime turn/presentation/state projection |

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
