# Web Adapter Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

Web 适配器功能域 — Web 环境下的 shell 降级策略、feature flag 差异、存储适配。

## Module Map

- `apps/web/` — Web 适配器入口
- `apps/_libs/shell-core/src/shell-mode.ts` — Shell 模式检测与 feature flags

## Kernel References

### Shell (D-SHELL-001)

Web 模式下以下 Tab 不可见：
- `runtime`（`enableRuntimeTab = false`）
- `marketplace`（`enableMarketplaceTab = false`）

### Shell (D-SHELL-002)

Web 模式下以下功能禁用：
- `enableModUi = false` — Mod UI 渲染
- `enableModWorkspaceTabs = false` — Mod workspace tabs
- `enableSettingsExtensions = false` — Settings 扩展区域

### Shell (D-SHELL-003)

Web 模式下窗口管理禁用：
- `enableTitlebarDrag = false`

### Bootstrap (D-BOOT-004)

Web 模式下 `enableRuntimeBootstrap = false`：
- 跳过 runtime host 装配。
- 跳过 mod 注册。
- 跳过 external agent 桥接。
- 设置空的 manifest summaries 和 mod IDs。

### Auth (D-AUTH-003)

Web 模式 token 存储使用 localStorage 而非 Tauri backend。

### IPC (D-IPC-009)

Web 模式下 `hasTauriInvoke()` 返回 `false`，所有 IPC 命令不可用。

**Fetch 替代策略**：Web 模式使用浏览器原生 `fetch()` 替代 `createProxyFetch()`（`D-NET-004`）。Realm backend 必须配置正确的 CORS 头（`Access-Control-Allow-Origin`）以支持跨域请求。DataSync 在 `initApi()` 时根据 shell 模式选择 fetch 实现。

### Shell Mode Detection (D-SHELL-008)

Shell 模式检测规则（检测优先级见 `D-SHELL-008`）。
