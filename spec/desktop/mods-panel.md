# Mods Panel Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Mods 面板 — Desktop 中 mod 管理的唯一一等公民入口；顶层导航名仍为 `Mods`，其实际页面定义为单一 `Mod Hub`。

## Module Map

- `features/mods/mods-panel.tsx` — `Mods` shell 入口
- `features/mod-hub/` — Mod Hub 业务逻辑与视图

## Kernel References

### Shell (D-SHELL-001, D-SHELL-002)

Mods Tab 受 `enableModUi` feature flag 门控。侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。

Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

### State (D-STATE-003, D-STATE-004)

Mod Hub 从 AppStore 读取：
- `localManifestSummaries`
- `registeredRuntimeModIds`
- `runtimeModDisabledIds`
- `runtimeModUninstalledIds`
- catalog list / update check 结果

计算派生状态：
- `installed`：本地已安装 mod
- `available`：catalog 中可发现但当前未安装的 mod
- `update-available`：已安装且存在 catalog 更新目标的 mod

### Mod Governance (D-MOD-007)

Mod Hub 统一负责：
- **Open** → `openModWorkspaceTab` + `setActiveTab('mod:${id}')`
- **Install / Update / Enable / Disable / Uninstall / Retry** → 统一在 Hub 行项目中处理

Disable / Uninstall 当前激活的 mod 时，fallback 导航到 `'mods'`。

## UI Contract

Mod Hub 采用单页列表布局：
- 顶部搜索
- 已安装分组
- 可安装分组
- 本地路径 / URL 安装入口
- 行内展示版本、trust tier、update、re-consent、warning 信息

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
