# Overtone — Execution Plan

> Phased app plan for the AI music demo. This is an implementation plan, not execution evidence.

## Phase Overview

| Phase | Goal | Outcome |
|-------|------|---------|
| 0 | Spec freeze and technical proof points | clear scope, app name, SDK/runtime assumptions |
| 1 | App shell and direct connectivity | Tauri app boots, talks to runtime and realm |
| 2 | Core music creation MVP | prompt/lyrics -> generate -> compare -> playback |
| 3 | Market-aligned iteration tools | reference upload, extend/remix, better take lineage |
| 4 | Publish and polish | realm publish, metadata, cover art, onboarding |
| 5 | Experimental extras | guide vocals and voice lab |

## Phase Dependencies

| Phase | Depends on | Why |
|-------|------------|-----|
| 1 | 0 | app shell should not start before scope and transport assumptions are fixed |
| 2 | 1 | core workflow depends on runtime/realm bootstrap and workspace shell |
| 3 | 2 | extend/remix/reference requires the take model, playback loop, and job flow from Phase 2 |
| 4 (basic publish) | 2 | basic publish depends on a generated master take; can start in parallel with Phase 3 |
| 4 (derived/provenance publish) | 3 | publish metadata for reference/derived takes depends on lineage tracking |
| 5 | 2 | optional extras depend on the main workspace and generation loop |

## Phase 0: Spec Freeze

**Goal**: Lock the product direction before implementation starts.

### Tasks

- Keep the app name as `Overtone` / `Overtone Studio`.
- Confirm the demo is a standalone Tauri app under `apps/overtone/`.
- Confirm the app uses SDK direct connections to runtime and realm.
- Reduce scope from "all music-adjacent AI tools" to a music-creation-first workflow.
- Mark voice cloning and advanced vocals as optional.

### Exit Criteria

- `overview.md`, `architecture.md`, `features.md`, `sdk-integration.md`, and this plan are consistent.

## Phase 1: Shell and Direct Connectivity

**Goal**: Prove the desktop shell and direct transport path.

### Tasks

- Scaffold the Tauri app structure under `apps/overtone/`.
- Reuse the minimal Rust runtime bridge subset from `apps/desktop`.
- Construct `Runtime` and `Realm` SDK clients in the renderer bootstrap.
- Implement readiness checks for runtime availability, realm auth, and connector status.
- Create a simple project workspace shell with route/state skeleton.

### Exit Criteria

- The app boots.
- Runtime text and music calls can be invoked.
- Realm client can authenticate and make a basic request.

## Phase 2: Core Music Creation MVP

**Goal**: Deliver the smallest credible AI music creation workflow.

### Tasks

- Build the song brief form and lyrics canvas.
- Wire text generation into the brief and lyric helpers.
- Implement music generation submit/progress/result flow.
- Decode audio artifacts and enable playback.
- Save each generation as a take with prompt and lyric snapshots.
- Add quick compare and favorite/select actions.

### Exit Criteria

- A user can go from idea to at least one playable song candidate.
- Multiple takes can be generated and compared.

## Phase 3: Market-Aligned Iteration Tools

**Goal**: Make the demo feel like a current AI music product instead of a thin prompt wrapper.

**Hard gate before implementation**: verify that the target music provider path can interpret the required `nimi.scenario.music_generate.request` extension payload for reference/extend/remix flows. If not, add the runtime adapter patch first.

### Tasks

- Add uploaded audio or existing-take reference flow.
- Introduce internal `buildMusicIterationExtensions(...)` for extend/remix/reference modes.
- Track take lineage: source take, source mode, derived take notes.
- Add trim-based preview selection for more targeted iteration.

### Exit Criteria

- A user can derive a new take from an earlier take or uploaded reference clip.
- The UI explains the relationship between original and derived takes.

## Phase 4: Publish and Polish

**Goal**: Close the loop from creation to shareable output.

### Tasks

- Add publish form with title, description, and tags.
- Add provenance confirmation for uploaded/reference audio.
- Upload selected audio to realm media.
- Create a realm post for the chosen master take.
- Optionally generate and attach cover art.
- Improve empty states, connector guidance, and failure messaging.

### Exit Criteria

- A completed take can be published to realm.
- The publish flow makes reference-audio provenance explicit.

## Phase 5: Experimental Extras

**Goal**: Explore optional multimodal features without blocking the demo.

### Tasks

- Add guide-vocal generation via TTS.
- Add voice asset browsing.
- Evaluate `VOICE_CLONE` and `VOICE_DESIGN` as isolated experiments.

### Exit Criteria

- Optional voice tooling exists behind clear experimental boundaries.
- The main music workflow stays intact if these features are disabled.

## Risks and Watchpoints

- Provider-specific music iteration semantics may change faster than stable SDK/kernel contracts.
- Audio upload and derivative creation require explicit provenance UX.
- Over-investing in vocals or timeline editing can delay the actual demo value.
- The app should not assume one music provider forever; connector and model selection must stay configurable.
