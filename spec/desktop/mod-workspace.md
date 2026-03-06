# Mod Workspace Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Mod 工作区功能域 — Mod workspace tabs、Mod UI 渲染、Mod 熔断与恢复。

## Module Map

- `mod-ui/` — Mod UI 扩展渲染引擎
- `features/mod-codegen/` — Mod codegen 入口
- `features/runtime-mod-panel/` — Runtime mod 管理面板
- `app-shell/providers/store-slices/mod-workspace-slice.ts` — Mod workspace store

## Kernel References

### State (D-STATE-003)

Mod workspace 状态：
- `modWorkspaceTabs: ModWorkspaceTab[]` — 活跃 mod tab 列表。
- 每个 tab：`tabId: 'mod:${modId}'`、`title`、`fused`（是否熔断）。
- 操作：`openModWorkspaceTab`、`closeModWorkspaceTab`。

### State (D-STATE-002)

Mod 运行时状态：
- `localManifestSummaries` — 本地 mod 清单摘要。
- `registeredRuntimeModIds` — 已注册 mod ID 列表。
- `runtimeModDisabledIds` / `runtimeModUninstalledIds` — 禁用/卸载 ID。
- `runtimeModSettingsById` — 每 mod 设置。
- `fusedRuntimeMods` — 熔断记录（reason、lastError、at）。
- `runtimeModFailures` — 注册失败记录。

### Shell (D-SHELL-002)

`enableModWorkspaceTabs` feature flag 控制 workspace tab 功能。

### Hook (D-HOOK-004)

Mod UI 通过以下槽位注入：
- `ui-extension.app.sidebar.mods` — sidebar mod 导航项。
- `ui-extension.app.content.routes` — 内容区 mod 路由。
- `ui-extension.runtime.devtools.panel` — 调试面板。

### Mod Governance (D-MOD-007)

Mod 生命周期操作：enable、disable、uninstall。
熔断机制：`markRuntimeModFused(modId, error, reason)` / `clearRuntimeModFuse(modId)`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 4, 6~8, 11, 13~14, 22 相关规则）。
