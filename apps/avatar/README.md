# @nimiplatform/avatar

Nimi Avatar（阿凡达）— 桌面悬浮 embodiment carrier，承载 Nimi agent 的视觉化身。当前 shipped backend branch 是 Live2D，不再把 Live2D 当 app-local semantic home。

## Status

**Pre-MVP, Wave 4 carrier landing active（runtime/SDK primary）**

## Quick Links

- [Product guide](spec/nimi-avatar.md)
- [Spec authority map](spec/kernel/index.md)
- [Phase matrix](spec/kernel/tables/feature-matrix.yaml)
- [AGENTS.md](AGENTS.md) — Module-level rules for AI agents

## Development Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Embodiment projection protocol + current Live2D backend branch + window shell + real runtime/SDK carrier path | 🟡 active |
| Phase 2 | Chat bubble + voice I/O companion UX | ⏸ deferred |
| Phase 3 | Cross-app integration / multi-backend rendering / advanced | 🔵 future |

## Launch Model

`apps/avatar` 现在不是一个“自己默认选 agent 然后独立跑起来”的 carrier。当前 canonical 正常路径是 desktop bridge / handoff：

- 正常启动必须带 desktop-selected launch context：`agent_id`、`avatar_instance_id`，以及显式 `conversation_anchor_id` 或 `open_new` mode
- 缺少 launch context：fail closed；avatar app 不会默认 bootstrap 单个 agent
- visual bootstrap 来自本机 Agent Center package；Avatar 只加载本地 Live2D / VRM visual package
- runtime bootstrap 只通过 Desktop/Runtime IPC bridge；Avatar 不读取 shared auth、不创建 Realm HTTP client、不拥有 login/session truth
- handoff payload 不携带 raw JWT、refresh token、`subject_user_id`、或 Realm base URL
- runtime binding 不可用时，Avatar 停止 interaction/voice/activity consume，但已加载的 visual carrier 必须保持可见

## Runtime Primary, Mock Fixture Secondary

`apps/avatar` 当前正常启动路径已经切到 real runtime/SDK consume chain。Mock fixtures 仍保留，但只作为显式 dev/test evidence surface：

- 默认正常路径：desktop-selected launch context + local visual package + runtime IPC bridge + SDK consume
- 显式 fixture：`VITE_AVATAR_DRIVER=mock`
- runtime 不可用：interaction/voice/activity fail closed；不会 silent fallback 到 mock，visual model 保持可见
- auth / Realm truth 归 Desktop/Runtime；Avatar 不做 shared-session revalidation

## Tech Stack

- **Desktop shell**: Tauri 2
- **Frontend**: React 19 + Vite 7 + Tailwind 4
- **Embodiment backend (current)**: Live2D Cubism SDK for Web
- **State**: Zustand
- **Testing**: Vitest
- **Dev port**: 1427

## Protocol Model

Current canonical teaching model is:

`agent semantics -> embodiment projection -> backend-specific execution`

- runtime / SDK keep semantic truth
- `apps/avatar` owns embodiment projection and carrier execution
- current backend-specific branch is Live2D
- future VRM / 3D / robot branches attach under the same projection layer, not by replacing semantic truth

## Scripts

```bash
# Renderer dev
pnpm --filter @nimiplatform/avatar dev:renderer

# Shell dev (Tauri)
pnpm --filter @nimiplatform/avatar dev:shell

# Explicit mock fixture boot
VITE_AVATAR_DRIVER=mock pnpm --filter @nimiplatform/avatar dev:shell

# Typecheck
pnpm --filter @nimiplatform/avatar typecheck

# Lint
pnpm --filter @nimiplatform/avatar lint

# Test
pnpm --filter @nimiplatform/avatar test

# Spec consistency
pnpm --filter @nimiplatform/avatar check:spec-consistency
```

## Directory Structure

```
apps/avatar/
├── AGENTS.md                          # Module-level AI agent rules
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── README.md                          # This file
├── mock.json                          # optional explicit fixture input
├── scripts/                           # Dev / check scripts
├── src/
│   └── shell/
│       └── renderer/                  # Frontend (React)
│           ├── app-shell/             # App shell state (Zustand)
│           ├── nas/                   # NAS runtime + embodiment projection-facing handler surface
│           ├── live2d/                # Cubism SDK integration
│           ├── mock/                  # Dev/test fixture driver + scenarios
│           └── sdk/                   # Real runtime/SDK consume adapter
├── src-tauri/                         # Rust backend (Tauri)
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
└── spec/
    ├── INDEX.md
    ├── nimi-avatar.md
    └── kernel/
        ├── index.md
        ├── embodiment-projection-contract.md
        ├── app-shell-contract.md
        ├── live2d-render-contract.md
        ├── agent-script-contract.md
        ├── avatar-event-contract.md
        ├── mock-fixture-contract.md
        └── tables/
            ├── feature-matrix.yaml
            ├── activity-mapping.yaml
            └── scenario-catalog.yaml
```

## Upstream Platform Contracts

Platform-level spec is consumed from active `.nimi/spec/**` authority. The
tracked reader guide is [Live2D Companion Architecture](../../docs/architecture/live2d-companion.md).

- [APML wire format](../../.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [Activity ontology](../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md) and [activity ontology table](../../.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml)
- [HookIntent and event owner map](../../.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [Runtime projection stream](../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [Conversation anchor](../../.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [SDK runtime consume surface](../../.nimi/spec/sdk/kernel/runtime-contract.md)
- [Presentation Timeline admission boundary](../../.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)

## Carrier Notes

- `SdkDriver` is the canonical carrier driver.
- `MockDriver` remains admitted only for explicit fixture runs and tests.
- App-local docs/spec must not describe mock as the current normal boot path.
- Desktop/avatar relationship is bridge / handoff orchestration plus Desktop/Runtime-owned binding truth, not the old independent default-boot framing.
- Live2D is the current backend-specific branch, not the semantic home of avatar/kernel truth.
