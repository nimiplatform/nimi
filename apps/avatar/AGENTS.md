# Nimi Avatar AGENTS.md

## Scope
- Applies to `apps/avatar/**`.
- Canonical Avatar authority is `.nimi/spec/avatar/embodiment-surface.authority.yaml`; Runtime participation truth stays in `.nimi/spec/runtime/agent-participation.authority.yaml`.
- The admitted backend union is `live2d | vrm`. Backend-specific execution never becomes the semantic home of Runtime or Avatar product truth.

## Hard Boundaries
- Kit owns reusable primitives, typed backend projections, and smoothing surfaces; Avatar owns product meaning, launch binding, package/profile validation, backend orchestration, and concrete rendering.
- Normal ready state requires Desktop-selected launch context, a Runtime/SDK-validated binding, a validated backend package and capability profile, and observed non-placeholder carrier output.
- `VITE_AVATAR_DRIVER=mock` is explicit fixture mode only. A fixture, loader completion, screenshot, static carrier, or evidence record must not claim real ready state, and Runtime failure never falls back to mock.
- Runtime owns agent, conversation, activity, voice artifact, timing, playback, and interruption truth. Avatar owns local playback and backend mouth parameters; drive lipsync only from same-stream Runtime audio/timing and become silent on missing, failed, canceled, or unavailable audio.
- Avatar does not synthesize speech directly, store durable voice caches, own auth/session truth, or create local Runtime/Realm transport.
- VRM generated motion requires deterministic executable output from a validated route/profile. `.vrma` remains interchange-only and is never runtime fallback proof.
- Ready-window bounds derive from current validated backend geometry and configured instance scale. Use the last valid bounded state on invalid resize output.
- Hit regions derive from current visible geometry. Drag begins only in the validated embodiment body region; overlays, transparent areas, companion/degraded surfaces, and stale precision data do not initiate drag.
- Consume shared surfaces through `@nimiplatform/kit/features/avatar` and platform data through public SDK entrypoints; do not rebuild shared owners inside the app.
- Do not import `apps/desktop/**`, `apps/web/**`, `apps/install-gateway/**`, Runtime internals, or `_external/**`.
- Treat generated Avatar tables and outputs as read-only. Change the admitted `config/avatar-*.yaml` input and regenerate.
- Fail closed on invalid launch context, binding, package, profile, backend load, audio, or geometry; never substitute placeholder success.

## Retrieval Defaults
- Start with the observed Avatar consumer, its backend branch, direct Kit/SDK contract, and the exact authority unit it implements.
- Read `config/avatar-*.yaml` only for the affected route, profile, activity, scenario, or window policy; do not preload all backend docs or historical evidence.
- Use `src/shell/renderer/{live2d,vrm}/**` only for the affected backend and the built-in semantic projection modules only for admitted activity/event projection; Desktop Electron Host code owns shell/window mechanics.

## Verification Commands
- Default: the focused Avatar test plus `pnpm --filter @nimiplatform/avatar typecheck`.
- When an admitted config projection changes, run only the generator or checker tied to that config.
- Run `pnpm check:apps-avatar-isolation` for import or package-boundary changes.
- Run the targeted Desktop Electron Host test for native shell/window changes.
