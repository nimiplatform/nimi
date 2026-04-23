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
- 身份 bootstrap 来自 shared auth session / shared JWT source，不来自 handoff payload
- handoff payload 不携带 raw JWT、refresh token、或 `subject_user_id`
- running avatar 会持续 revalidate shared auth session；同一 user 的 token rotation 只更新本地 auth state
- desktop logout、shared-session clear、invalid persisted session、realm mismatch、或 user switch 后，avatar 立即清空本地 auth、停止 runtime consume，并丢弃 stale authenticated state

## Runtime Primary, Mock Fixture Secondary

`apps/avatar` 当前正常启动路径已经切到 real runtime/SDK consume chain。Mock fixtures 仍保留，但只作为显式 dev/test evidence surface：

- 默认正常路径：desktop-selected launch context + shared desktop auth session + runtime bridge + SDK consume
- 显式 fixture：`VITE_AVATAR_DRIVER=mock`
- runtime 不可用：fail closed，显示启动错误；不会 silent fallback 到 mock
- shared auth session 失效：fail closed，保持 app 可见但不继续维持 authenticated runtime state

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

Platform-level spec consumed from topic proposal directory:

- [APML wire format](../../.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md)
- [Activity ontology](../../.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/activity-ontology.md)
- [Event contract](../../.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/event-hook-contract.md)
- [SDK Event API](../../.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/sdk-event-api.md)
- [Presentation Timeline](../../.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/presentation-timeline.md)

## Carrier Notes

- `SdkDriver` is the canonical carrier driver.
- `MockDriver` remains admitted only for explicit fixture runs and tests.
- App-local docs/spec must not describe mock as the current normal boot path.
- Desktop/avatar relationship is bridge / handoff orchestration plus shared runtime/auth truth, not the old independent default-boot framing.
- Live2D is the current backend-specific branch, not the semantic home of avatar/kernel truth.
