# Security Contract

> Authority: Desktop Kernel

## Scope

Desktop 安全模型契约。定义 CSP 策略、AI 凭据委托、OAuth 安全、Bearer Token 处理、端点安全校验。

## D-SEC-001 — Endpoint 回环限制

本地运行时端点必须为回环地址：

- 允许：`localhost`、`127.0.0.1`、`[::1]`
- 错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`（`D-ERR-002`）

此规则防止本地 AI 推理流量意外路由到远程地址。

**安全深度说明**：Desktop renderer 层仅执行回环地址校验作为前端防线。完整的端点安全模型由 Runtime daemon 层执行（K-SEC-002~005），包括：HTTPS-only 默认策略、loopback 显式开关（`allow_loopback_provider_endpoint`）、高风险地址无条件拒绝（link-local `169.254.0.0/16`、私网 `fc00::/7`）、DNS 解析后 IP 重验证、TOCTOU pin 防护。两层协同保护确保本地端点安全。

## D-SEC-002 — Bearer Token 管理

- Token 存储在 Zustand store `auth.token` 字段。
- DataSync 热状态中保持 token 副本，但该热状态仅用于进程内 / HMR 连续性，不是长期持久化真源。
- Desktop 长期持久化层固定为 `~/.nimi/auth/session.v1.json`，其中 accessToken / refreshToken 只允许以 ciphertext 形式落盘。
- 加密密钥必须存放在 OS secure store（共享 service/account，versioned）。
- session 文件写入必须原子替换；平台支持时要求 owner-only 权限。
- secure-store 读取失败、ciphertext 解密失败、schema 校验失败时必须 fail-close，不得回退到明文或猜测恢复。
- Token 更新通过 `setToken()` 同步到所有消费者。
- Token 清除触发：logout、auth 失败、bootstrap 错误。

## D-SEC-003 — OAuth 安全

OAuth 流程通过 Tauri IPC 执行（参考 `D-IPC-006`）：

- 支持 PKCE：`codeVerifier` 参数。
- 支持 `clientSecret` 模式。
- Redirect URI 监听：`oauth_listen_for_code` 命令在本地端口监听回调。
- 超时：`timeoutMs` 参数防止无限等待。

## D-SEC-004 — IPC 桥接安全

- `hasTauriInvoke()` 检查 Tauri runtime presence（`__TAURI_INTERNALS__` / `__TAURI_IPC__` 或等价的显式 bridge 环境），不得要求 `window.__TAURI__` 全局暴露。
- 非 Tauri 环境抛出明确错误而非静默失败。
- 所有 IPC 调用通过统一入口 `invoke()` 执行，确保日志追踪覆盖。

## D-SEC-005 — Mod 能力沙箱

Mod 执行在能力沙箱内（参考 `D-HOOK-008`、`D-MOD-005`）：

- Source type 决定可用能力集。
- 未声明的能力调用被拒绝。
- `codegen` source type 使用最小权限原则。

## D-SEC-006 — 模型完整性校验

本地 AI 模型安装区分 verified 与 local-unverified 两类完整性语义：

- verified 安装路径（catalog / verified / 带 expected hashes 的 manifest）要求 `manifest.hashes` 非空，并在导入时执行 `LOCAL_AI_IMPORT_HASH_MISMATCH` 检查。
- 手工本地文件导入与 orphan scaffold 归类为 `local_unverified`，允许 `manifest.hashes` 为空；它表示用户确认信任的本地文件，而不是 provenance-verified 来源。
- 只有 verified 模型会因空哈希在启动前被 `LOCAL_AI_MODEL_HASHES_EMPTY` 拦截；`local_unverified` 不受该门槛阻塞。

**跨层引用**：Runtime `K-RPC-004` / `K-LOCAL-009` / `K-LOCAL-028` 是本地模型 import/install/transfer/lifecycle 的权威控制面。Desktop D-SEC-006 只定义前端 UX 安全边界，不得把 host-local 状态当成安装成功、下载完成或可启动的真相源。

**信任边界声明**：Desktop D-SEC-006 的 hash 校验只覆盖 verified 来源，防止用户通过 Desktop UI 启动宣称已验证但缺乏完整性证明的模型。`local_unverified` 是用户显式确认的本地导入信任边界，Desktop 会保留“未进行来源验证”的 provenance 标识，但不会追加同步 SHA256 阻塞启动。Runtime 仍然是格式/引擎校验、transfer 失败语义与健康判定的权威层。

## D-SEC-007 — External Agent Token 安全

- Token 通过 `external_agent_issue_token` IPC 命令签发。
- Token 可通过 `external_agent_revoke_token` 吊销。
- Token 列表通过 `external_agent_list_tokens` 审计。
- Gateway 状态通过 `external_agent_gateway_status` 监控。

**跨层引用**：Runtime K-AUTHSVC-006 定义 External Principal 注册与开会话的验证规则（`proof_type` + `signature_key_id` 一致性校验）。Runtime K-GRANT-003 定义 token 权限模型。Desktop 层 token 签发/吊销通过 Tauri backend 桥接到 Runtime 层执行，Desktop 不直接处理 token 验证逻辑。

## D-SEC-008 — CSP 策略

Content Security Policy 约束：

- Tauri webview 默认启用 CSP，限制外部脚本和样式加载。
- `connect-src` 仅允许 realm API 域名和回环地址。
- `script-src` 禁止 `eval` 和 inline script（mod 通过沙箱 iframe 隔离）。
- Web 模式下依赖服务端 CSP header 而非 Tauri webview 策略。

## D-SEC-009 — AI 凭据委托模型

AI provider 凭据（API key）的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor，定义于 spec/runtime/connector.md）：

- Desktop renderer **不接触**原始 API key。用户通过 UI 输入凭据后，Desktop 调用 SDK `CreateConnector` / `UpdateConnector`（K-RPC-007/008）将凭据写入 Runtime，写入后即刻丢弃内存副本。
- AI 请求通过 `connector_id`（managed 路径，K-KEYSRC-001）路由到 Runtime，Runtime 在执行上下文中解密注入凭据（K-KEYSRC-004 step 6），下游不直接访问 CredentialStore。
- Realm access token（非 AI 凭据）仍由 `D-AUTH-002` / `D-AUTH-003` 管理，与 ConnectorService 无关。
- Desktop / Web 统一使用 SDK ConnectorService 接口，无平台差异。

**跨层引用**：K-CONN-001、K-RPC-003、K-RPC-007~009、K-KEYSRC-001/004。

## D-SEC-010 — Web 端 Token 存储安全

Web 环境 session 存储安全约束（参考 `D-AUTH-003`）：

- localStorage 不得持久化 raw access token 或 raw refresh token；浏览器持久化层只允许保存非敏感会话元数据并设置合理过期时间。
- 敏感页面（economy、auth）需在操作前重新验证 token 有效性。
- 禁止将 token 写入 cookie 以避免 CSRF 风险。
- logout 操作必须清除所有 localStorage 中的认证数据。

## D-SEC-011 — Error Message Credential Scrubbing

Bridge 错误归一化（D-ERR-005）必须在消息暴露到 UI 或日志前检测并脱敏凭据模式。

**检测模式**：
- HTTP header: `x-nimi-provider-api-key`
- 字段名 (snake_case): `provider_api_key`
- JSON key (camelCase): `"providerApiKey"`

**脱敏格式**: 所有匹配替换为 `[REDACTED_PROVIDER_API_KEY]`。

**作用域**: 同时应用于 `message` 和 `details.rawMessage` 字段。凭据安全优先于 D-ERR-005 的 raw 信息保留原则。

**扩展要求**: 当 Runtime proto 或 connector config 新增凭据字段时，须同步注册检测模式到 Bridge scrubbing 函数并更新此规则。

## D-SEC-012 — External Agent Token 状态机

External Agent token 遵循严格生命周期: **issued → valid → expired | revoked**。

- **Token ID**: `principal_id:subject_account_id:mode:nonce` 的 SHA256 哈希，确保确定性去重。
- **TTL 边界**: 钳位到 `[60, 86400]` 秒（1 分钟至 24 小时），超出范围静默钳位。
- **吊销机制**: 双层持久化 — SQLite DB 写入 `revoked_at` + 内存 `revoked_token_ids` HashSet。两层必须一致才视为有效。
- **验证级联**: JWT 签名 → DB 查找 → `revoked_at` 检查 → claims 匹配 → TTL 检查 → 内存吊销检查。任一步骤失败即短路。

## D-SEC-013 — External Agent Scope 绑定模型

Token scope 将 action ID 绑定到允许的操作阶段。

- **Ops 枚举**: `discover`, `dry-run`, `verify`, `commit`, `audit`, `events`。通配符 `*` 允许所有 ops。
- **Action ID 通配符**: `*` 匹配任意 action。
- **默认 scope 生成**: 签发 token 时未指定 scopes，则为所有已注册 action 生成全 ops 权限。
- **阶段强制执行**: `claims_allows_action_for_phase(claims, action_id, phase)` 必须找到匹配的 scope 条目（action_id 匹配或通配符 AND phase 在 ops 列表中或 ops 通配符）。
- **无 scope 提升**: Token 不可获得超出签发时授予的权限。

## D-SEC-014 — External Agent 执行上下文验证

向 renderer 发送 action 请求前，Bridge 必须验证执行上下文：

1. `execution_id` 存在且非空
2. Token 在 DB 中存在且未吊销
3. Token 未过期（TTL 检查）
4. Claims 与 DB 记录匹配: `principal_id`, `subject_account_id`, `mode`, `issuer`
5. Token 不在内存吊销列表中
6. 执行在 completion waiters 中待处理
7. 执行所有者匹配: `principal_id` 和 `auth_token_id`

任一步骤失败返回 `false`，不提供诊断详情（防止信息泄露）。

## Fact Sources

- `tables/error-codes.yaml` — 安全相关错误码（`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`）
- `tables/ipc-commands.yaml` — OAuth 和 External Agent IPC 命令
- `tables/hook-capability-allowlists.yaml` — Mod 能力沙箱白名单
