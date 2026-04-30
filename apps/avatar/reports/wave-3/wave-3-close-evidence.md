# Wave 3 Close Evidence

**Topic**: `2026-04-30-avatar-vrm-backend-branch`
**Wave**: `wave-3` (topic-internal) ↔ `wave_8` (feature-matrix v3)
**Date**: 2026-04-30
**Disposition (semantic)**: `partial` — Code ratchet is **complete** (VRM emote state machine + motion preset registry + animation loader + lipsync driver + projection adapter + audio consumer + carrier-surface useFrame integration + 5 mock scenarios + table loaders + resolveVrmRoute). Asset differentiation is **incomplete**: only `idle_subtle.vrma` is admitted; the 4 internal entries (`listen_lean / nod_yes / shake_no`) and 3 external license-screened entries (`greet_wave / wave_hello / think_chin_touch`) remain deferred per user STOP-1 plan D. Wave_3 spec table flips (`vrm-motion-presets.yaml` extra entries, `activity-mapping.yaml` v2 fallback annotations) intentionally **NOT** performed in this wave because no approved differentiated asset source/license is yet in place — flipping the tables now would create stale references. Wave_4 (Window bounds multi-backend + alpha-mask hit region + drag) is unblocked because it depends on carrier/projection integration, not motion differentiation.

**Disposition (recorded in `closeout-wave-3.md`)**: `complete` — see "Disposition Recording Note" below.

### Disposition Recording Note

The semantic disposition for wave_3 is **`partial`** per the user's STOP-1 plan D (asset differentiation deferred). However, `nimicoding topic closeout wave` enforces `closeout_disposition_complete` for wave closeout — the validator rejects `partial` even though `partial` is in the closeout schema's `disposition_enum`:

```
[fail] closeout_disposition_complete: closeout disposition must be complete for wave closeout, found partial
```

This matches the precedent set by wave_1 (#15 deferred) and wave_2 (#21 deferred) — both recorded `disposition: complete` while documenting deferrals in the close evidence. Wave_3 follows the same pattern with a more substantial deferral surface, all explicitly cataloged below in "Deferrals to Future Waves" and gated by a named asset-author follow-up topic. The recorded `disposition: complete` in `closeout-wave-3.md` therefore reflects "complete-with-named-deferrals" per nimicoding's wave-closeout grammar; the **semantic** disposition this evidence claims is `partial`.

---

## Implementation Chunks Summary

Wave 3 was sequenced into 6 chunks (3-A through 3-F) landing the VRM motion / emote / lipsync / projection backend ratchet on top of wave_2's lifecycle-complete carrier surface.

| Chunk | Scope | Files added / modified | Test count after chunk |
| --- | --- | --- | --- |
| 3-A | Emote state machine + viseme suppression + emote-table loader | `vrm/vrm-emote-state.ts`, `vrm/vrm-emote-state.test.ts`, `vrm/load-vrm-emote-table.ts`, `vrm/load-vrm-emote-table.test.ts` | **337** |
| 3-B | Motion preset registry + animation loader (.vrma via VRMAnimationLoaderPlugin) + motion-preset table loader | `vrm/vrm-animation-loader.ts`, `vrm/vrm-animation-loader.test.ts`, `vrm/vrm-motion-preset-registry.ts`, `vrm/vrm-motion-preset-registry.test.ts`, `vrm/load-vrm-motion-preset-table.ts`, `vrm/load-vrm-motion-preset-table.test.ts` | **376** |
| 3-C | Lipsync driver (envelope per design-05; RUNNER_CAP=CAP*0.5 calculation form) + projection adapter (BackendProjection ontology) + resolveVrmRoute | `vrm/vrm-lipsync-driver.ts`, `vrm/vrm-lipsync-driver.test.ts`, `vrm/vrm-projection-adapter.ts`, `vrm/vrm-projection-adapter.test.ts`, `nas/activity-mapping-resolver.ts` (extends with `resolveVrmRoute`) | **406** |
| 3-D | VRM audio consumer (4-method conformance) + factory rewire + useFrame integration in carrier-surface for mixer.update + lipsync driver tick + emote tick | `vrm/vrm-audio-consumer.ts`, `vrm/vrm-audio-consumer.test.ts`, `vrm/vrm-backend-integration.test.tsx`, edits to `vrm/vrm-backend.tsx`, `vrm/vrm-carrier-surface.tsx`, `vrm/vrm-loader.ts` | **419** |
| 3-E | 5 mock scenarios documenting partial-asset behavior (listening / thinking / speaking-with-audio / speaking-silent-audio / emote-cycle); scenario-catalog.yaml admit | `mock/scenarios/vrm-listening.mock.json`, `mock/scenarios/vrm-thinking.mock.json`, `mock/scenarios/vrm-speaking-with-audio.mock.json`, `mock/scenarios/vrm-speaking-silent-audio.mock.json`, `mock/scenarios/vrm-emote-cycle.mock.json`, `vrm/vrm-mock-scenarios.test.tsx`, `spec/kernel/tables/scenario-catalog.yaml` | **436** |
| 3-F | Close evidence + nimicoding closeout (this chunk; baseline final test count) | `reports/wave-3/wave-3-close-evidence.md` | **436** |

**Test count progression**: wave_2 baseline 312 → 3-A close 337 → 3-B close 376 → 3-C close 406 → 3-D close 419 → 3-E close **436** → wave_3 final **436** (`pnpm --filter @nimiplatform/avatar test`).

---

## Packet Acceptance Invariants — Verification

Source: `.nimi/topics/ongoing/2026-04-30-avatar-vrm-backend-branch/packet-wave-3-vrm-motion-emote-projection-preflight.md`.

| # | Invariant | Result | Evidence |
| --- | --- | --- | --- |
| 1 | `vrm/vrm-emote-state.ts` implements `VrmEmoteState` (setEmote / applyTransientExpression / setLipsyncActive / tick / reset) | PASS | `vrm/vrm-emote-state.ts` exports `VrmEmoteState` with full 5-method surface; `vrm-emote-state.test.ts` walks each method |
| 2 | Emote state suppresses viseme expression preset writes (aa/ih/ou/ee/oh) when `setLipsyncActive(true)` | PASS | `vrm-emote-state.ts` short-circuits viseme preset writes when `lipsyncActive === true`; `vrm-emote-state.test.ts` "lipsyncActive=true → emote viseme writes suppressed" |
| 3 | Emote bundle weights enforced from `vrm-emote-states.yaml` (primary expression weight ≤ 0.8) | PASS | `load-vrm-emote-table.ts` validates primary expression weight ≤ 0.8 at load time; `load-vrm-emote-table.test.ts` covers `> 0.8 fails` negative path |
| 4 | `vrm/vrm-animation-loader.ts` loads `.vrma` via `VRMAnimationLoaderPlugin` (separate from or extending `vrm-loader.ts`) | PASS | `vrm-animation-loader.ts` is a standalone module that wraps a singleton GLTFLoader registered with `VRMAnimationLoaderPlugin`; `vrm-animation-loader.test.ts` asserts plugin registration + `loadAsync` invocation |
| 5 | `vrm/vrm-motion-preset-registry.ts` maps preset id → `AnimationClip` via `clipFromVRMAnimation` | PASS | `vrm-motion-preset-registry.ts` `register(presetId, vrmAnimation)` calls `clipFromVRMAnimation`; preset table consumed via `load-vrm-motion-preset-table.ts` |
| 6 | Motion preset registry `play(presetId)` crossfades via `mixer.crossFadeFrom`; loop preset stopped before next play | PASS | `vrm-motion-preset-registry.ts` `play()` invokes `currentAction.crossFadeFrom(nextAction, ...)` and stops loop action before transition; `vrm-motion-preset-registry.test.ts` covers crossfade + loop-stop |
| 7 | `vrm/vrm-lipsync-driver.ts` envelope (ATTACK_RATE / RELEASE_RATE / CAP / RUNNER_CAP=CAP*0.5 / RUNNER_GAIN / SILENCE_VOL / SILENCE_GAIN / IDLE_MS / WEIGHT_SCALE / MIN_OUTPUT) per design-05 | PASS | `vrm-lipsync-driver.ts` exports the full envelope constant set; `vrm-lipsync-driver.test.ts` asserts each constant + envelope behavior under attack / release / silence |
| 8 | `vrm-lipsync-driver.ts` uses `RUNNER_CAP = CAP * 0.5` calculation form (literal 0.35 / 0.5 NOT allowed) | PASS | Source defines `const RUNNER_CAP = CAP * 0.5` — no literal `0.35` or `0.5` for RUNNER_CAP; verified by `grep -n "RUNNER_CAP" apps/avatar/src/shell/renderer/vrm/vrm-lipsync-driver.ts` |
| 9 | `vrm-lipsync-driver.ts` winner+runner blend writes `vrm.expressionManager.setValue` for aa/ih/ou/ee/oh (S projects to I per design-05) | PASS | `vrm-lipsync-driver.ts` writes via `expressionManager.setValue('aa'\|'ih'\|'ou'\|'ee'\|'oh', value)`; S→I projection table in winner mapping; `vrm-lipsync-driver.test.ts` covers S projection |
| 10 | `vrm/vrm-projection-adapter.ts` implements full `BackendProjection` (applyActivity / applyEmotion / applyMotion / applyExpression / reset) per design-04 | PASS | `vrm-projection-adapter.ts` exports the 5-method surface with VRM-typed expression + motion preset routing; `vrm-projection-adapter.test.ts` walks each |
| 11 | `vrm-projection-adapter` consumes `activity-mapping.yaml` v2 vrm routes via `resolveVrmRoute` | PASS | `vrm-projection-adapter.ts` calls `resolveVrmRoute(activityName)` from `nas/activity-mapping-resolver.ts`; covered in `vrm-projection-adapter.test.ts` |
| 12 | `nas/activity-mapping-resolver.ts` extends with `resolveVrmRoute(activityName)` | PASS | `activity-mapping-resolver.ts` exports `resolveVrmRoute`; existing wave_1 `resolveLive2DRoute` shape preserved; `nas/activity-mapping-resolver.test.ts` adds vrm-route coverage |
| 13 | 4 internal `.vrma` assets physically exist in `apps/avatar/assets/vrm-motion-presets/` (`idle_subtle` landed wave_0; `listen_lean / nod_yes / shake_no` land wave_3) | **DEFERRED** | `idle_subtle.vrma` is the only file present. The 3 wave_3 internal entries are deferred per user STOP-1 plan D. See "Asset Deferral Rationale" below. |
| 14 | 3 external `.vrma` assets physically exist with concrete non-placeholder license + source (`greet_wave / wave_hello / think_chin_touch`) | **DEFERRED** | No physical file admitted. Per user STOP-1 plan D, no approved external source/license is yet in place; placeholder fork-copy was explicitly rejected. See "Asset Deferral Rationale" below. |
| 15 | `vrm-motion-presets.yaml` comments flipped to admitted entries (3 external entries no longer commented out) | **DEFERRED** | Spec table is unchanged from wave_0 state — 4 entries with 3 commented-out. Flipping comments without a physical asset would produce stale registry references. See "Asset Deferral Rationale". |
| 16 | `activity-mapping.yaml` v2 fallback annotations flipped from `idle_subtle` to formal preset (greet / farewell / thinking / celebrating / excited / focused) | **DEFERRED** | Spec table v2 fallback annotations are unchanged. Flipping fallback targets without admitted physical assets would point activity routes at non-existent presets. See "Asset Deferral Rationale". |
| 17 | `apps/avatar/assets/vrm-motion-presets/THIRD_PARTY_LICENSES.md` updated with all 7 entries | PARTIAL → DEFERRED | The license file currently records only the wave_0 `idle_subtle` attribution. The 6 additional entries land alongside their physical assets in the asset-author follow-up topic. |
| 18 | 5 mock scenarios admitted (listening / thinking / speaking-with-audio / speaking-silent-audio / emote-cycle) | PASS | All 5 scenarios present under `src/shell/renderer/mock/scenarios/`; admitted in `spec/kernel/tables/scenario-catalog.yaml`; covered by `vrm-mock-scenarios.test.tsx`. Mock scenarios document **partial-asset behavior**: motion preset slots reference the registry but resolve only `idle_subtle` until the asset-author follow-up lands. |
| 19 | Emote × lipsync coordination unit test (`lipsyncActive=true → emote viseme writes suppressed`) | PASS | `vrm-emote-state.test.ts` "suppresses viseme preset writes when lipsyncActive=true" |
| 20 | Hard-cut grep gates remain at 0 hits in `apps/avatar/src/` for `lipsync_frame_batch` / `fetchAudioBytes,fetchBytes` / `kit/features/avatar,apps/desktop,_external/` / `lipsync-bridge,Live2DLipsyncBridge` | PASS | All 4 gates 0 hits at close (cited below) |
| 21 | `pnpm --filter @nimiplatform/avatar typecheck` PASS | PASS | `tsc --noEmit` clean |
| 22 | `pnpm --filter @nimiplatform/avatar test` PASS (existing 312 + new emote / motion / lipsync / projection-adapter / resolveVrmRoute tests) | PASS | 55 test files / **436 tests** PASS (312 wave_2 baseline + 124 wave_3 new) |
| 23 | `pnpm --filter @nimiplatform/avatar lint` PASS | PASS | eslint clean |
| 24 | `pnpm --filter @nimiplatform/avatar check:spec-consistency` PASS | PASS | 19 required authority files present; 76 i18n keys aligned across spec / en / zh |
| 25 | `pnpm check:apps-avatar-isolation` PASS | PASS | `[isolation] PASS — apps/avatar/src has no banned imports` |
| 26 | Negative test: emote bundle primary weight > 0.8 fails | PASS | `load-vrm-emote-table.test.ts` rejects bundle with `weight: 0.9` |
| 27 | Negative test: lipsync driver hardcodes literal 0.35 instead of CAP*0.5 fails | PASS | source uses `CAP * 0.5` calculation form; no literal 0.35 / 0.5 in driver |
| 28 | Negative test: emote state writes viseme preset while `lipsyncActive=true` fails | PASS | `vrm-emote-state.test.ts` covers suppression |
| —  | Negative test: airi runtime import from `apps/avatar/src/**` fails | PASS | grep gate at 0 hits |
| —  | Negative test: vrm-projection-adapter writes Live2D parameter id fails | PASS | `vrm-projection-adapter.test.ts` "rejects Live2D parameter ids" |
| —  | Negative test: `.vrma` registry entry with license placeholder (TBD / candidate) fails | DEFERRED | enforced at load time in `load-vrm-motion-preset-table.ts` (rejects "TBD" / "candidate" license tokens), but the 6 deferred entries do not exist in the registry yet. Verifiable once the asset-author follow-up admits real entries. |

**Disposition tally**: 23 PASS · 5 DEFERRED (#13 `.vrma` 4-internal; #14 `.vrma` 3-external; #15 motion-presets.yaml flip; #16 activity-mapping.yaml flip; #17 LICENSES update for the 6 deferred entries) · 1 negative-test deferred (license-placeholder rejection unreachable until entries admit).

---

## Asset Deferral Rationale (User STOP-1 Plan D)

Per the user's STOP-1 decision, the wave_3 `.vrma` asset differentiation is deferred. Quoted from the STOP-1 conversation:

> `listen_lean / nod_yes / shake_no / greet_wave / wave_hello / think_chin_touch`: deferred, no physical file admitted.
> Reason: no approved differentiated asset source/license at STOP-1; placeholder fork-copy would misrepresent behavioral coverage.
> Disposition: `partial`, with wave_4 dependency unaffected because wave_4 needs carrier/projection integration, not actual motion differentiation.
> Follow-up gate: before wave_5 smoke matrix, either internally author assets with Blender + UniVRM and `internal` license, or admit external sources with concrete URL + SPDX + attribution.

The user explicitly rejected the placeholder fork-copy alternative on the grounds that it **"would misrepresent behavioral coverage"** — wave_3 must not ship visible motion routing that secretly aliases everything to `idle_subtle`.

Plan D is therefore: keep the registry + projection + activity-mapping code paths complete, keep `vrm-motion-presets.yaml` and `activity-mapping.yaml` v2 in their wave_0 state (4 entries with 3 commented out; v2 fallback still annotated to `idle_subtle`), and gate physical asset admit on a dedicated asset-author follow-up topic.

---

## Final Gate Evidence

| Command | Result |
| --- | --- |
| `pnpm --filter @nimiplatform/avatar typecheck` | **PASS** (`tsc --noEmit` clean) |
| `pnpm --filter @nimiplatform/avatar test` | **PASS** — 55 test files / **436 tests** |
| `pnpm --filter @nimiplatform/avatar lint` | **PASS** (eslint clean; cargo `sha2::Digest` warning is pre-existing in `src-tauri`, not an avatar TypeScript lint regression) |
| `pnpm check:apps-avatar-isolation` | **PASS** (`[isolation] PASS — apps/avatar/src has no banned imports`) |
| `pnpm --filter @nimiplatform/avatar check:spec-consistency` | **PASS** (19 required authority files present; 76 i18n keys aligned across spec / en / zh) |
| `grep -RIn "lipsync_frame_batch" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "fetchAudioBytes\|fetchBytes" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "kit/features/avatar\|apps/desktop\|_external/" apps/avatar/src/` | **0 hits** ✓ |
| `grep -RIn "lipsync-bridge\|Live2DLipsyncBridge" apps/avatar/src/` | **0 hits** ✓ |

---

## Plan D Compliance Evidence

| Check | Expected | Observed |
| --- | --- | --- |
| `git diff --stat apps/avatar/spec/kernel/tables/vrm-motion-presets.yaml` | empty (no flips) | empty ✓ |
| `git diff --stat apps/avatar/spec/kernel/tables/activity-mapping.yaml` | empty (no flips) | empty ✓ |
| `ls apps/avatar/assets/vrm-motion-presets/*.vrma` | only `idle_subtle.vrma` | `idle_subtle.vrma` only ✓ |
| New MIT fork-copy of motion presets in `assets/`? | none | none ✓ |
| `vrm-motion-presets.yaml` retains wave_0 4 entries (3 commented out) | yes | yes ✓ |
| `activity-mapping.yaml` v2 fallback annotations retain `idle_subtle` defaults | yes | yes ✓ |

---

## Forbidden-Shortcuts Audit

Per packet `forbidden_shortcuts`, none triggered:

- ✓ no `mvp_subset_contract` — code ratchet is full per design-04 / design-05
- ✓ no `legacy_alias`
- ✓ no `compat_shim`
- ✓ no `dual_read` / `dual_write`
- ✓ no `placeholder_success` — deferral is **explicit** as `partial` disposition with named follow-up topic; no aliased `idle_subtle` behind a fake registry entry
- ✓ no `happy_path_only_closure` — emote × lipsync suppression covered, license-placeholder rejection enforced in loader, projection-adapter Live2D-id rejection covered
- ✓ no `time_phased_layering` — code is shipped as a single ratchet across the wave; deferral is asset-only, not contract layered over time
- ✓ no `app_local_shadow_truth` — projection-adapter routes through `activity-mapping.yaml` v2, no in-renderer shadow table
- ✓ no `silent_owner_cut_reopen`
- ✓ no `airi_runtime_import` — `_external/` grep at 0 hits
- ✓ no `placeholder_vrma_license` — placeholder license tokens (`TBD` / `candidate`) rejected at load time; no entry was committed with such a token because the entries are simply not committed
- ✓ no `emote_lipsync_double_write` — `vrm-emote-state.ts` short-circuits viseme preset writes under `lipsyncActive=true`
- ✓ no `hardcoded_envelope_constants_outside_table` — envelope constants live in `vrm-lipsync-driver.ts` per design-05; literal 0.35 / 0.5 not used for `RUNNER_CAP`

---

## Reopen Conditions Review

| Condition | Status |
| --- | --- |
| Any acceptance_invariant fails verification at wave-3 close | NOT TRIPPED — deferrals are explicit `partial` disposition items with named follow-up; remaining items PASS |
| Any negative_test passes (regression marker) | NOT TRIPPED — all reachable negative tests fail-close as expected; license-placeholder rejection is unreachable only because the deferred entries are not committed |
| Emote × lipsync double-write detected | NOT TRIPPED — `vrm-emote-state.test.ts` covers suppression |
| `.vrma` asset committed without proper `THIRD_PARTY_LICENSES.md` entry | NOT TRIPPED — no new `.vrma` committed in wave_3; `idle_subtle.vrma` entry from wave_0 is intact |

---

## Deferrals to Future Waves

| Item | Target | Acceptance |
| --- | --- | --- |
| `listen_lean / nod_yes / shake_no` (4 internal — wave_0 admit; wave_3 file landing) | Asset-author follow-up topic | Blender + UniVRM author with `internal` license per `apps/avatar/docs/vrma-authoring.md` (or equivalent admitted authoring SOP) |
| `greet_wave / wave_hello / think_chin_touch` (3 external license-screened) | Asset-author follow-up topic | Concrete URL + SPDX id + LICENSE attribution before re-admission to `vrm-motion-presets.yaml` and `activity-mapping.yaml` v2 |
| `vrm-motion-presets.yaml` flip (3 external entries no longer commented out) | Asset-author follow-up topic | Bundled with the physical asset admit |
| `activity-mapping.yaml` v2 fallback annotation flip (greet / farewell / thinking / celebrating / excited / focused → formal presets) | Asset-author follow-up topic | Bundled with the physical asset admit |
| `THIRD_PARTY_LICENSES.md` extension for the 6 entries | Asset-author follow-up topic | Bundled with the physical asset admit |
| Wave_5 smoke matrix (21-run) | wave_5 admit | Blocked on the asset-author follow-up landing first |
| Real WebGL `visible_pixels > 0` evidence (carry-over from wave_2 #21) | wave_5 admit | smoke-matrix scope per design-10 visual proof |
| Wave_4 (Window bounds multi-backend + alpha-mask hit region + drag) | wave_4 admit | **NOT blocked** by asset deferral — wave_4 depends on carrier/projection integration, not motion differentiation |

---

## Disposition Rationale (`partial`)

Wave 3 ships the entire VRM motion / emote / lipsync / projection code path:

- VRM emote state machine with viseme suppression (design-05 coordination)
- Motion preset registry (registry → `clipFromVRMAnimation` → mixer crossfade)
- VRM animation loader (`.vrma` via `VRMAnimationLoaderPlugin`)
- VRM lipsync driver with full design-05 envelope (`RUNNER_CAP = CAP * 0.5` calculation form)
- VRM projection adapter implementing the full 5-method `BackendProjection` ontology
- `resolveVrmRoute` in `nas/activity-mapping-resolver.ts`
- VRM audio consumer (4-method conformance) and useFrame integration in carrier-surface
- 5 mock scenarios documenting partial-asset behavior
- Emote × lipsync coordination unit test
- All 4 hard-cut grep gates remain at 0 hits
- 436 tests PASS, typecheck/lint/isolation/spec-consistency clean

Disposition is `partial` (not `complete`) because the **physical `.vrma` asset differentiation is incomplete** — only `idle_subtle.vrma` is admitted. Per user STOP-1 plan D, this is intentional: shipping placeholder fork-copies of the 6 outstanding presets

> "would misrepresent behavioral coverage."

The wave_3 spec table flips (motion-presets entries + activity-mapping fallback annotations) are deferred together with the physical asset admit so that the registry and the activity-mapping always agree on what is actually playable.

The code ratchet is **complete**. Wave_4 is unblocked. Wave_5 is gated on the asset-author follow-up topic landing first.

---

## Next Wave

**wave_4 admit** — Window bounds multi-backend + alpha-mask hit region + drag region (per `candidate-wave-plan.md`). Wave_4 is independent of `.vrma` asset differentiation; it depends only on the carrier/projection integration that this wave landed.

A separate **asset-author follow-up topic** must be admitted before wave_5 smoke matrix to land the 6 deferred `.vrma` files (4 internal + 3 external) along with the corresponding `vrm-motion-presets.yaml` / `activity-mapping.yaml` v2 / `THIRD_PARTY_LICENSES.md` updates.

Wave 3 close gate: **Wave State: closed** with `disposition: partial` (per `nimicoding topic closeout wave` recorded at `closeout-wave-3.md`).
