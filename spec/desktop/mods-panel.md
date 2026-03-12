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
- `runtimeModFailures`
- `fusedRuntimeMods`
- `runtimeModDiagnostics`
- catalog list / update check 结果

计算派生状态：
- `installed`：本地已安装 mod
- `available`：catalog 中可发现但当前未安装的 mod
- `update-available`：已安装且存在 catalog 更新目标的 mod
- `failed/conflict`：本地注册失败、fuse 失败或 source conflict 的 mod

### Mod Governance (D-MOD-007)

Mod Hub 统一负责：
- **Open** → `openModWorkspaceTab` + `setActiveTab('mod:${id}')`
- **Install / Update / Enable / Disable / Uninstall / Retry** → 统一在 Hub 行项目中处理

Disable / Uninstall 当前激活的 mod 时，fallback 导航到 `'mods'`。

## UI Contract

Mod Hub 采用单页双态布局：
- 默认态：中心搜索 + `Open Mods Folder` + 已安装 Dock/Grid
- 聚焦态：展开 unified management list
- unified list 保留 `Installed` / `Available` 分组，并统一承载行内管理动作
- 本地 path / URL 安装入口不再出现在页面内；本地安装由用户通过 `Open Mods Folder` 手动复制完成
- 行内展示版本、trust tier、update、re-consent、warning、failed/conflict 信息

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
