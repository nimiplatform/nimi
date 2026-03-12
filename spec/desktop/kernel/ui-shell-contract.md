# UI Shell Contract

> Authority: Desktop Kernel

## Scope

Desktop UI Shell 契约。定义导航 Tab 体系、布局结构、路由映射、i18n 规范、主题约定、Vite 分包策略。

## D-SHELL-001 — 导航 Tab 体系

导航由 `navigation-config.tsx` 定义，分为三组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、contacts、explore、runtime（gated）、settings
2. **Mod Nav**（sidebar puzzle icon）：mods（gated by `enableModUi`）— 点击直接进入 Mod Hub
3. **Detail Tab**：profile、agent-detail、world-detail、notification、privacy-policy、terms-of-service

Feature flag 门控：
- `enableRuntimeTab` 控制 runtime tab 可见性。
- `enableModUi` 控制 mods tab 可见性（sidebar puzzle icon + guard clause）。

## D-SHELL-002 — Mod UI 扩展

Mod UI 通过 feature flag 门控：

- `enableModUi`：启用 mod 组件渲染 + Mods Panel + sidebar puzzle icon。
- `enableModWorkspaceTabs`：启用 mod workspace tab 管理。
- `enableSettingsExtensions`：启用 settings panel 扩展区域。

Mods Panel（`features/mods/mods-panel.tsx`）直接承载单页 Mod Hub：
- 侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。
- `Mods` 打开后直接展示 Mod Hub，而不是旧的双视图结构。
- Mod Hub 统一负责发现、安装、更新、启用、禁用、卸载，以及通过 `Open Mods Folder` 暴露本地 installed mods 目录入口。
- Disable / Uninstall 当前激活 mod 时 fallback 到 `'mods'` tab。
- Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

`ui-extension.app.sidebar.mods` slot 仍可供 mods 注册额外导航项（参考 `D-HOOK-004`）。

## D-SHELL-003 — 窗口管理

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。
- `enableMenuBarShell`：启用 macOS menu bar 顶栏入口（desktop macOS only）。关闭主窗口时的 hide-vs-quit 语义由 `D-MBAR-005` 定义。

## D-SHELL-004 — Vite 分包策略

代码分割策略：

- **同步加载**：shell-core、bridge（首屏必需）。
- **懒加载**：chat、contacts、explore、settings、profile、runtime-view、mod-ui、local-ai、external-agent。

懒加载通过 `React.lazy(() => import(...))` 实现，配合 `Suspense` 边界。

## D-SHELL-005 — i18n 规范

- 翻译框架：`react-i18next`。
- 导航 label 使用 `t('Navigation.${id}', { defaultValue: item.label })`。
- locale 文件：`locales/en.json`、`locales/zh.json`。

## D-SHELL-006 — 布局结构

`MainLayoutView` 定义两栏布局：

- **左侧 sidebar**：可折叠，包含 core nav + mod nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatList` + `MessageTimeline` + `TurnInput`
- `contacts` → `ContactsPanel`
- `explore` → `ExplorePanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfileView`
- `runtime` → `RuntimeView`
- `mods` → `ModsPanel`（gated by `enableModUi`）
- `mod:*` → `ModWorkspacePanel`

## D-SHELL-007 — 图标系统

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、contacts、explore、runtime、profile、settings、store、globe、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout
- 未知图标名回退到 puzzle 图标。

## D-SHELL-008 — Shell Mode 检测

Shell 模式检测优先级（由高到低）：

1. `VITE_NIMI_SHELL_MODE` 环境变量（`'desktop'` / `'web'`）。
2. `window.__TAURI__` / `window.__TAURI_INTERNALS__` / `window.__TAURI_IPC__` 存在性检测。
3. SSR 环境默认 `'desktop'`。

检测结果驱动所有 feature flag 的默认值（`D-SHELL-001` ~ `D-SHELL-003`、`D-BOOT-004`）。

**统一 Feature Flag 派生表**（事实源：`tables/feature-flags.yaml`）：

| Flag | Desktop 默认 | Web 默认 | 控制规则 |
|---|---|---|---|
| `enableRuntimeTab` | `true` | `false` | `D-SHELL-001` |
| `enableModUi` | `true` | `false` | `D-SHELL-002` |
| `enableModWorkspaceTabs` | `true` | `false` | `D-SHELL-002` |
| `enableSettingsExtensions` | `true` | `false` | `D-SHELL-002` |
| `enableTitlebarDrag` | `true` | `false` | `D-SHELL-003` |
| `enableMenuBarShell` | `true`（macOS）/ `false`（其他） | `false` | `D-MBAR-001` |
| `enableRuntimeBootstrap` | `true` | `false` | `D-BOOT-004` |

Web 模式下所有 runtime/mod/window 相关功能默认禁用，仅保留基础 chat/social/explore 功能。此表为 `shellMode → flag` 映射的唯一定义，替代分散在各规则中的零散引用。

## D-SHELL-009 — Mod Developer Mode 入口

Desktop 必须在 App 内提供显式的 Developer Mode 入口，而不是把开发模式建立在启动参数之上：

- Developer Mode 的开启、关闭与状态展示必须位于 App 内可发现位置（例如 Settings / Developer）。
- Developer Mode 负责管理 `dev` source directories、auto reload 开关与开发态诊断入口。
- 第三方 mod 作者使用 Desktop 时，不应被要求通过启动参数或环境变量进入主要开发路径。

## D-SHELL-010 — Mod Source 可观测性与冲突可见性

Desktop UI 必须让用户可观察每个 mod 的解析来源与冲突状态：

- Mods Panel 必须可见 mod 的 source type、来源目录和当前状态（如 `loaded`、`disabled`、`failed`、`conflict`）。
- Developer Panel 必须展示 source directories 列表、每个目录发现的 mod、冲突项、reload 日志与错误链。
- Mod Hub 负责发现、安装、更新与卸载，不应承担主要调试入口；来源路径与冲突排障应在 Mods Panel / Developer Panel 中完成。

## Fact Sources

- `tables/app-tabs.yaml` — 导航 Tab 枚举
- `tables/feature-flags.yaml` — Feature flag 定义
- `tables/build-chunks.yaml` — Vite 分包枚举
- `menu-bar-shell-contract.md` — macOS menu bar shell 入口
