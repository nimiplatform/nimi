# @nimiplatform/avatar

Nimi Avatar（阿凡达）是桌面悬浮 embodiment carrier。Authority-defined backend union is `live2d | vrm | nimi2d`; no renderer backend is the semantic home of Runtime or Avatar product truth.

> This README is a non-authoritative operator guide. Normative authority lives
> in [`../../.nimi/spec/avatar/embodiment-surface.authority.yaml`](../../.nimi/spec/avatar/embodiment-surface.authority.yaml), with admitted machine inputs under `config/avatar-*.yaml`.

## Quick Links

- [Avatar authority reader guide](../../docs/authority/avatar-embodiment-rationale.md)
- [Live2D integration](../../docs/avatar/live2d-integration.md)
- [VRM motion authoring](../../docs/avatar/vrm-motion-authoring.md)
- [Module instructions](AGENTS.md)

## Launch Model

The normal path is Desktop bridge/handoff to a local Avatar asset:

- Launch context requires `agent_id`; `avatar_instance_id` and non-authoritative `launch_source` are optional.
- `agent_id` is a selector, not authorization proof. Runtime/SDK validates the active agent and conversation binding.
- Missing or invalid launch context fails closed; Avatar does not choose a default agent.
- Local Live2D, VRM, and Nimi2D assets enter only through their validated package/profile boundary.
- Runtime bootstrap uses the Desktop/Runtime bridge. Avatar does not read shared auth, create a Realm client, or own login/session truth.
- Handoff payloads do not carry raw tokens, `subject_user_id`, or Realm base URLs.
- When Runtime binding is unavailable, Avatar stops interaction, voice, and activity consumption, unmounts the normal carrier, and renders only the degraded surface.

## Runtime and Fixtures

- Normal boot uses the Desktop-selected launch context, local Avatar asset, Runtime bridge, and public SDK projections.
- `VITE_AVATAR_DRIVER=mock` enables an explicit development/test fixture.
- Fixture output never establishes real Runtime binding or carrier readiness.
- Runtime failure does not silently downgrade to fixture mode.

## Architecture

- Shell: Tauri 2 transparent always-on-top window.
- Renderer: React 19, Vite 7, Tailwind 4.
- Backends: `live2d | vrm | nimi2d`.
- Shared contracts and UI: `@nimiplatform/kit`.
- Runtime/Realm projections: public `@nimiplatform/sdk` entrypoints.
- Renderer-local state: Zustand.

The teaching model is:

`agent semantics -> embodiment projection -> backend-specific execution`

Runtime/SDK retain semantic truth. Avatar owns embodiment projection, validated package/profile binding, and concrete carrier execution. Kit owns reusable primitives and typed projection surfaces.

## Commands

```bash
pnpm --filter @nimiplatform/avatar dev:renderer
pnpm --filter @nimiplatform/avatar dev:shell
pnpm dev:avatar
VITE_AVATAR_DRIVER=mock pnpm --filter @nimiplatform/avatar dev:shell
pnpm --filter @nimiplatform/avatar typecheck
pnpm --filter @nimiplatform/avatar lint
pnpm --filter @nimiplatform/avatar test
```

## Main Paths

```text
apps/avatar/
├── src/shell/renderer/
│   ├── app-shell/   # renderer-local state and composition
│   ├── nas/         # semantic projection wiring
│   ├── live2d/      # Live2D backend
│   ├── vrm/         # VRM backend
│   ├── nimi2d/      # Nimi2D backend
│   ├── mock/        # explicit fixture driver
│   └── sdk/         # real Runtime/SDK adapter
└── src-tauri/       # bounded shell and window integration
```

## Upstream Contracts

- [Avatar embodiment surface](../../.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [Runtime participation and presentation](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [SDK client surface](../../.nimi/spec/sdks/client-core.authority.yaml)
- [Runtime activity ontology table](../../config/runtime-agent-activity-ontology.yaml)

The carrier consumes Runtime-owned conversation, activity, audio, timing, playback, and interruption projections. Avatar owns local rendering, playback, backend lipsync, visible geometry, hit regions, and bounded window behavior.
