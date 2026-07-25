# @nimiplatform/avatar

Nimi Avatar（阿凡达）— 桌面悬浮 embodiment carrier，承载 Nimi agent 的视觉化身。当前 admitted backend union 是 Live2D + VRM；Avatar 不把任何 renderer backend 当 app-local semantic home。

> This README is a non-authoritative operator guide. Normative authority lives
> under `../../.nimi/spec/avatar/embodiment-surface.authority.yaml` (machine rows in `config/avatar-*.yaml`) and the repo-wide platform specs referenced
> there.

## Status

**Productization gate active（local Avatar asset primary）**

## Quick Links

- [Spec authority map](../../docs/authority/avatar-embodiment-rationale.md)
- [Live2D integration and adapter authoring](../../docs/avatar/live2d-integration.md)
- [VRM motion authoring](../../docs/avatar/vrm-motion-authoring.md)
- [Feature matrix](../../docs/authority/avatar-embodiment-rationale.md)
- [AGENTS.md](AGENTS.md) — Module-level rules for AI agents

## Delivery Waves

| Wave | Scope | Status |
|------|-------|--------|
| 0 | Spec admit gate | done |
| 1 | Surface composition implementation | done |
| 2 | i18n + design tokens industrialization | done |
| 3 | Voice / lipsync end-to-end | done |
| 4 | Window + settings industrialization | done |
| 5-10 | BackendBranch, VRM, generated motion, hit-region, representative smoke evidence | done; this matrix does not establish final launch-readiness or visual-human acceptance |

## Launch Model

`apps/avatar` 现在不是一个“自己默认选 agent 然后独立跑起来”的 carrier。当前 canonical 正常路径是 desktop bridge / handoff + local Avatar asset：

- 正常启动必须带 Desktop-selected minimal launch context：required `agent_id`；optional `avatar_instance_id`、optional non-authoritative `launch_source`
- `agent_id` 是 selector，不是 authorization proof；Avatar 必须通过 Runtime / SDK 验证当前 agent/session projection
- 缺少 launch context：fail closed；avatar app 不会默认 bootstrap 单个 agent
- visual bootstrap 的主路径是 selected local Avatar asset。用户本地导入的 Live2D / VRM 是一等来源；Asset Market 已撤回，远程 marketplace package 不再是可进入 launch-time visual truth 的来源
- runtime bootstrap 只通过 Desktop/Runtime IPC bridge；Avatar 不读取 shared auth、不创建 Realm HTTP client、不拥有 login/session truth
- handoff payload 不携带 raw JWT、refresh token、`subject_user_id`、或 Realm base URL
- runtime binding 不可用时，Avatar 停止 interaction/voice/activity consume，
  unmounts the carrier, and enters degraded-only posture per active spec

## Runtime Primary, Mock Fixture Secondary

`apps/avatar` 当前正常启动路径已经切到 real runtime/SDK consume chain。Mock fixtures 仍保留，但只作为显式 dev/test evidence surface：

- 默认正常路径：desktop-selected launch context + local Avatar asset + runtime IPC bridge + SDK consume
- 显式 fixture：`VITE_AVATAR_DRIVER=mock`
- runtime 不可用：interaction/voice/activity fail closed；不会 silent fallback
  到 mock，visual carrier 不保持为可交互/可见正常态
- auth / Realm truth 归 Desktop/Runtime；Avatar 不做 shared-session revalidation

## Tech Stack

- **Desktop shell**: Tauri 2
- **Frontend**: React 19 + Vite 7 + Tailwind 4
- **Embodiment backends (admitted)**: Live2D Cubism SDK for Web + VRM / Three.js
- **State**: Zustand
- **Testing**: Vitest
- **Dev port**: 1427

## Protocol Model

Current canonical teaching model is:

`agent semantics -> embodiment projection -> backend-specific execution`

- runtime / SDK keep semantic truth
- `apps/avatar` owns embodiment projection and carrier execution
- current admitted backend branches are Live2D and VRM
- future backend branches require explicit backend contract admission, not README wording

## Scripts

```bash
# Renderer dev
pnpm --filter @nimiplatform/avatar dev:renderer

# Shell dev (Tauri)
pnpm --filter @nimiplatform/avatar dev:shell

# Live Avatar dev (real Runtime handoff + Vite HMR)
pnpm dev:avatar

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
```

## Upstream Platform Contracts

Platform-level spec is consumed from active `.nimi/spec/**` authority. The
tracked reader guide is
[Avatar Kernel Authority Map](../../docs/authority/avatar-embodiment-rationale.md).

- [APML wire format](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [Activity ontology](../../.nimi/spec/runtime/agent-participation.authority.yaml) and [activity ontology table](../../config/runtime-agent-activity-ontology.yaml)
- [HookIntent and event owner map](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [Runtime projection stream](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [Conversation anchor](../../.nimi/spec/runtime/agent-participation.authority.yaml)
- [SDK runtime consume surface](../../.nimi/spec/sdks/client-core.authority.yaml)
- [Presentation Timeline admission boundary](../../.nimi/spec/runtime/agent-participation.authority.yaml)

## Carrier Notes

- `SdkDriver` is the canonical carrier driver.
- `MockDriver` remains admitted only for explicit fixture runs and tests.
- App-local docs/spec must not describe mock as the current normal boot path.
- Desktop/avatar relationship is bridge / handoff orchestration plus Desktop/Runtime-owned binding truth, not the old independent default-boot framing.
- Live2D and VRM are admitted backend-specific branches, not the semantic home
  of avatar/kernel truth.
