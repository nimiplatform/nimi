# @nimiplatform/avatar

`@nimiplatform/avatar` is the desktop floating embodiment carrier for Nimi AI characters, supporting `live2d` and `vrm` rendering backends under a unified presentation model.

> This README is an operator and developer guide. Normative authority lives in [`../../.nimi/spec/avatar/embodiment-surface.authority.yaml`](../../.nimi/spec/avatar/embodiment-surface.authority.yaml), with admitted machine inputs under `config/avatar-*.yaml`.

## Quick Links

- [Avatar authority](../../.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [Live2D integration](../../docs/avatar/live2d-integration.md)
- [VRM motion authoring](../../docs/avatar/vrm-motion-authoring.md)
- [Module instructions](AGENTS.md)

## Launch Model

In normal operation, Desktop bridges and hands off launch context to a local Avatar asset:

- **Session-bound selectors**: Launch context requires a canonical `agent_handle` from the current session. The common Host handoff accepts an optional `conversation_anchor_id`, revalidates the session fence before native launch, and preserves `avatar_instance_id` and any optional `launch_source`. The handle and anchor act only as selectors, not authorization proof; Runtime/SDK validates their active session binding.
- **Fail-closed startup**: If the launch context is missing or invalid, Avatar fails closed rather than picking a default agent.
- **Validated assets**: Local Live2D and VRM assets load strictly through their validated package and profile boundaries.
- **Zero auth custody**: Runtime bootstrap runs through the Desktop/Runtime bridge. Avatar does not read shared auth, create a Realm client, or own login/session state. Handoff payloads never carry raw tokens, `subject_user_id`, or Realm base URLs.
- **Degraded surface**: When Runtime binding becomes unavailable, Avatar halts interaction, voice, and activity consumption, unmounts the active carrier, and renders only the degraded surface.

## Runtime and Fixtures

- Normal boot uses the Desktop-selected launch context, local Avatar asset, Runtime bridge, and public SDK projections.
- Setting `VITE_AVATAR_DRIVER=mock` enables an explicit development/test fixture.
- Fixture output never establishes a real Runtime binding or carrier readiness, and Runtime failures never silently downgrade to fixture mode.

## Architecture

- **Shell**: Desktop-supervised Electron `BrowserWindow` (Avatar has no standalone native shell or native bundle)
- **Renderer**: React 19, Vite 8, Tailwind 4
- **Backends**: `live2d | vrm`
- **Shared contracts and UI**: `@nimiplatform/kit`
- **Runtime/Realm projections**: Public `@nimiplatform/sdk` entrypoints
- **Renderer-local state**: Zustand

Data flows through three distinct layers:

`agent semantics -> embodiment projection -> backend-specific execution`

Runtime owns execution and conversation semantics; the SDK carries their typed contracts. Avatar owns embodiment projection, validated package/profile binding, and carrier execution. Kit provides reusable primitives and typed projection surfaces.

## Commands

```bash
pnpm --filter @nimiplatform/avatar dev:renderer
pnpm dev:avatar
pnpm dev:avatar --cdp-port 19472
pnpm dev:avatar --agent-handle agent_ref_<current-session-handle>
VITE_AVATAR_DRIVER=mock pnpm --filter @nimiplatform/avatar dev:renderer
pnpm --filter @nimiplatform/avatar typecheck
pnpm --filter @nimiplatform/avatar lint
pnpm --filter @nimiplatform/avatar test
```

The root `pnpm dev:avatar` command launches the Desktop-owned Electron carrier with deterministic loopback CDP port `9336` enabled by default (`--cdp-port <port>` overrides the port; `--no-cdp` disables it). Because both supervise a Desktop instance, the avatar-only Electron carrier and `pnpm dev:desktop` cannot run simultaneously.

## Main Paths

```text
apps/avatar/
├── src/shell/renderer/
│   ├── app-shell/           # renderer-local state and composition
│   ├── semantic-projection/ # built-in activity and event projection wiring
│   ├── live2d/              # Live2D backend
│   ├── vrm/                 # VRM backend
│   ├── mock/                # explicit fixture driver
│   └── sdk/                 # real Runtime/SDK adapter
└── src-electron/            # preload sources consumed by the Desktop-supervised BrowserWindow
```

## Upstream Contracts

- [Avatar embodiment surface](../../.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [Runtime participation and presentation](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [SDK client surface](../../.nimi/spec/sdks/client-core.authority.yaml)
- [Runtime LocalAgent activity catalog](../../config/runtime-local-agent-activity-catalog.yaml)

The carrier consumes Runtime-owned conversation, activity, audio, timing, playback, and interruption projections, while Avatar manages local rendering, playback, backend lipsync, visible geometry, hit regions, and bounded window behavior.
