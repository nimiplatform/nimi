# Kit Feature: Avatar

## What It Is
Reusable agent avatar surface for runtime-backed presentation profiles and surface-local interaction state.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/avatar`
- `@nimiplatform/nimi-kit/features/avatar/headless`
- `@nimiplatform/nimi-kit/features/avatar/ui`
- `@nimiplatform/nimi-kit/features/avatar/runtime`
- `@nimiplatform/nimi-kit/features/avatar/vrm`
- Current surfaces:
  - `headless`: admitted for normalized presentation and transient interaction contracts
  - `ui`: admitted for the default avatar stage shell
  - `runtime`: admitted for runtime-backed persistent agent presentation projection helpers
  - `vrm`: admitted optional renderer surface for backend-specific VRM adapters without forcing 3D runtime assumptions into the default `ui` surface
  - `realm`: none

## When To Use It
- Reuse a shared avatar stage instead of rebuilding a chat-private or app-private agent renderer shell.
- Normalize runtime-owned presentation profiles and app-owned interaction cues before they reach renderer code.
- Bind first-party runtime agent presentation projection without moving transient voice/session state into runtime truth.
- Opt into VRM-specific renderer behavior only when a consumer truly needs a 3D avatar backend.

## Before Building Locally
- Check `avatar/ui` before building a new avatar stage, idle shell, or reusable agent render container.
- Check `avatar/headless` before introducing app-local presentation normalization, emotion cue mapping, or transient avatar interaction state contracts.
- Check `avatar/runtime` before wrapping runtime agent presentation projection directly in app code.
- Check `avatar/vrm` before introducing app-local R3F/VRM renderer code; prefer injecting that implementation through the admitted optional VRM surface.
- Prefer lazy-loading the concrete VRM viewport from the consumer side so heavyweight 3D runtime code only loads when a VRM backend is actually rendered.

## What Stays Outside
- Runtime canonical agent identity, canonical memory, and autonomy truth.
- Voice workflow, voice asset lifecycle, and standalone voice-library semantics.
- App-specific layout placement, permissions, and shell orchestration.
- Desktop-only thread/session meaning and app-local store ownership.
- VRM runtime engine dependencies and concrete WebGL host configuration unless the consumer explicitly opts into `avatar/vrm`.

## Current Consumers
- `desktop`
  Planned first-party consumer for agent chat and runtime-driven avatar presentation.
- `web`
  Planned first-party consumer for shared avatar presentation surfaces without desktop-specific shell semantics.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit lint`
- `pnpm check:nimi-kit`
