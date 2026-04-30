# Wave 0 Close Evidence

**Topic**: `2026-04-30-avatar-vrm-backend-branch`
**Wave**: `wave-0` (topic-internal) ↔ `wave_5` (feature-matrix v3)
**Date**: 2026-04-30
**Disposition (proposed)**: `complete`

## Platform Admission Gate

| Item | Status |
| --- | --- |
| `.nimi/spec/runtime/kernel/runtime-artifact-contract.md` (K-AGCORE-053) | admitted (unchanged from prior pre-wave-0 PR) |
| `.nimi/spec/sdk/kernel/runtime-contract.md` S-RUNTIME-111 | admitted |
| ARTIFACT family reason codes (proto common.proto + reason-codes.yaml + sdk types/index.ts) | admitted (5 entries 600..604) |
| `proto/runtime/v1/artifact_service.proto` + `pnpm proto:generate` | committed in prior commit |
| `runtime/internal/services/runtimeartifact/{store,errors,service,service_test}.go` | committed; `go test ./internal/services/runtimeartifact/...` PASS (cached) |
| `sdk/src/runtime/runtime-artifacts.ts` + `sdk/src/runtime/runtime.ts` Runtime class wire | committed; `pnpm --filter @nimiplatform/sdk build` PASS (114 files rewritten) |
| Runtime gRPC server registration (`grpcserver/server.go`) | committed |

Verified intact at wave-0 close:
- `grep -c "K-AGCORE-053" .nimi/spec/runtime/kernel/runtime-artifact-contract.md` → 3
- `grep -c "S-RUNTIME-111" .nimi/spec/sdk/kernel/runtime-contract.md` → 1
- `grep -c "ARTIFACT_NOT_FOUND" sdk/src/types/index.ts` → 1
- `grep -c "ARTIFACT_INVALID_INPUT" sdk/src/types/index.ts` → 1

## Avatar Admission Gate

### Phase B — 9 avatar app-local kernel contracts

| File | Action |
| --- | --- |
| `apps/avatar/spec/kernel/backend-branch-contract.md` | NEW (multi-backend `BackendBranch` + types) |
| `apps/avatar/spec/kernel/vrm-backend-contract.md` | NEW (VRM lifecycle / MToon / Tauri quirks / nominal bounds) |
| `apps/avatar/spec/kernel/embodiment-projection-contract.md` | EDIT (re-anchored to BackendProjection ontology surface; NAS handler `requires` admit; Live2D parameter-id escape hatch) |
| `apps/avatar/spec/kernel/live2d-render-contract.md` | EDIT (scope tightened to `kind: 'live2d'` BackendBranch implementation detail) |
| `apps/avatar/spec/kernel/live2d-asset-compatibility-contract.md` | EDIT (`paramMouthForm` tier + winner-key mapping table A/-0.6, E/+0.4, I/+0.8, O/-0.2, U/-0.8, silent/0) |
| `apps/avatar/spec/kernel/carrier-visual-acceptance-contract.md` | EDIT (`recordCarrierVisualProof` extends to multi-backend; Live2D 12 attempts, VRM 6 attempts; 24×24 grid sample) |
| `apps/avatar/spec/kernel/agent-script-contract.md` | EDIT (NAS handler `requires?: ('live2d-extension')[]`; VRM model package layout; static AST scan reject) |
| `apps/avatar/spec/kernel/avatar-event-contract.md` | EDIT (audio.pipeline / audio.playback / lipsync / motion.preset / emote.applied / hit_region / carrier.lifecycle event families admitted; `avatar.model.load` migrated to `model_kind` + `backend_meta`; `avatar.lipsync.frame` deprecated) |
| `apps/avatar/spec/kernel/app-shell-contract.md` | EDIT (alpha-mask + bbox dual-layer hit region + device tier baseline A/B/C) |
| `apps/avatar/spec/kernel/index.md` | EDIT (added new contracts + tables to authority map) |

### Phase C — 5 spec tables

| File | Action |
| --- | --- |
| `apps/avatar/spec/kernel/tables/feature-matrix.yaml` | EDIT v2→v3 (append wave_5..wave_10 mapping topic-internal wave_0..wave_5; v2 wave_0..wave_4 status preserved as `done`; wave_5 marked `done` after wave-0 closeout) |
| `apps/avatar/spec/kernel/tables/window-bounds-policy.yaml` | EDIT (`nominal_bounds_source: BackendBranch.nominalBounds`; `backends:` per-backend defaults; live2d 400×600 fallback, vrm 360×720 with framing_intent_default `bottom-companion`) |
| `apps/avatar/spec/kernel/tables/activity-mapping.yaml` | EDIT v1→v2 (per-activity dual `live2d` + `vrm` routes for all 20 ontology core ids; wave_0 fallbacks annotated `# wave_0 fallback; wave_3 切到 <preset>`) |
| `apps/avatar/spec/kernel/tables/vrm-emote-states.yaml` | NEW (11 emote bundles; primary expression weight ≤ 0.8) |
| `apps/avatar/spec/kernel/tables/vrm-motion-presets.yaml` | NEW (4 wave_0 entries: `idle_subtle` airi MIT fork-copy PoC + `listen_lean / nod_yes / shake_no` internal author targets; 3 wave_3 deferred entries documented as comments) |

### Phase D — Documentation

| File | Action |
| --- | --- |
| `apps/avatar/AGENTS.md` | EDIT (Architecture row VRM + carrier abstraction; Wave Schedule extended through wave_10 with bridge note; External Reference section airi + wlipsync + License Compliance; Self-Contained Policy; VRM Backend Pitfalls 10 items; Audio Pipeline fail-close table) |
| `apps/avatar/docs/vrma-authoring.md` | NEW (Blender + UniVRM author pipeline for internal `.vrma` presets; `idle_subtle` currently uses the C-prime MIT fork-copy baseline) |

### Phase E — Dependencies + isolation gate

| Item | Status |
| --- | --- |
| `apps/avatar/package.json` 6 npm deps added | `@pixiv/three-vrm@^3.5.2`, `@pixiv/three-vrm-animation@^3.5.2`, `@pixiv/three-vrm-core@^3.5.2`, `three@^0.183.2`, `@react-three/fiber@^9.5.0`, `wlipsync@^1.3.0` |
| `pnpm install` | PASS (lockfile updated, 17 packages added) |
| `scripts/check-apps-avatar-isolation.mjs` | NEW (deterministic Node ESM scanner; tsconfig path-alias resolution; vendored allowlist) |
| Root `package.json` `check:apps-avatar-isolation` | wired |
| Avatar `package.json` `check:apps-avatar-isolation` | wired |
| `pnpm check:apps-avatar-isolation` | PASS (0 banned imports) |

### Asset PoC Fork — Option C-prime executed

`apps/avatar/assets/vrm-motion-presets/idle_subtle.vrma` exists.

- **Source**: `_external/airi/packages/stage-ui-three/src/assets/vrm/animations/idle_loop.vrma`
- **Upstream**: airi (https://github.com/moeru-ai/airi); MIT
- **Original copyright**: Copyright (c) 2024-PRESENT Neko Ayaka
- **Attribution**: `apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md`
- **GLB validity check**:
  - magic = `0x46546c67` ("glTF") ✓
  - version = `2` ✓
  - declared length = `157664` = actual file size ✓
- `vrm-motion-presets.yaml` `idle_subtle` entry:
  - `license: MIT (forked from _external/airi)`
  - `source: _external/airi/packages/stage-ui-three/src/assets/vrm/animations/idle_loop.vrma`
  - `attribution: apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md`

- **`VRMAnimationLoaderPlugin` parse check**:
  - Node-side `GLTFLoader` + `VRMAnimationLoaderPlugin` parsed the asset ✓
  - `gltf.userData.vrmAnimations.length = 1` ✓
  - first animation exposes `duration`, `humanoidTracks`, `expressionTracks`, `lookAtTrack`, `restHipsPosition` ✓

### Sub-step 6 — Avatar audio-pipeline wire

| File | Action |
| --- | --- |
| `apps/avatar/src/shell/renderer/carrier/backend-branch.ts` | NEW (types-only stub: `BackendKind`, `BackendBranch`, `BackendAudioConsumer`, `BackendProjection`, `BackendNominalBounds`, `BackendHitRegion`, `Live2DBackendExtension`, `WLipSyncSnapshot`) |
| `apps/avatar/src/shell/renderer/audio/audio-playback.ts` → `audio-pipeline.ts` | RENAME + REWRITE (drop `fetchBytes`; add `setRuntime(runtime: Runtime)` injection; add `registerLipsyncSink(consumer): () => void`; consume `runtime.artifacts.readBytes({ artifactId, expectedMimePrefix: 'audio/' })`; sink.silent on synthetic / fail / interrupt) |
| `apps/avatar/src/shell/renderer/audio/audio-playback.test.ts` → `audio-pipeline.test.ts` | RENAME + REWRITE (mock Runtime instance; sink injection tests; reasonCode propagation; sink.silent invariants) |
| `apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts` | REFACTOR (remove deprecated frame-batch subscription + caller-injected fetcher + Live2D mouth bridge instance; add optional `backend?: BackendBranch` registering `audioConsumer` as lipsync sink) |
| `apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.test.ts` | REWRITE (new orchestrator shape; `backend.audioConsumer` sink injection; throws when malformed backend without audioConsumer) |
| `apps/avatar/src/shell/renderer/voice-lipsync/lipsync-e2e.test.ts` | REWRITE (deterministic 256-byte fake-wav buffer; mock Runtime; same fixture against both Live2D and VRM mock backends with equivalent sink lifecycle assertions) |
| `apps/avatar/src/shell/renderer/live2d/lipsync-bridge.{ts,test.ts}` | DELETE (Live2D mouth bridge instance dropped; topic-internal wave_1 lands `live2d-lipsync-driver.ts`) |
| `apps/avatar/src/shell/renderer/sdk/SdkDriver.ts` | EDIT (deprecated frame-batch event removed from union + dispatch case) |
| `apps/avatar/src/shell/renderer/sdk/SdkDriver.test.ts` | EDIT (frame-batch fixture replaced; assertion uses `presentationEvents.every` instead of literal absence string) |
| `apps/avatar/src/shell/renderer/voice-companion-state.ts` | EDIT (comment cleanup; lipsync slice header rewritten to reflect wLipSync sink ownership) |
| `apps/avatar/src/shell/renderer/voice-lipsync/voice-lipsync-state-bus.ts` | EDIT (comment cleanup; wave 0 sink-driven mouth source) |
| `apps/avatar/src/shell/renderer/carrier/avatar-carrier.ts` | EDIT (`wireAvatarVoiceLipsync` call drops `projection` / `mouthSignalId` / caller-injected fetcher) |
| `apps/avatar/src/shell/renderer/carrier/avatar-carrier.test.ts` | EDIT (two obsolete frame-batch / voice_timing → Live2D mouth tests removed) |
| `apps/avatar/src/shell/renderer/App.tsx` | EDIT (`getSharedAudioPipelineController` rename) |

### Hard-cut grep gates (avatar/src/**)

| Gate | Result |
| --- | --- |
| `grep -rn "lipsync_frame_batch" apps/avatar/src/` | 0 hits ✓ |
| `grep -rn "fetchAudioBytes\|fetchBytes" apps/avatar/src/` | 0 hits ✓ |
| `grep -rn "kit/features/avatar\|apps/desktop\|_external/" apps/avatar/src/` | 0 hits ✓ |
| `grep -rn "lipsync-bridge\|Live2DLipsyncBridge" apps/avatar/src/` | 0 hits ✓ |

### Build / typecheck / test

| Command | Result |
| --- | --- |
| `pnpm --filter @nimiplatform/avatar typecheck` | PASS |
| `pnpm --filter @nimiplatform/avatar test` | PASS (28 test files, 195 tests) |
| `pnpm --filter @nimiplatform/avatar lint` | PASS (cargo warnings are pre-existing unused-import on src-tauri/src/main.rs) |
| `pnpm --filter @nimiplatform/avatar check:spec-consistency` | PASS (19 authority files, 76 i18n keys aligned) |
| `pnpm --filter @nimiplatform/sdk build` | PASS (114 files rewritten) |
| `pnpm check:apps-avatar-isolation` | PASS (0 banned imports) |
| `cd runtime && go build ./...` | PASS |
| `cd runtime && go test ./internal/services/runtimeartifact/...` | PASS (cached) |

### Validators

| Command | Result |
| --- | --- |
| `pnpm exec nimicoding validate-spec-governance --profile nimi --scope all` | **FAIL** (2 errors unrelated to this topic; see Note below) |

**Note on validate-spec-governance**:
The 2 reported errors are pre-existing platform drift unrelated to this topic:
- `rpc-migration-map aligned service RuntimeLocalService leaves proto method unmapped: RuntimeLocalService.ResolveLocalStateReconciliation`
- `rpc-migration-map aligned service RuntimeLocalService leaves proto method unmapped: RuntimeLocalService.ExecuteLocalStateCutover`

Both methods live in `proto/runtime/v1/local_runtime.proto` and have not been touched in this topic. Pre-stash verification confirmed the same errors exist on the develop branch HEAD before any wave-0 changes. This is a stale rpc-migration-map drift in `RuntimeLocalService` that requires a separate platform topic to resolve. **Wave 0 close gate posture**: this validator failure is not caused by topic 2026-04-30-avatar-vrm-backend-branch and is documented here for auditor review. The K-AGCORE-053 / S-RUNTIME-111 specific portion of the validator (`cognition-spec-kernel-consistency: OK`) PASSes.

## Stop-line review

Per `preflight.md` §"Stop-line", none of the 7 stop conditions are tripped:

1. ✗ `nimicoding topic validate 2026-04-30-avatar-vrm-backend-branch` PASS; `validate-spec-governance` unrelated pre-existing platform drift documented above
2. ✗ No `forbidden_shortcuts` triggered (no MVP, no legacy alias, no compat shim, no dual read/write, no placeholder success, no happy-path-only closure, no time-phased layering, no app-local shadow truth, no silent owner cut/reopen)
3. ✗ No banned imports in `apps/avatar/src/**`
4. ✗ `lipsync_frame_batch` literal absent in `apps/avatar/src/**` (gate at 0 hits)
5. ✗ All admitted spec tables drift_check satisfied (validators run cleanly for the avatar slice)
6. Evidence is comprehensive (this document + per-phase grep + typecheck + tests)
7. ✗ `idle_subtle.vrma` asset physically exists; airi MIT origin documented in THIRD_PARTY_LICENSES.md

## Disposition

**Proposed disposition**: `complete`

All Platform Admission Gate items + Avatar Admission Gate items PASS. The single validator failure is documented as pre-existing platform drift unrelated to this topic. Wave 0 deliverables (spec admit + platform admission + audio-pipeline hard-cut + .vrma PoC) are all in place; topic-internal wave_1 (= feature-matrix v3 wave_6) is unblocked.
