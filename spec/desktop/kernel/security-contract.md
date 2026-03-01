# Security Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 安全模型契约。定义 CSP 策略、Keyring 管理、OAuth 安全、Bearer Token 处理、端点安全校验。

## D-SEC-001 — Endpoint 回环限制

本地运行时端点必须为回环地址：

- 允许：`localhost`、`127.0.0.1`、`[::1]`
- 错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`（`D-ERR-002`）

此规则防止本地 AI 推理流量意外路由到远程地址。

**安全深度说明**：Desktop renderer 层仅执行回环地址校验作为前端防线。完整的端点安全模型由 Runtime daemon 层执行（K-SEC-002~005），包括：HTTPS-only 默认策略、loopback 显式开关（`allow_loopback_provider_endpoint`）、高风险地址无条件拒绝（link-local `169.254.0.0/16`、私网 `fc00::/7`）、DNS 解析后 IP 重验证、TOCTOU pin 防护。两层协同保护确保本地端点安全。

## D-SEC-002 — Bearer Token 管理

- Token 存储在 Zustand store `auth.token` 字段。
- DataSync 热状态中保持 token 副本。
- Token 更新通过 `setToken()` 同步到所有消费者。
- Token 清除触发：logout、auth 失败、bootstrap 错误。

## D-SEC-003 — OAuth 安全

OAuth 流程通过 Tauri IPC 执行（参考 `D-IPC-006`）：

- 支持 PKCE：`codeVerifier` 参数。
- 支持 `clientSecret` 模式。
- Redirect URI 监听：`oauth_listen_for_code` 命令在本地端口监听回调。
- 超时：`timeoutMs` 参数防止无限等待。

## D-SEC-004 — IPC 桥接安全

- `hasTauriInvoke()` 检查 `window.__TAURI__` 存在性。
- 非 Tauri 环境抛出明确错误而非静默失败。
- 所有 IPC 调用通过统一入口 `invoke()` 执行，确保日志追踪覆盖。

## D-SEC-005 — Mod 能力沙箱

Mod 执行在能力沙箱内（参考 `D-HOOK-007`、`D-MOD-005`）：

- Source type 决定可用能力集。
- 未声明的能力调用被拒绝。
- `codegen` source type 使用最小权限原则。

## D-SEC-006 — 模型完整性校验

本地 AI 模型安装要求完整性验证：

- `manifest.hashes` 非空。
- 导入时执行 `LOCAL_AI_IMPORT_HASH_MISMATCH` 检查。
- 空哈希模型无法启动（`LOCAL_AI_MODEL_HASHES_EMPTY`）。

## D-SEC-007 — External Agent Token 安全

- Token 通过 `external_agent_issue_token` IPC 命令签发。
- Token 可通过 `external_agent_revoke_token` 吊销。
- Token 列表通过 `external_agent_list_tokens` 审计。
- Gateway 状态通过 `external_agent_gateway_status` 监控。

## D-SEC-008 — CSP 策略

Content Security Policy 约束：

- Tauri webview 默认启用 CSP，限制外部脚本和样式加载。
- `connect-src` 仅允许 realm API 域名和回环地址。
- `script-src` 禁止 `eval` 和 inline script（mod 通过沙箱 iframe 隔离）。
- Web 模式下依赖服务端 CSP header 而非 Tauri webview 策略。

## D-SEC-009 — Keyring 管理

凭证安全存储策略：

- Desktop 环境通过 Tauri backend keyring（OS 原生密钥链）存储敏感凭证。
- 凭证通过 `credentialRefId` 引用，运行时通过 `setRuntimeField('credentialRefId', value)` 绑定。
- LLM 请求自动注入绑定的凭证（参考 `D-LLM-003`）。
- Web 环境无 keyring 支持，凭证管理降级为服务端 token-based 方案。

## D-SEC-010 — Web 端 Token 存储安全

Web 环境 token 存储安全约束（参考 `D-AUTH-003`）：

- localStorage 存储的 token 必须设置合理的过期时间。
- 敏感页面（economy、auth）需在操作前重新验证 token 有效性。
- 禁止将 token 写入 cookie 以避免 CSRF 风险。
- logout 操作必须清除所有 localStorage 中的认证数据。

## Fact Sources

- `tables/error-codes.yaml` — 安全相关错误码（`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`）
- `tables/ipc-commands.yaml` — OAuth 和 External Agent IPC 命令
- `tables/hook-capability-allowlists.yaml` — Mod 能力沙箱白名单
