# Web Adapter Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

Web 适配器功能域 — Web 环境下的 shell 降级策略、feature flag 差异、存储适配。

## Module Map

- `apps/web/` — Web 适配器入口
- `kit/core/src/shell-mode.ts` — Shell 模式检测与 feature flags

## Kernel References

### Shell (D-SHELL-001)

Web 模式下以下 Tab 不可见：
- `runtime`（`enableRuntimeTab = false`）
- `mods`（`enableModUi = false`）

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

- 自动登录优先使用 localStorage 中的持久化 access token；为空时才回退到 `getRuntimeDefaults()` 返回的 `realm.accessToken`。
- 自动登录失败或超时会回落到匿名态，但不将 bootstrap 判定为失败。

### IPC (D-IPC-009)

Web 模式下 `hasTauriInvoke()` 返回 `false`，所有 IPC 命令不可用。desktop-only self-update / release metadata surface 必须 fail-close 到明确 unsupported error，约束以 `D-IPC-009` 与 `self-update-contract.md` 为准。

**Fetch 替代策略**：Web 模式仍复用 `createProxyFetch()` 作为统一 HTTP 适配器（`D-NET-004`），但 `desktopBridge.proxyHttp()` 在 `hasTauriInvoke() = false` 时会直接 fallback 到浏览器原生 `fetch()`。因此 Web 不经过 Tauri IPC，也不具备 Desktop 的 CORS 绕过能力；Realm 部署必须提供同源路由或正确的 CORS 头。

### Web Bootstrap 序列 (D-BOOT-001~012 投影)

Web bootstrap 是 Desktop bootstrap 的受限投影：

- 保留：`D-BOOT-002`、`D-BOOT-003`、`D-BOOT-007`、`D-BOOT-008`、`D-BOOT-009`、`D-BOOT-010`、`D-BOOT-012`
- 替换：`D-BOOT-001` 在 Web 以浏览器 origin 和构建时配置取代 `runtime_defaults`
- 跳过：`D-BOOT-004`、`D-BOOT-005`、`D-BOOT-006`

**Web 特有约束**：
- 无 SSR 支持——bootstrap 仅在客户端执行。
- 无 service worker 缓存——所有请求直接发出。
- `realmBaseUrl` 在 Web 模式固定为浏览器同源 origin，不读取 `NIMI_REALM_URL` 覆盖远端 API 基址。
- Auth 流差异：Web 使用浏览器 redirect OAuth（非 Tauri deep link），token 存储在 localStorage（非 Tauri secure storage）。

### Shell Mode Detection (D-SHELL-008)

Shell 模式检测规则（检测优先级见 `D-SHELL-008`）。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
