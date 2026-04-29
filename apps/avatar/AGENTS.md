# Nimi Avatar AGENTS.md

> Authoritative module-level instructions for AI agents working on Nimi Avatar.

## Identity

- **App name (Chinese)**: 阿凡达
- **App name (English)**: Nimi Avatar
- **App ID**: `app.nimi.avatar`
- **One-line**: 桌面悬浮 embodiment carrier，agent 的视觉化身；通过 NAS handler 把 agent semantics 投影到当前 backend branch。
- **Status**: Pre-MVP. Wave 0 spec admit complete; Wave 1 surface composition implementation done; Wave 2 i18n + design tokens 工业化 active. Real runtime/SDK consume path is primary; mock is explicit fixture-only.

## Architecture

| Layer | Technology | Location |
|-------|-----------|----------|
| Desktop shell | Tauri 2 (transparent, always-on-top, no-chrome) | `src-tauri/` |
| Frontend | React 19 + Vite 7 + Tailwind 4 | `src/shell/renderer/` |
| Embodiment projection | App-local projection + NAS runtime | `src/shell/renderer/nas/` |
| Current backend branch | Cubism SDK for Web (official) | `src/shell/renderer/live2d/` |
| State | Zustand | `src/shell/renderer/app-shell/` |
| AI / Events | `@nimiplatform/sdk` real consume path | workspace dep |
| UI components | `@nimiplatform/nimi-kit` | workspace dep |
| Dev port | 1427 | `vite.config.ts` |

## Product Form

Nimi Avatar 不是常规软件窗口，而是 **桌面悬浮 embodiment surface**：

- 透明背景（形状跟随当前 embodiment backend 产出的 surface bounds + companion-surface footprint）
- 无 title bar / close / minimize buttons
- Always-on-top default
- Window drag 仅在 embodiment-stage 区域开启；companion / degraded 区域不开启 drag
- Click-through 在 embodiment 形状外 + companion 矩形外（点空白穿透到下层 app）
- Companion Surface（assistant bubble + status row + composer）固定 always-visible，绑定当前 launch-selected `agent_id + conversation_anchor_id`
- Degraded Surface 单独承载 loading / error / reauth / launch-context-invalid / relaunch-pending 形态，与 ready surface 互斥
- STT / TTS 通过 runtime 消费；lipsync 由 `runtime.agent.presentation.lipsync_frame_batch` 驱动 Live2D `ParamMouthOpenY`

## Wave Schedule

Avatar 重构分 5 个 wave；每个 wave 必须是端到端可交付能力切片，不允许半成品中间态。详细 scope 见 `spec/kernel/tables/feature-matrix.yaml`。

| Wave | 主题 | 状态 |
|---|---|---|
| 0 | Spec 重构（surface composition / companion / degraded / event 体系 / wave-based feature matrix） | done |
| 1 | Surface composition implementation（embodiment-stage / companion-surface / degraded-surface 三互斥结构 + hard-cut 旧 toggle 路径） | done |
| 2 | i18n + Design tokens 工业化（locales/{en,zh}/avatar.json + tokens.css + i18n-keys.yaml） | active |
| 3 | Lipsync end-to-end（runtime emitter + SDK 消费 + Live2D bridge + voice-companion-state slice） | pending |
| 4 | Window + Settings 工业化（dynamic window bounds + drag region 限定 + settings popover + window-bounds-policy.yaml） | pending |

工程原则：

- 项目未上线，不留 legacy shim；Phase 1/2/3 框架已废弃，只用 wave-based 模型
- 不做 MVP / 不做半成品中间态；每 wave 端到端交付
- spec 先行（`apps/avatar/spec/kernel/**` 与 `.nimi/spec/**`），spec admit 后再做实现
- 不做伪实现 / 伪返回；i18n、design tokens、lipsync 必须真实接通
- nimi-coding 为核心工作流；每 wave 跑完整 spec validators + code 验证

## Spec Authority & Sync

`apps/avatar/spec/**` is Nimi Avatar's admitted app-local authority landing. Normative content belongs only in `spec/kernel/*.md` and `spec/kernel/tables/**`; `spec/INDEX.md` and `spec/nimi-avatar.md` are guides.

### Migrated Contract Lineage

The following contracts were crystallized from lifecycle-topic evidence into
admitted app-local authority:

- `spec/kernel/agent-script-contract.md` ← `nimi-agent-script.md` (议题 4b)
- `spec/kernel/avatar-event-contract.md` ← `avatar-event-spec.md` (议题 3b)

### Platform-Level Upstream

Platform contracts are consumed from active `.nimi/spec/**` authority:

- APML wire format → `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- APML LLM compliance → `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
- Activity ontology → `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` and `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`
- HookIntent / event owner map → `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md` and `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
- SDK runtime consume surface → `.nimi/spec/sdk/kernel/runtime-contract.md`
- Presentation Timeline boundary → `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`

Nimi Avatar-specific contracts in this spec/kernel do not re-define upstream;只定义 app-local 行为 + downstream implementation binding。

### Key Tables

| Table | Governs |
|-------|---------|
| `feature-matrix.yaml` | Wave 0..4 wave-based feature delivery matrix（v2 schema） |
| `activity-mapping.yaml` | 当前 Live2D backend branch 的 activity → motion-group fallback naming |
| `scenario-catalog.yaml` | Dev/test fixture scenarios |
| `i18n-keys.yaml` | i18n key 与 spec 对齐表（Wave 2 admitted） |
| `window-bounds-policy.yaml` | （Wave 4 admit）dynamic window sizing 规则 |

### Sync Rules

```
Rule → Table → Generate → Check → Evidence
```

1. Modify YAML table or contract first
2. Regenerate compiled TS constants
3. Run `pnpm --filter @nimiplatform/avatar check:spec-consistency`
4. Update code to match
5. Run full test suite

**Drift = CI failure.**

## Development Principles

### No Legacy, No Shims

Nimi Avatar starts from zero. No compatibility layers, no "simple first" shortcuts, full product quality from day one. Mock layer is clearly bounded（`src/shell/renderer/mock/`）and remains fixture-only; runtime/SDK path is the current primary carrier line.

### Fail-Close

- Missing model folder → display error UI, not silent fallback
- NAS handler syntax error → reject handler + log, do not silently fall to default
- Unknown activity name（超出 ontology core + extended + mod-declared）→ fallback to convention motion group + log warn
- Embodiment backend load failure → display error UI, not empty canvas
- Runtime/bootstrap unavailable → app does not start; do not fall back to mock unless `VITE_AVATAR_DRIVER=mock` is explicit
- Mock scenario file invalid → explicit fixture boot does not start

## Hard Boundaries

### Mock vs Real Data Source

Normal app boot is **sdk/runtime-backed**. Mock remains bounded to explicit fixture mode (`VITE_AVATAR_DRIVER=mock`) and test corpus. Code-level data source boundaries must stay explicit（via module path `src/shell/renderer/mock/` vs `src/shell/renderer/sdk/`）, and runtime failures must not silently downgrade to mock.

### Window Behavior

- Transparent background 强制（非 option）
- No title bar / no close/min buttons on pet window
- Always-on-top default（配置可覆盖）
- Click-through outside active embodiment surface bounds（hit-region 计算）
- Dynamic window size 跟随 active embodiment surface bounds

### Live2D SDK Licensing

Cubism SDK for Web 按 Live2D 官方 licensing terms 使用。App bundle 仅包含 Cubism runtime；不 redistribute 任何 Live2D 官方 sample models。Model creators for Nimi Avatar 各自负责其 model 的 Live2D 分发授权。

### Model Package Integrity

当前 Live2D backend branch 从 `<model-pkg>/runtime/` 加载：
- 必须存在 `*.model3.json`（Cubism SDK 要求）
- 可选 `nimi/` 目录（按 agent-script-contract 扫描）
- 顶层 `.cmo3` / `.can3` source files 忽略（非 runtime 资源）

## Verification

```bash
# Spec layer
pnpm --filter @nimiplatform/avatar check:spec-consistency

# Code layer
pnpm --filter @nimiplatform/avatar typecheck
pnpm --filter @nimiplatform/avatar test
pnpm --filter @nimiplatform/avatar lint

# Rust layer
cd apps/avatar/src-tauri && cargo test
cd apps/avatar/src-tauri && cargo check
```

`lint` and `check:spec-consistency` are current supported commands for this app.
If either command stops resolving, repair the app-local tooling surface before
advertising the workflow as canonical.

## Retrieval Defaults

Start with: `spec/kernel/tables/`, `spec/kernel/`, `src/shell/renderer/nas/`, `src/shell/renderer/live2d/`, `src/shell/renderer/app-shell/`, `src-tauri/src/`.

Skip: `node_modules/`, `dist/`, `target/`, lockfiles.

## Code Conventions

- ULID for all new IDs (not UUID)
- ISO 8601 for date/time fields
- ESM imports use `.js` extension for `.ts` files
- Handler files are ES modules（`export default`）
- Live2D parameter ids 用 Cubism 官方命名（如 `ParamEyeBallX`）仅适用于当前 Live2D backend branch
- Mock data 用 `*.mock.json` 后缀区分于真实 fixture
