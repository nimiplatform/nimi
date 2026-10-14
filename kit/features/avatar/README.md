# Kit Feature: Avatar

Reusable agent avatar surfaces for Runtime-adjacent presentation records, voice playback cues, and surface-local interaction state.

## Public Surfaces

| Subpath | Responsibility |
| :--- | :--- |
| `@nimiplatform/kit/features/avatar` | Root feature entry |
| `@nimiplatform/kit/features/avatar/headless` | Normalized presentation and transient interaction contracts |
| `@nimiplatform/kit/features/avatar/ui` | Default avatar stage shell and Agent Center preview facade |
| `@nimiplatform/kit/features/avatar/runtime` | Avatar presentation records, playback cue envelopes, and estimator helpers (consumes typed projection data from Runtime/SDK) |
| `@nimiplatform/kit/features/avatar/vrm` | Optional renderer surface for VRM adapters; keeps 3D runtime assumptions out of the default `ui` surface |
| `@nimiplatform/kit/features/avatar/live2d` | Optional renderer and helper surface for Live2D adapters; keeps desktop-local source loading and Cubism bootstrapping out of Kit |
| `realm` | None |

## When To Use It

- **Shared stage shell**: Reuse a common avatar stage instead of building a chat-private or app-private agent renderer shell.
- **Contract normalization**: Normalize runtime-owned presentation profiles and app-owned interaction cues before passing them to renderer code.
- **Runtime-adjacent playback**: Bind first-party avatar presentation records and playback cues without pushing transient voice or session state into Runtime truth.
- **Optional 3D / Live2D backends**: Opt into `avatar/vrm` or `avatar/live2d` only when your app actually renders those backends, keeping consumer-local runtime bootstrapping separate.

### Host Handoff Mechanics

The canonical Host handoff port handles launch, focus, and presence as native mechanics over a single opaque handle-and-anchor target, plus optional opaque references for committed-presentation, temporary-custody, and instance state.

It never determines product availability, nor does it carry truth for configuration, declaration, coverage, product availability, Runtime result/error, raw identity, renderer, backend, motion, lipsync, path, or storage.

## Before Building Locally

- **`avatar/ui`**: Check here before building a new avatar stage, idle shell, or reusable agent render container.
- **`avatar/ui` + `avatar/headless` (Agent Center previews)**: Check both before rendering Agent Center avatar previews. A configured Agent Center avatar is ready only when the Avatar renderer binds the exact committed asset, backend, and presentation revision, reports a typed backend terminal state, and returns an Avatar-controlled blob or same-origin render-surface URL.
- **`avatar/headless`**: Check here before introducing app-local presentation normalization, emotion cue mapping, or transient avatar interaction state contracts.
- **`avatar/runtime`**: Check here before rebuilding avatar presentation-record or playback-cue helpers in app code. Runtime event scheduling decisions belong in `@nimiplatform/sdk/runtime`.
- **`avatar/vrm`**: Check here before writing app-local R3F/VRM renderer code. Inject the implementation through this optional surface and lazy-load the concrete VRM viewport on the consumer side so heavyweight 3D runtime code loads only when a VRM backend is rendered.
- **`avatar/live2d`**: Check here before writing app-local Live2D framing, motion-choice, or viewport-state policy. Keep source loading and concrete Cubism runtime bootstrap on the consumer side, and lazy-load the concrete Live2D viewport so backend runtime code loads only when a Live2D backend is rendered.

## What Stays Outside

- Runtime canonical agent identity, canonical memory, and autonomy truth.
- Voice workflows, voice asset lifecycle, and standalone voice-library semantics.
- App-specific layout placement, permissions, and shell orchestration.
- Agent Center asset bytes, file adaptation, and preview rendering (Kit renders fail-closed when Avatar preview output is missing).
- Desktop-only thread/session meaning and app-local store ownership.
- VRM runtime engine dependencies and concrete WebGL host configuration unless the consumer explicitly opts into `avatar/vrm`.
- Desktop-local asset binding, file adaptation, and concrete Cubism runtime lifecycle, even when opting into `avatar/live2d`.

## Current Consumers

- `desktop`: Planned first-party consumer for agent chat and runtime-driven avatar presentation.
- `web`: Planned first-party consumer for shared avatar presentation surfaces without desktop-specific shell semantics.

## Verification

```bash
pnpm --filter @nimiplatform/kit lint
pnpm check:nimi-kit
```
