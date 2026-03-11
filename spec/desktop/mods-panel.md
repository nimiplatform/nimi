# Mods Panel Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Mods 面板 — 已安装 mod 的一等公民入口，替代原有侧边栏浮动下拉菜单，并内嵌 Marketplace 视图。

## Module Map

- `features/mods/mods-panel.tsx` — 组合入口（launcher / marketplace 视图切换）
- `features/mods/mods-panel-controller.ts` — launcher 业务逻辑（mod 列表、搜索、打开）
- `features/mods/mods-panel-view.tsx` — launcher 视图（icon grid、搜索框、空状态）

## Kernel References

### Shell (D-SHELL-001, D-SHELL-002)

Mods Tab 受 `enableModUi` feature flag 门控。侧边栏 puzzle icon 直接导航到 `activeTab = 'mods'`。

Guard clause：`enableModUi = false` 时访问 `'mods'` tab 自动回退到 `'chat'`。

### State (D-STATE-003, D-STATE-004)

Controller 从 AppStore 读取：
- `localManifestSummaries` — 本地已发现的 mod 清单
- `registeredRuntimeModIds` — 已注册的 mod ID 列表
- `runtimeModDisabledIds` — 已禁用的 mod ID 列表
- `runtimeModUninstalledIds` — 已卸载的 mod ID 列表
- `fusedRuntimeMods` — 已熔断（崩溃）的 mod 记录

计算派生状态：
- `enabledMods`：已安装 & 未卸载 & 未禁用 & 已注册
- `disabledMods`：已安装 & 未卸载 & (已禁用 | 未注册)

### Mod Governance (D-MOD-007)

Launcher 视图只负责：
- **Open** → `openModWorkspaceTab` + `setActiveTab('mod:${id}')`

Enable / Disable / Uninstall / Retry / Install 统一在内嵌 Marketplace 视图中处理。
Disable / Uninstall 当前激活的 mod 时，fallback 导航到 `'mods'`。

### Marketplace (内嵌关系)

Mods Panel 既是 launcher，也是 Marketplace 容器：
- Launcher 视图显示已启用 mod 的 icon grid。
- Marketplace 视图负责 mod 发现、安装、启用、禁用、卸载。
- 空状态和 header 按钮都切换到内嵌 Marketplace 视图，而不是进入第二个独立导航入口。

## UI Contract

Launcher 视图采用轻量 icon launcher 布局：
- tile：icon + name
- hover tooltip：简介；dev mod 额外标记开发来源
- 管理动作与版本信息不在 launcher 视图展示

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
