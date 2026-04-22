# @nimiplatform/avatar

Nimi Avatar（阿凡达）— 桌面悬浮 Live2D 角色，Nimi agent 的视觉化身。

## Status

**Pre-MVP, Phase 1 in progress（mock-driven development）**

## Quick Links

- [Product guide](spec/nimi-avatar.md)
- [Spec authority map](spec/kernel/index.md)
- [Phase matrix](spec/kernel/tables/feature-matrix.yaml)
- [AGENTS.md](AGENTS.md) — Module-level rules for AI agents

## Development Phases

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Live2D rendering + NAS adaptation + window shell + mock driver | 🟡 active |
| Phase 2 | Chat bubble + voice I/O + real runtime integration | ⏸ deferred (after RuntimeAgent refactor completes) |
| Phase 3 | Cross-app integration / multi-backend rendering / advanced | 🔵 future |

## Why Mock-Driven

Runtime Agent 当前在 `.nimi/local/report/ongoing/2026-04-19-runtime-agent-service-architecture/` 下大重构。Nimi Avatar Phase 1 用 mock data 先行开发，以产品级质量落地；Phase 2 只替换 data source（mock → real SDK），app logic 不变。Mock fixtures 同时是 integration test corpus。

## Tech Stack

- **Desktop shell**: Tauri 2
- **Frontend**: React 19 + Vite 7 + Tailwind 4
- **Live2D**: Cubism SDK for Web (official)
- **State**: Zustand
- **Testing**: Vitest
- **Dev port**: 1427

## Scripts

```bash
# Renderer dev
pnpm --filter @nimiplatform/avatar dev:renderer

# Shell dev (Tauri)
pnpm --filter @nimiplatform/avatar dev:shell

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
├── mock.json                          # (tbd) default mock scenario
├── scripts/                           # Dev / check scripts
├── src/
│   └── shell/
│       └── renderer/                  # Frontend (React)
│           ├── app-shell/             # App shell state (Zustand)
│           ├── live2d/                # Cubism SDK integration
│           ├── nas/                   # NAS handler runtime
│           ├── mock/                  # Phase 1 mock driver
│           └── sdk/                   # (Phase 2) real SDK adapter
├── src-tauri/                         # Rust backend (Tauri)
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
└── spec/
    ├── INDEX.md
    ├── nimi-avatar.md
    └── kernel/
        ├── index.md
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

- [APML wire format](../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md)
- [Activity ontology](../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/activity-ontology.md)
- [Event contract](../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/event-hook-contract.md)
- [SDK Event API](../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/sdk-event-api.md)
- [Presentation Timeline](../../.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/presentation-timeline.md)
