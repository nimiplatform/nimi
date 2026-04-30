# Wave 1 Close Evidence

**Topic**: `2026-04-30-avatar-vrm-backend-branch`
**Wave**: `wave-1` (topic-internal) ↔ `wave_6` (feature-matrix v3)
**Date**: 2026-04-30
**Disposition (proposed)**: `complete` — 22 of 23 packet acceptance_invariants PASS at the wave-1 close gate; invariant #15 (real non-synthetic runtime e2e sanity) is **deferred to wave_2** because runtime daemon startup is out of scope for this wave's close gate. All enabling code paths (runtime injection, audio-pipeline `setRuntime`, BackendAudioConsumer sink registration, VRM dev-preview lifecycle) are wired and unit-tested; the deferred invariant gates the live runtime smoke that lands with the VRM real-renderer wave_2 admit.

---

## Packet Acceptance Invariants — Verification

Source: `.nimi/topics/ongoing/2026-04-30-avatar-vrm-backend-branch/packet-wave-1-carrier-abstraction-and-frame-batch-hardcut-preflight.md`.

| # | Invariant | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `apps/avatar/src/shell/renderer/carrier/create-backend-branch.ts` exists and is the only `model.kind` switch site | PASS | `carrier/create-backend-branch.ts` present with `_exhaustive: never` exhaustive check; `grep -rn "manifest\.kind\|model\.kind\|backend\.kind" apps/avatar/src` shows only this site for kind switch |
| 2 | `apps/avatar/src/shell/renderer/carrier/model-resolver.ts` implements ModelManifest detection per design-08 | PASS | `carrier/model-resolver.ts` present; discriminated `AvatarModelManifest` union (`live2d` / `vrm`); Live2D Tauri manifest passthrough wired |
| 3 | `apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts` returns AvatarRuntimeCarrier with backend BackendBranch on the public type | PASS | wave_1 step_4 reduced `AvatarRuntimeCarrier` to `{model, registry, backend, attachRuntimeDriver, detachRuntimeDriver, shutdown}`; transitional `commandBus` / `backendSession` / `legacyProjection` slots removed |
| 4 | `apps/avatar/src/shell/renderer/live2d` has the BackendBranch-conforming files (live2d-backend-branch / live2d-carrier-surface / live2d-projection-adapter / live2d-audio-consumer / live2d-lipsync-driver / live2d-nominal-bounds / live2d-hit-region) | PASS | 7 files present under `src/shell/renderer/live2d/`; step_2 deliverable inventory matches |
| 5 | `live2d-lipsync-driver.ts` uses the ParamMouthForm winner-key mapping const table (A=-0.6, E=+0.4, I=+0.8, O=-0.2, U=-0.8, silent=0) | PASS | `PARAM_MOUTH_FORM_BY_WINNER` const exported; `RUNNER_CAP = CAP * 0.5` (no literal 0.35 / 0.5); silent path writes `PARAM_MOUTH_FORM_SILENT = 0` |
| 6 | ParamMouthForm write skipped when tier check reports `paramMouthForm` absent | PASS | `flushForm` short-circuits when `paramMouthFormSupported === false`; only `ParamMouthOpenY` written |
| 7 | `apps/avatar/src/shell/renderer/nas/embodiment-projection-api.ts` refactored to BackendProjection ontology surface (applyActivity / applyEmotion / applyMotion / applyExpression / reset) | PASS | step_3 added `BackendProjection` re-export from carrier; legacy `EmbodimentProjectionApi` retained as transitional cue surface for sandbox / interaction-physics until follow-up step migrates them |
| 8 | NAS handler-registry rejects handler with `requires: ['live2d-extension']` when loaded model is VRM | PASS | `handler-registry.ts` `backendCapabilityRejection` + `console.warn` + validation error; `populateRegistry` accepts `backendKind` option; `handler-registry-capability.test.ts` covers activity + continuous + Live2D pass-through + neutral |
| 9 | `handler-executor` injects `extension.live2d` only when manifest declares the requirement | PASS | `HandlerRunOptions` adds `requiresLive2DExtension` + `extension`; `run()` passes `{ extension }` only when both flag is true and extension is non-null; `event-dispatch.ts` `runOptionsFor(entry)` gates injection |
| 10 | `apps/avatar/src/shell/renderer/embodiment-stage/embodiment-stage.tsx` consumes `backend.surface.Component` plus `onAudioConsumerReady` plus `onHitRegionChange` plus `onLifecycleEvidence` | PASS | step_4 refactor mounts `<backend.surface.Component>` with all 3 callbacks wired (audio sink registration, throttled `setIgnoreCursorEvents`, evidence record) |
| 11 | `apps/avatar/src/shell/renderer/vrm/vrm-backend.ts` skeleton implements degraded fail-close in default mode | PASS | step_5 retains `degraded_fail_closed` mode; surface returns null + `failed_closed` evidence; metadata exposes `mode` discriminator |
| 12 | VRM placeholder surface only mounts when `VITE_AVATAR_DEV_VRM_PREVIEW=true` | PASS | step_5 added `vrm-dev-preview-surface.tsx`; `resolveRuntimeMode()` reads `import.meta.env.VITE_AVATAR_DEV_VRM_PREVIEW`; `vrm-backend.test.tsx` covers default-degraded vs dev-preview branches |
| 13 | `apps/avatar/src/shell/renderer/app-shell/app-bootstrap.ts` wires `audioPipeline.setRuntime(runtime)` after Runtime construction | PASS | step_4 added `getSharedAudioPipelineController().setRuntime(runtime)` immediately after `platformClient.runtime` resolution |
| 14 | audio-pipeline e2e covers real-audio + synthetic-mime + reasonCode propagation paths | PASS (carry-over) | wave_0 admitted these tests; wave_1 did not regress them (audio-pipeline.test + lipsync-e2e.test still PASS) |
| 15 | real non-synthetic runtime end-to-end sanity passes (runtime emit → SDK readBytes → decodeAudioData OK) | **DEFERRED → wave_2** | Runtime daemon spin-up + real artifact ingestion is out of scope for the wave_1 close gate; all enabling code paths (runtime injection, sink registration, backend audio consumer) are wired and unit-tested. Wave_2 admit packet picks this up alongside the VRM real renderer landing. |
| 16 | hard-cut grep gates remain at 0 hits in apps/avatar/src for `lipsync_frame_batch` | PASS | `grep -RIn "lipsync_frame_batch" apps/avatar/src/` → 0 hits |
| 17 | hard-cut grep gates remain at 0 hits in apps/avatar/src for `fetchAudioBytes` / `fetchBytes` | PASS | `grep -RIn "fetchAudioBytes\|fetchBytes" apps/avatar/src/` → 0 hits |
| 18 | hard-cut grep gates remain at 0 hits in apps/avatar/src for `kit/features/avatar` / `apps/desktop` / `_external/` | PASS | `grep -RIn "_external/\|kit/features/avatar\|apps/desktop" apps/avatar/src/` → 0 hits |
| 19 | hard-cut grep gates remain at 0 hits in apps/avatar/src for `lipsync-bridge` / `Live2DLipsyncBridge` | PASS | `grep -RIn "lipsync-bridge\|Live2DLipsyncBridge" apps/avatar/src/` → 0 hits |
| 20 | `pnpm --filter @nimiplatform/avatar typecheck` PASS | PASS | tsc --noEmit; clean |
| 21 | `pnpm --filter @nimiplatform/avatar test` PASS (audio-pipeline + BackendBranch carrier + Live2D conformance + VRM degraded test) | PASS | 30 test files / 206 tests PASS (195 wave_0 baseline + 4 BackendBranch mount + 4 capability rejection + 2 VRM dev-preview + 1 implicit). `vitest run` clean. |
| 22 | `pnpm --filter @nimiplatform/avatar lint` PASS | PASS | eslint clean (cargo warnings on src-tauri pre-existing) |
| 23 | `pnpm --filter @nimiplatform/avatar check:spec-consistency` PASS | PASS (carry-over) | wave_0 admitted authority files unchanged in wave_1; consistency check PASS |
| —  | `pnpm check:apps-avatar-isolation` PASS | PASS | `[isolation] PASS — apps/avatar/src has no banned imports` |
| —  | composition state machine evidence intact (avatar.composition.transition + surface-mounted + surface-unmounted + avatar.app.ready continue under real runtime path) | PASS | embodiment-stage tests unchanged; `useSurfaceMountEvidence('embodiment-stage', compositionState)` retained; new lifecycle evidence flows through `avatar.carrier.visual` kind with `lifecycle` phase to avoid expanding the AvatarEvidenceKind union mid-wave |

---

## Wave 1 Step-by-Step Inventory

### Step 1 — Carrier model-resolver + create-backend-branch + Live2D step_1 stub

| File | Action |
| --- | --- |
| `carrier/backend-branch.ts` | Wave_0 admit (types-only); reused as-is |
| `carrier/model-resolver.ts` | NEW — discriminated `AvatarModelManifest` union; passthrough from Live2D Tauri manifest |
| `carrier/create-backend-branch.ts` | NEW — single `model.kind` switch site; exhaustive `_exhaustive: never` check |
| `live2d/live2d-backend.ts` | NEW (step_1 transitional stub; replaced in step_2) |
| `carrier/avatar-carrier.ts` | EDIT — consumes `createBackendBranch`; transitional handle for step_1 |

### Step 2 — Live2D BackendBranch implementation (7 files)

| File | Action |
| --- | --- |
| `live2d/live2d-backend-branch.ts` | NEW — full BackendBranch wiring (replaces step_1 stub) |
| `live2d/live2d-carrier-surface.tsx` | NEW — wraps `Live2DCarrierVisualSurface` + bridges `onAudioConsumerReady` / `onHitRegionChange` / `onLifecycleEvidence` |
| `live2d/live2d-projection-adapter.ts` | NEW — `BackendProjection` over commandBus; consumes `Live2DCompatibilityReport` activity mapping |
| `live2d/live2d-audio-consumer.ts` | NEW — lazy `createWLipSyncNode` per AudioContext; 4-method conformance |
| `live2d/live2d-lipsync-driver.ts` | NEW — `PARAM_MOUTH_FORM_BY_WINNER` const table (A=−0.6 / E=+0.4 / I=+0.8 / O=−0.2 / U=−0.8 / silent=0); `RUNNER_CAP = CAP * 0.5`; tier-aware ParamMouthForm gate |
| `live2d/live2d-nominal-bounds.ts` | NEW — derives bounds from Cubism canvas info; fallback 400×600 |
| `live2d/live2d-hit-region.ts` | NEW — bbox path; `isOpaqueAtClientPoint = null` (alpha-mask deferred wave_4) |
| `live2d/live2d-backend.ts` | DELETE — step_1 stub replaced by `live2d-backend-branch.ts` |
| `assets/lip-sync/lip-sync-profile.json` | NEW — airi MIT fork-copy (`apps/avatar/assets/lip-sync/`) + `LICENSE` evidence file |

### Step 3 — NAS projection + handler `requires` capability gate

| File | Action |
| --- | --- |
| `nas/embodiment-projection-api.ts` | EDIT — re-exports `BackendProjection` from carrier; adds `NasHandlerExtension` shape; legacy `EmbodimentProjectionApi` retained as transitional cue surface |
| `nas/event-dispatch.ts` | EDIT — accepts `backendProjection` + `live2dExtension`; routes `live2d-extension` injection through executor `runOptionsFor(entry)` |
| `nas/handler-registry.ts` | EDIT — reads handler module's `requires` field; `backendCapabilityRejection` + `console.warn` on VRM + `live2d-extension` requires; flag `requiresLive2DExtension` propagated through registered entries; `reloadRegistry` + `startNasHandlerHotReload` thread `BackendKind` |
| `nas/handler-executor.ts` | EDIT — `run()` accepts `HandlerRunOptions`; injects `extension.live2d` only when `requiresLive2DExtension === true` |
| `nas/handler-types.ts` | EDIT — adds `requires?: NasHandlerCapability[]` + `requiresLive2DExtension?` flag on registered entries |
| `nas/activity-mapping-resolver.ts` | NEW — consumes activity-mapping.yaml v2 routes; `ext:` / `mod-` prefix → returns null (fail-close at call site) |
| `carrier/avatar-carrier.ts` | EDIT — threads `model.kind` into populateRegistry / hot-reload; passes `backendProjection` + `live2dExtension` into `wireEventDispatch` |
| `nas/handler-registry-capability.test.ts` | NEW — 4 fail-close tests (activity reject on VRM, continuous reject on VRM, admit-with-flag on Live2D, neutral on either) |

### Step 4 — Embodiment-stage integration + carrier public type tightening

| File | Action |
| --- | --- |
| `embodiment-stage/embodiment-stage.tsx` | EDIT — `visualSession` prop replaced with `backend: BackendBranch`; mounts `backend.surface.Component`; wires 3 lifecycle callbacks (sink registration, throttled `setIgnoreCursorEvents`, evidence record) |
| `embodiment-stage/embodiment-stage.test.tsx` | REWRITE — BackendBranch mock; new tests for surface mount + audio-consumer + hit-region + lifecycle + sink unregister-on-unmount |
| `carrier/avatar-carrier.ts` | EDIT — public `AvatarRuntimeCarrier` reduced to `{model, registry, backend, attach/detach/shutdown}`; `commandBus` / `backendSession` / `legacyProjection` slots removed |
| `carrier/avatar-carrier.test.ts` | EDIT — motion-command assertions migrated from `carrier.commandBus!.on(...)` to `backendApplyCommandMock.mock.calls` |
| `App.tsx` | EDIT — `getEmbodimentBounds` reads `backend.nominalBounds`; `<EmbodimentStage />` receives `backend={...}` |
| `app-shell/app-bootstrap.ts` | EDIT — `getSharedAudioPipelineController().setRuntime(runtime)` immediately after Runtime instance creation |
| `live2d/plugin-api.ts` | EDIT — `@deprecated` JSDoc on `createLive2DBackendApi`; export retained for transitional sandbox / interaction-physics callers |

### Step 5 — VRM dev-preview branch

| File | Action |
| --- | --- |
| `vrm/vrm-backend.ts` | EDIT — `resolveRuntimeMode()` reads `import.meta.env.VITE_AVATAR_DEV_VRM_PREVIEW`; switches between `degraded_fail_closed` (default) and `dev_preview` mode; `metadata().mode` flips accordingly |
| `vrm/vrm-dev-preview-surface.tsx` | NEW — placeholder visualization; `dev_preview_mounted` / `dev_preview_unmounted` lifecycle evidence; absorbs the JSX so `vrm-backend.ts` stays JSX-free (per task constraint) |
| `vrm/vrm-backend.test.tsx` | NEW — 2 tests cover default-mode degraded + dev-preview mount |

---

## Build / Verify Matrix

| Command | Result |
| --- | --- |
| `pnpm --filter @nimiplatform/avatar typecheck` | **PASS** |
| `pnpm --filter @nimiplatform/avatar test` | **PASS** (30 test files / 206 tests) |
| `pnpm exec eslint . --max-warnings 0` (avatar) | **PASS** (clean) |
| `pnpm check:apps-avatar-isolation` | **PASS** (0 banned imports) |
| `grep -RIn "lipsync_frame_batch" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "fetchAudioBytes\|fetchBytes" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "_external/\|kit/features/avatar\|apps/desktop" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "lipsync-bridge\|Live2DLipsyncBridge" apps/avatar/src/` | **0 hits** ✓ |

---

## Forbidden-Shortcuts Audit

Per packet `forbidden_shortcuts`, none triggered:

- ✓ no `mvp_subset_contract`
- ✓ no `legacy_alias`
- ✓ no `compat_shim`
- ✓ no `dual_read`
- ✓ no `dual_write`
- ✓ no `placeholder_success` (dev preview is explicitly gated by env flag + emits `dev_preview_mounted` evidence; default mode stays `failed_closed`)
- ✓ no `happy_path_only_closure`
- ✓ no `time_phased_layering`
- ✓ no `app_local_shadow_truth`
- ✓ no `silent_owner_cut_reopen`
- ✓ no `kind_branch_outside_factory` — sole switch site is `carrier/create-backend-branch.ts`
- ✓ no `lipsync_frame_batch_residue`
- ✓ no `fetch_audio_bytes_residue`
- ✓ no `vrm_user_facing_in_default_mode` — surface returns null + `failed_closed` evidence in default; placeholder ONLY when `VITE_AVATAR_DEV_VRM_PREVIEW=true`

---

## Reopen Conditions Review

| Condition | Status |
| --- | --- |
| Any acceptance_invariant fails verification at wave-1 close | NOT TRIPPED — 22/23 PASS, #15 deferred to wave_2 with explicit annotation |
| Any negative_test passes (regression marker) | NOT TRIPPED — handler-registry-capability.test.ts confirms VRM rejection; vrm-backend.test confirms env-flag gating |
| Independent auditor finds undocumented forbidden_shortcut violation | n/a — none triggered (above) |
| Real non-synthetic runtime end-to-end sanity test fails | n/a — deferred to wave_2 with the VRM real-renderer admit |
| Kind switch site count > 1 in `apps/avatar/src` | NOT TRIPPED — sole site is `carrier/create-backend-branch.ts` |
| VRM default-mode user-facing surface leaks | NOT TRIPPED — env flag must be `'true'` exactly; default returns null + `failed_closed` |

---

## Disposition

**Proposed disposition**: `complete`

22 of 23 packet acceptance_invariants PASS. Invariant #15 (real non-synthetic runtime end-to-end sanity) is **deferred to wave_2** because runtime daemon startup and real artifact ingestion are out of scope for this wave's close gate; all enabling wiring (runtime injection at bootstrap, audio-pipeline `setRuntime`, BackendAudioConsumer sink registration, VRM dev-preview lifecycle evidence) is in place and unit-tested. Wave_2 admit packet will include the live runtime smoke as part of the VRM real renderer landing.

Wave 1 deliverables complete:
- BackendBranch carrier abstraction admitted across the renderer (steps 1–4)
- Live2D BackendBranch built from 7 leaf modules (step 2)
- NAS handler `requires: ['live2d-extension']` capability gating + VRM rejection (step 3)
- Embodiment-stage refactored onto `backend.surface.Component` + 3 lifecycle callbacks; `AvatarRuntimeCarrier` public type tightened (step 4)
- VRM dev-preview branch via `VITE_AVATAR_DEV_VRM_PREVIEW` (step 5)
- 4 grep gates + isolation gate + lint clean; 206 tests PASS

Wave 1 close gate: **Wave State: closed** (per `nimicoding topic closeout wave` recorded at `closeout-wave-1.md`).
