# Mods Panel Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Mods 管理面板 — 已安装 mod 的一等公民入口，替代原有侧边栏浮动下拉菜单。

## Module Map

- `features/mods/mods-panel.tsx` — 组合入口（controller → view）
- `features/mods/mods-panel-controller.ts` — 业务逻辑（mod 列表、搜索、操作）
- `features/mods/mods-panel-view.tsx` — 视图（卡片网格、搜索框、空状态）

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

操作映射到 mod lifecycle 状态迁移：
- **Open** → `openModWorkspaceTab` + `setActiveTab('mod:${id}')`
- **Enable** → 从 disabled → ENABLED（重新注册 + 清除 fuse）
- **Disable** → ENABLED → DISABLED（取消注册 + 关闭 tab）
- **Uninstall** → ENABLED/DISABLED → UNINSTALLED（取消注册 + 移除）
- **Retry** → FUSED → 清除 fuse + 重新注册

Disable / Uninstall 当前激活的 mod 时，fallback 导航到 `'mods'`（而非 `'marketplace'`）。

### Marketplace (互补关系)

Mods Panel 管理已安装 mod。Marketplace 负责 mod 发现/安装。
- Mods Panel 空状态提供 "打开市场" 按钮跳转到 Marketplace。
- Marketplace 中 disable/uninstall 当前 mod 也 fallback 到 `'mods'`。

## UI Contract

布局采用 World Panel 同款风格：
- 背景：`bg-[#F0F4F8]`
- 卡片：`rounded-2xl border-white/60 bg-white/40 backdrop-blur-xl`
- 搜索框：`rounded-full bg-white max-w-md`
- 网格：`sm:grid-cols-2 lg:grid-cols-3`

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
