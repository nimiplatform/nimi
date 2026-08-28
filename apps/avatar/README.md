# @nimiplatform/avatar

Nimi Avatar（阿凡达）是桌面悬浮 embodiment carrier。Authority-defined backend union is `live2d | vrm | nimi2d`; no renderer backend is the semantic home of Runtime or Avatar product truth.

> This README is a non-authoritative operator guide. Normative authority lives
> in [`../../.nimi/spec/avatar/embodiment-surface.authority.yaml`](../../.nimi/spec/avatar/embodiment-surface.authority.yaml), with admitted machine inputs under `config/avatar-*.yaml`.

## Quick Links

- [Avatar authority](../../.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [Live2D integration](../../docs/avatar/live2d-integration.md)
- [VRM motion authoring](../../docs/avatar/vrm-motion-authoring.md)
- [Module instructions](AGENTS.md)

## Launch Model

The normal path is Desktop bridge/handoff to a local Avatar asset:

- Launch context requires a current-session canonical `agent_handle` and exact
  `conversation_anchor_id`; `avatar_instance_id` and non-authoritative
  `launch_source` are optional.
- The handle and anchor are selectors, not authorization proof. Runtime/SDK
  validates their active session binding.
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
pnpm dev:avatar --cdp-port 19472
pnpm dev:avatar --agent-handle agent_ref_<current-session-handle>
pnpm dev:avatar --tauri --agent-handle agent_ref_<current-session-handle> --conversation-anchor-id <anchor>
VITE_AVATAR_DRIVER=mock pnpm --filter @nimiplatform/avatar dev:shell
pnpm --filter @nimiplatform/avatar typecheck
pnpm --filter @nimiplatform/avatar lint
pnpm --filter @nimiplatform/avatar test
```

The root `dev:avatar` command defaults to the Desktop-owned Electron carrier.
It enables deterministic loopback CDP port `9336` by default; `--cdp-port <port>`
overrides the port and `--no-cdp` disables it. `--tauri` selects the explicit Tauri
carrier and rejects `--cdp-port`. The avatar-only Electron carrier and ordinary
`pnpm dev:desktop` are mutually exclusive Desktop instances.

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
- [Runtime LocalAgent activity catalog](../../config/runtime-local-agent-activity-catalog.yaml)

The carrier consumes Runtime-owned conversation, activity, audio, timing, playback, and interruption projections. Avatar owns local rendering, playback, backend lipsync, visible geometry, hit regions, and bounded window behavior.
