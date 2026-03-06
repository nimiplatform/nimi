# UI Shell Contract

> Authority: Desktop Kernel

## Scope

Desktop UI Shell 契约。定义导航 Tab 体系、布局结构、路由映射、i18n 规范、主题约定、Vite 分包策略。

## D-SHELL-001 — 导航 Tab 体系

导航由 `navigation-config.tsx` 定义，分为三组：

1. **Core Nav**（`getCoreNavItems()`）：home、chat、contacts、explore、runtime（gated）、settings
2. **Quick Nav**（`getQuickNavItems()`）：marketplace（gated）
3. **Mod Nav**（sidebar puzzle icon）：mods（gated by `enableModUi`）— 点击直接进入 Mods Panel
4. **Detail Tab**：profile、agent-detail、world-detail、notification、privacy-policy、terms-of-service

Feature flag 门控：
- `enableRuntimeTab` 控制 runtime tab 可见性。
- `enableMarketplaceTab` 控制 marketplace tab 可见性。
- `enableModUi` 控制 mods tab 可见性（sidebar puzzle icon + guard clause）。

## D-SHELL-002 — Mod UI 扩展

Mod UI 通过 feature flag 门控：

- `enableModUi`：启用 mod 组件渲染 + Mods Panel + sidebar puzzle icon。
- `enableModWorkspaceTabs`：启用 mod workspace tab 管理。
- `enableSettingsExtensions`：启用 settings panel 扩展区域。

Mods Panel（`features/mods/mods-panel.tsx`）是已安装 mod 的一等公民面板：
- 侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`，不再使用浮动下拉菜单。
- 面板以卡片网格展示已启用和已禁用的 mods，支持搜索过滤。
- 操作：Open（进入 mod workspace）、Enable、Disable、Uninstall、Retry（崩溃恢复）、Settings。
- Disable / Uninstall 当前激活 mod 时 fallback 到 `'mods'` tab。
- Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

`ui-extension.app.sidebar.mods` slot 仍可供 mods 注册额外导航项（参考 `D-HOOK-004`）。

## D-SHELL-003 — 窗口管理

- `enableTitlebarDrag`：启用原生窗口拖拽（desktop only）。
- `start_window_drag` IPC 命令触发拖拽操作。
- Web 模式下所有窗口管理操作禁用。

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

- **左侧 sidebar**：可折叠，包含 core nav + quick nav + mod nav + profile。
- **右侧 content**：根据 `activeTab` 渲染对应面板。

Content 面板映射：
- `chat` → `ChatList` + `MessageTimeline` + `TurnInput`
- `contacts` → `ContactsPanel`
- `explore` → `ExplorePanel`
- `settings` → `SettingsPanel`
- `profile` → `ProfileView`
- `runtime` → `RuntimeView`
- `marketplace` → `MarketplaceView`
- `mods` → `ModsPanel`（gated by `enableModUi`）
- `mod:*` → `ModWorkspacePanel`

## D-SHELL-007 — 图标系统

`renderShellNavIcon(icon)` 提供内联 SVG 图标：

- 支持的图标名：home、chat、contacts、explore、runtime、profile、settings、store/marketplace、globe/world-studio、wallet、agent/agents/my-agents/bot、terms/file/document、privacy/shield、logout、local-chat
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
| `enableMarketplaceTab` | `true` | `false` | `D-SHELL-001` |
| `enableModUi` | `true` | `false` | `D-SHELL-002` |
| `enableModWorkspaceTabs` | `true` | `false` | `D-SHELL-002` |
| `enableSettingsExtensions` | `true` | `false` | `D-SHELL-002` |
| `enableTitlebarDrag` | `true` | `false` | `D-SHELL-003` |
| `enableRuntimeBootstrap` | `true` | `false` | `D-BOOT-004` |

Web 模式下所有 runtime/mod/window 相关功能默认禁用，仅保留基础 chat/social/explore 功能。此表为 `shellMode → flag` 映射的唯一定义，替代分散在各规则中的零散引用。

## Fact Sources

- `tables/app-tabs.yaml` — 导航 Tab 枚举
- `tables/feature-flags.yaml` — Feature flag 定义
- `tables/build-chunks.yaml` — Vite 分包枚举
