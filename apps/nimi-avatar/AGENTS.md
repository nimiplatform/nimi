# Nimi Avatar AGENTS.md

> Authoritative module-level instructions for AI agents working on Nimi Avatar.

## Identity

- **App name (Chinese)**: 阿凡达
- **App name (English)**: Nimi Avatar
- **App ID**: `app.nimi.avatar`
- **One-line**: 桌面悬浮 Live2D 角色，agent 的视觉化身；通过 NAS handler 由第三方 model creator 定制动作 / 表情 / 交互。
- **Status**: Pre-MVP, mock-driven development phase.

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Desktop shell | Tauri 2 (transparent, always-on-top, no-chrome) | `src-tauri/` |
| Frontend | React 19 + Vite 7 + Tailwind 4 | `src/shell/renderer/` |
| Live2D runtime | Cubism SDK for Web (official) | `src/shell/renderer/live2d/` |
| State | Zustand | `src/shell/renderer/app-shell/` |
| NAS runtime | In-app handler discovery + execution + Live2D API | `src/shell/renderer/nas/` |
| AI / Events | `@nimiplatform/sdk` (mocked in Phase 1, real in Phase 2) | workspace dep |
| UI components | `@nimiplatform/nimi-kit` | workspace dep |
| Dev port | 1427 | `vite.config.ts` |

## Product Form

Nimi Avatar 不是常规软件窗口，而是 **桌面悬浮 Live2D 角色**：

- 透明背景（形状跟随 Live2D model bounds）
- 无 title bar / close / minimize buttons
- Always-on-top default
- Window drag 可在桌面自由移动
- Click-through 在模型边界外（点空白穿透到下层 app）
- Pet 旁有小 button 触发 chat（Phase 2）
- Chat bubble 显示最近一条消息（不显示历史）
- 输入浮动框在 chat 激活时出现，提交后消失（Phase 2）
- STT / TTS 通过 runtime 消费（Phase 2）

## Phase 1 Scope (current)

目标：Live2D 展示 + NAS 适配主干完成。

- Live2D Cubism SDK for Web 接入
- Model loading from `<model>/runtime/` official folder structure
- NAS handler discovery from `<model>/runtime/nimi/` (activity / event / continuous / lib)
- Handler execution with Live2D API v1（motion / parameter / expression / pose / wait）
- Default fallback（convention-based motion group lookup）
- 基础交互：click → `avatar.user.click` event → NAS handler；drag → window move；always-on-top
- Mock activity driver：scripted scenario 文件驱动 activity events 触发 handlers
- **Product-grade quality**（不是 prototype，是最终可交付 UI/UX/code）

## Phase 2 Scope (deferred)

- Chat bubble UI + floating input
- Small button UI trigger for chat
- Voice I/O via runtime（STT + TTS + lipsync from `apml.voice.level`）
- Real gRPC connection（mock → real switchover with zero app-level code change）
- Desktop app cross-app event subscription

## Spec Authority & Sync

`apps/nimi-avatar/spec/**` is Nimi Avatar's admitted app-local authority landing. Normative content belongs only in `spec/kernel/*.md` and `spec/kernel/tables/**`; `spec/INDEX.md` and `spec/nimi-avatar.md` are guides.

### Migrated from Topic Proposal

The following contracts migrated from `.nimi/local/report/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/`:

- `spec/kernel/agent-script-contract.md` ← `nimi-agent-script.md` (议题 4b)
- `spec/kernel/avatar-event-contract.md` ← `avatar-event-spec.md` (议题 3b)

### Platform-Level Upstream

Platform contracts remain at topic scope, consumed as upstream:

- APML wire format → `apml-design.md` (议题 1)
- APML LLM compliance → `apml-llm-compliance.md` (议题 1a)
- Activity ontology → `activity-ontology.md` (议题 2)
- Event contract + convention → `event-hook-contract.md` (议题 3)
- SDK Event API → `sdk-event-api.md` (议题 4a)
- Presentation Timeline → `presentation-timeline.md` (议题 5)

Nimi Avatar-specific contracts in this spec/kernel do not re-define upstream;只定义 app-local 行为 + downstream implementation binding。

### Key Tables

| Table | Governs |
|-------|---------|
| `feature-matrix.yaml` | Phase 1 / 2 / 3 feature phasing |
| `activity-mapping.yaml` | Activity id → Live2D motion group naming convention (default fallback) |
| `scenario-catalog.yaml` | Mock-driven development scenarios |

### Sync Rules

```
Rule → Table → Generate → Check → Evidence
```

1. Modify YAML table or contract first
2. Regenerate compiled TS constants
3. Run `pnpm --filter @nimiplatform/nimi-avatar check:spec-consistency`
4. Update code to match
5. Run full test suite

**Drift = CI failure.**

## Development Principles

### No Legacy, No Shims

Nimi Avatar starts from zero. No compatibility layers, no "simple first" shortcuts, full product quality from day one. Mock layer is clearly bounded（`src/shell/renderer/mock/`）and will be replaced by real gRPC / SDK backend in Phase 2 without changing app logic.

### Fail-Close

- Missing model folder → display error UI, not silent fallback
- NAS handler syntax error → reject handler + log, do not silently fall to default
- Unknown activity name（超出 ontology core + extended + mod-declared）→ fallback to convention motion group + log warn
- Live2D model load failure → display error UI, not empty canvas
- Mock scenario file invalid → app does not start（Phase 1）

## Hard Boundaries

### Mock vs Real Data Source

Phase 1 所有 agent data 是 **mock**。代码里 data source 必须清晰标注（via module path `src/shell/renderer/mock/` vs `src/shell/renderer/sdk/`）。Phase 2 wiring 只改 data source，app logic 不变。

### Window Behavior

- Transparent background 强制（非 option）
- No title bar / no close/min buttons on pet window
- Always-on-top default（配置可覆盖）
- Click-through outside model bounds（hit-region 计算）
- Dynamic window size 跟随 model bounds

### Live2D SDK Licensing

Cubism SDK for Web 按 Live2D 官方 licensing terms 使用。App bundle 仅包含 Cubism runtime；不 redistribute 任何 Live2D 官方 sample models。Model creators for Nimi Avatar 各自负责其 model 的 Live2D 分发授权。

### Model Package Integrity

App 从 `<model-pkg>/runtime/` 加载：
- 必须存在 `*.model3.json`（Cubism SDK 要求）
- 可选 `nimi/` 目录（按 agent-script-contract 扫描）
- 顶层 `.cmo3` / `.can3` source files 忽略（非 runtime 资源）

## Verification

```bash
# Spec layer
pnpm --filter @nimiplatform/nimi-avatar check:spec-consistency

# Code layer
pnpm --filter @nimiplatform/nimi-avatar typecheck
pnpm --filter @nimiplatform/nimi-avatar test
pnpm --filter @nimiplatform/nimi-avatar lint

# Rust layer
cd apps/nimi-avatar/src-tauri && cargo test
cd apps/nimi-avatar/src-tauri && cargo check
```

## Retrieval Defaults

Start with: `spec/kernel/tables/`, `spec/kernel/`, `src/shell/renderer/nas/`, `src/shell/renderer/live2d/`, `src/shell/renderer/app-shell/`, `src-tauri/src/`.

Skip: `node_modules/`, `dist/`, `target/`, lockfiles.

## Code Conventions

- ULID for all new IDs (not UUID)
- ISO 8601 for date/time fields
- ESM imports use `.js` extension for `.ts` files
- Handler files are ES modules（`export default`）
- Live2D parameter ids 用 Cubism 官方命名（如 `ParamEyeBallX`）
- Mock data 用 `*.mock.json` 后缀区分于真实 fixture
