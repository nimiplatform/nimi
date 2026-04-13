# Auth Domain Spec

> Normative Imports: `.nimi/spec/desktop/kernel/*`

## Scope

认证/登录功能域 — 登录、注册、登出、会话引导。

## Module Map

- `features/auth/` — 认证页面（登录/注册表单）
- `runtime/data-sync/flows/auth-flow.ts` — 认证数据流

## Kernel References

### Auth (D-AUTH-001)

Session bootstrap 在启动序列中执行，从 runtime defaults 获取 token 并设置认证状态。

### Auth (D-AUTH-002)

Desktop 环境通过 Tauri backend IPC 持久化 token。

### Auth (D-AUTH-003)

Web 环境只通过 localStorage 持久化非敏感会话元数据；raw access token 不落浏览器持久化存储。

### Auth (D-AUTH-004)

认证状态机：`bootstrapping` → `authenticated` / `anonymous`，支持 login/logout 转换。

### Auth (D-AUTH-005)

DataSync 监听 `authChange` 事件，联动 token 更新和轮询控制。

### DataSync (D-DSYNC-001)

认证数据流（方法清单见 `D-DSYNC-001`）。

### IPC (D-IPC-006)

OAuth 命令：`oauth_token_exchange`（交换 authorization code）、`oauth_listen_for_code`（监听 redirect URI 回调）。

### Security (D-SEC-003)

OAuth 安全：支持 PKCE 和 clientSecret 两种模式，通过 Tauri IPC 执行。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`。
