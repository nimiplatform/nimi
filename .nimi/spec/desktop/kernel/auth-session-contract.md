# Auth Session Contract

> Authority: Desktop Kernel
>
> **Hard Cut Status (topic `2026-04-28-runtime-core-account-session-broker-hardcut` wave-1)**：
> Desktop 不再拥有 local first-party 机器层 account session truth、token custody、refresh、logout、user-switch 权威。该权威由 `RuntimeAccountService`（`K-ACCSVC-*`，见 `.nimi/spec/runtime/kernel/account-session-contract.md`）拥有。本契约下列规则在 wave-1 被显式标记：
>
> | Rule | Disposition | Replacement Authority |
> |---|---|---|
> | `D-AUTH-001` | superseded | `K-ACCSVC-003`/`K-ACCSVC-005` Runtime account status query；Desktop 启动只 query Runtime account state |
> | `D-AUTH-002` | superseded | `K-ACCSVC-007` Runtime secure custody；Desktop 不持有 durable token 真源 |
> | `D-AUTH-006` | superseded | `K-ACCSVC-004` Runtime reactive refresh；Desktop 不再拥有 reactive refresh owner |
> | `D-AUTH-007` | superseded | `K-ACCSVC-004` Runtime proactive refresh；Desktop 不再拥有 refresh 计时器 |
> | `D-AUTH-008` | superseded | `K-ACCSVC-007` Runtime refresh-token custody；Desktop 永远不存储 refresh token |
> | `D-AUTH-009` | superseded | `K-ACCSVC-004`/`K-ACCSVC-010` Runtime token expiration / refresh / remote revocation owner |
> | `D-AUTH-013` | superseded | `K-ACCSVC-009` Runtime-owned login route decision；Desktop 仅执行 UX 指令 |
> | `D-AUTH-014` | superseded | `K-BIND-006` scoped binding stale-request rejection；Runtime 拥有 revalidation 真相 |
> | `D-AUTH-010` / `D-AUTH-011` / `D-AUTH-012` | retained | external-principal UI 仍由 Desktop 拥有，与 account session 分离 |
>
> Desktop 在 wave-3 之后可以保留 direct Realm data calls，但只能通过 Runtime-backed short-lived access-token provider；Desktop 不得持有 refresh token、durable session、或 app-owned login truth。
>
> wave-1 仅标记 disposition；实际 active owner switch 与代码删除属于 wave-3 闭合一次性 hard cut（见 `K-ACCSVC-013`）。

## Scope

Desktop 认证会话生命周期契约。定义 desktop 和 web 两种环境下的 token 获取、持久化、刷新和失效策略。

> **wave-1 Authority Note**：在 wave-3 active owner switch 之前，本契约现有规则保留为 superseded-pending-cut 状态，仅供历史参照；wave-3 必须在同一 wave 内删除或 hard-block 这些规则对应的 product code 路径，且不得保留 dual-read / fallback。

## D-AUTH-001 — Session Bootstrap

`bootstrapAuthSession` 在启动序列中执行（`D-BOOT-007`）。

- Desktop 冷启动解析顺序固定为：
  - `runtime_defaults.realm.accessToken` 若存在，则仅作为本次运行的显式 override。
  - 否则调用共享 Tauri IPC `auth_session_load` 读取 `~/.nimi/auth/session.v1.json`。
  - 两者都缺失时进入匿名启动。
- 输入：`flowId`（追踪 ID）、resolved bootstrap session（`accessToken`、`refreshToken?`、source=`env|persisted|anonymous`）。
- 成功时：设置 `auth.status = 'authenticated'`、存储 token。
- 失败时：设置 `auth.status = 'anonymous'`、清除 token；若 source=`persisted` 且为 401 / decrypt / schema 失败，则必须调用 `auth_session_clear` 清空共享持久会话。

## D-AUTH-002 — Token 持久化（Desktop）

Desktop 环境的长期会话真源是共享 Tauri backend auth session 存储：

- 路径：`~/.nimi/auth/session.v1.json`。
- 记录：`schemaVersion`、`realmBaseUrl`、`user`、`updatedAt`、`expiresAt`、`accessTokenCiphertext`、`refreshTokenCiphertext?`。
- 获取：renderer 只通过 `auth_session_load` 读取已解密的 normalized session；`runtime_defaults` 不作为 bearer token 的长期持久化渠道。
- 更新：登录成功、2FA 完成、OTP 完成、wallet 登录成功、SDK `onTokenRefreshed`、DataSync proactive refresh 成功后，必须立即调用 `auth_session_save` 原子覆盖整个会话。
- 清除：logout、refresh 失败、bootstrap unauthorized、schema/decrypt 失败时必须调用 `auth_session_clear`。
- `DataSyncHotState` 与 Zustand store 只是进程内 / HMR 缓存，不是 desktop 长期持久化真源。

当前 first-party local consumer posture 额外固定为：

- shared desktop auth session 也是本机 authenticated consumer 的 durable auth truth。
- local consumer 不得把启动时拿到的 access token 视为独立 durable truth。
- 正在运行的 local consumer 若发现 shared session 被清除、schema/decrypt 失效、realm 不匹配、或切换到不同 user，必须立即对 authenticated capability fail closed。
- `apps/avatar` 不属于 shared desktop auth session consumer。Avatar 是本地 visual embodiment surface + runtime IPC consumer；它不得读取 shared auth session、持有 Realm token、创建 Realm client、或把 user/session truth 存在 avatar-local state。
- Avatar 的 runtime interaction binding 由 Desktop/Runtime 拥有，并受 `K-APP-010` / `D-LLM-072` 约束；runtime binding 不可用只关闭 interaction/voice/activity consume，不得隐藏已加载的 local visual carrier。

## D-AUTH-003 — Token 持久化（Web）

Web 环境只通过浏览器存储持久化非敏感会话元数据：

- 获取：从 localStorage 读取用户投影与过期元数据；raw access token 不从浏览器持久化存储恢复。
- 更新：仅写入 user/expiresAt/updatedAt 等非敏感字段。
- 清除：删除 localStorage 条目。

## D-AUTH-004 — Auth 状态机

```
bootstrapping → authenticated  (token 有效)
bootstrapping → anonymous      (token 无效或缺失)
authenticated → anonymous      (logout 或 token 过期)
anonymous     → authenticated  (login 成功)
```

**跨层映射**：

| Desktop 状态 | Realm SDK 行为 | Runtime 层关系 |
|---|---|---|
| `bootstrapping` | Realm SDK `connect()` / token 获取 | Runtime 无活跃请求（Desktop 尚未开始调用） |
| `authenticated` | Realm SDK session active，维护 `auth.accessToken` 最新值 | Runtime SDK 调用时自动注入 `Authorization: Bearer <realm_access_token>`，Runtime K-AUTHN-001~008 验证请求合法性 |
| `anonymous` | Realm SDK 无 token，仅公开 API 可用 | Runtime 拒绝需认证的 RPC（`UNAUTHENTICATED`） |

**Desktop 与 RuntimeAuthService 的关系**：

Desktop **不直接使用** RuntimeAuthService（K-AUTHSVC-001~013）的 `OpenSession` / `RefreshSession` / `RevokeSession`。Desktop 认证 token 来自 Realm 后端（通过 Realm SDK REST 调用获取），而非 Runtime daemon 的 session 管理。RuntimeAuthService 的 session 管理面向以下场景：

- 外部 Agent 通过 SDK 建立 Runtime session（K-AUTHSVC-006、RegisterExternalPrincipal）
- 独立 SDK 消费者（非 Desktop）直接与 Runtime 交互

Runtime 对 Desktop 请求的认证路径：Desktop 持有 Realm SDK session token → Runtime SDK 在每次调用前读取最新 token 并注入 `Authorization: Bearer <realm_access_token>` → Runtime gRPC metadata `authorization` → K-AUTHN-001~008 token 验证拦截器。此 token 由 Realm 后端签发，Runtime 仅做 claims 校验，不管理其生命周期。

**AppMode 声明**（K-AUTHSVC-009）：Desktop 使用 `AppMode=FULL`、`WorldRelation=RENDER` 注册（K-AUTHSVC-010）。`FULL` 模式允许同时访问 `runtime.*` 和 `realm.*` 域。若注册时使用错误的 AppMode，Runtime 返回 `APP_MODE_DOMAIN_FORBIDDEN`（D-ERR-007 映射表兜底处理）。

**RegisterApp 调用路径**：Desktop 通过 SDK Runtime client 在 bootstrap 阶段（D-BOOT-004）调用 `RegisterApp(appMode=FULL, worldRelation=RENDER)`（K-AUTHSVC-010）。此调用属于 Runtime SDK 高阶方法透传，不等同于 Desktop 直接使用 RuntimeAuthService 的 session 管理方法（OpenSession/RefreshSession/RevokeSession）。

- **调用时机**：D-BOOT-004 Runtime Host Assembly 完成 gRPC 连接后、D-BOOT-007 Auth Session 引导前。
- **失败处理**：进入 D-BOOT-008 错误路径，`bootstrapReady=false`。
- **参数来源**：`appMode` 和 `worldRelation` 由 Desktop 编译时确定（非用户配置）。

## D-AUTH-005 — Auth 事件联动

DataSync 监听 `authChange` 事件：

- `isAuthenticated = true`：调用 `setToken(auth.token)`。
- `isAuthenticated = false`：清空 token，停止所有轮询。

## D-AUTH-006 — Token 刷新: Reactive

Desktop 配置 SDK 的 `auth.refreshToken` + `auth.onTokenRefreshed` + `auth.onRefreshFailed` 回调：

- SDK 收到 401 时自动尝试 `POST {baseUrl}/api/auth/refresh`（S-REALM-028）。
- `onTokenRefreshed`：更新 DataSync 的 `accessToken`/`refreshToken`、写入热状态、同步 Store、重新调度主动刷新计时器，并立即覆写共享 `~/.nimi/auth/session.v1.json` 会话。
- `onRefreshFailed`：清空 auth 状态（`store.clearAuth()`）、停止所有轮询、清除主动刷新计时器、清除共享 auth session，用户状态转 anonymous。

## D-AUTH-007 — Token 刷新: Proactive

过期前 60 秒计时器触发主动刷新：

- 使用 `Realm.decodeTokenExpiry(jwt)` 计算 token 过期时间。
- 在 `expiresInMs - 60000` 时调度 `setTimeout`。
- 登录成功 / `onTokenRefreshed` 回调 / `authChange` 事件后重新调度计时器。
- logout / clearAuth 时清除计时器。

## D-AUTH-008 — refreshToken 持久化

refreshToken 与 accessToken 对等持久化：

- 共享 desktop auth session 文件（`~/.nimi/auth/session.v1.json`）：加密持久化，是唯一长期真源。
- 热状态（`DataSyncHotState.refreshToken`）：跨 HMR 保活，但不是 durable source。
- Store（`AuthState.refreshToken`）：进程内态，不得作为长期持久化层。
- 登录 / 注册成功后立即存储 `result.tokens.refreshToken`。
- logout / clearAuth 清除。

## D-AUTH-009 — Token 过期检测与刷新所有权

Desktop token 过期检测与刷新采用双重机制：

**主动检测**（D-AUTH-007）：Desktop 计算 token 剩余有效期，在过期前 60s 触发主动刷新。此为主要的过期防护机制。

**被动检测**（D-AUTH-006）：当主动刷新失败或计时器偏差导致 token 已过期时，Realm SDK 收到 401 后触发 S-REALM-028 单次刷新重试。此为兜底机制。

**所有权链**：

| 层 | 职责 | 实现位置 |
|---|---|---|
| Desktop | 过期计时调度、刷新回调处理、auth 状态迁移 | D-AUTH-006、D-AUTH-007 |
| Realm SDK | 401 检测、refresh endpoint 调用、single-flight 协调 | S-REALM-028、S-REALM-029 |
| Realm Backend | token 签发、刷新、校验 | 不在 spec 管辖范围 |
| Runtime | 仅做 token claims 校验（K-AUTHN-001~008），不参与 token 生命周期管理 | K-AUTHN-001~008 |

**S-REALM-014 默认策略决策**：Desktop 使用 caller-manual 策略（S-REALM-027 function 模式 + S-REALM-028 refreshToken 回调），而非 SDK 内置 auto-refresh。此选择使 Desktop 能控制 token 持久化和 auth 状态迁移的时序。

## D-AUTH-010 — ExternalPrincipal Token UI Flow

Desktop 对 ExternalPrincipal 的 UI 投影固定在 Runtime Config 的 External Agent Access 面板：

- 首屏必须先读取 gateway status 与已签发 token ledger。
- `Issue Token` 表单固定字段为 `principalId`、`subjectAccountId`、`mode`、`actions`、`ttlSeconds`。
- 明文 token 只允许在签发成功后的当前会话内展示一次；后续列表页只保留 `tokenId`、`principalId`、`mode`、`subjectAccountId`、过期状态与 revoke 能力。
- gateway 不可用时，签发与吊销操作必须禁用，并向用户展示可读错误。

## D-AUTH-011 — ExternalPrincipal Token State & Revocation

- token ledger 的 single source of truth 为 Tauri gateway 状态；Desktop 前端不持久化明文 token。
- `Refresh` 必须重新从 gateway 拉取状态与 token ledger，不得依赖本地缓存推断 token 状态。
- `Revoke` 成功后，若当前面板仍持有同一 token 的明文显示，必须立即清空。
- 过期 token 与 revoked token 都保留在 UI ledger 中，但状态必须显式区分为 `expired` / `revoked`。

## D-AUTH-012 — External Agent 吊销与审计

- **吊销 token 保持可见**: 吊销后 token 保留在 ledger 中，`revoked_at` 时间戳已设置。不删除记录。
- **审计主体隔离**: 审计查询 (`/audit` endpoint) 按请求方 `principal_id` 过滤。Agent 无法查询其他 principal 的审计记录。
- **审计事件来源**: 审计记录源自 runtime audit store，过滤条件 `stage = "audit"` + `event_type = "hook.action.commit"`。
- **审计保留策略**: 受 runtime audit ring buffer 配置 (`cfg.AuditRingBufferSize`) 约束；external agent audit 无独立保留策略。

## D-AUTH-013 — Email Entry Route Typed Decision

anonymous 状态下 desktop 可调用 `Realm.AuthService.checkEmail` 获取类型化登录路由（S-REALM-038）。

- 返回 `CheckEmailEntryRoute` 三值判定：`register_with_otp`、`login_with_otp`、`login_with_password`。
- Desktop 根据判定结果路由到对应的注册/OTP/密码登录表单。
- 此调用不需要 accessToken，属于 S-REALM-038 允许的公开决策端点。

## D-AUTH-014 — Local Consumer Revalidation

共享 auth session 作为 local durable truth 时，运行中的 authenticated consumer 必须持续重读或等价 revalidate 该 truth，而不允许只在 bootstrap 时读取一次。

- revalidation 至少要能覆盖：desktop logout、`auth_session_clear`、persisted session schema/decrypt failure、realm mismatch、user switch、same-user token rotation。
- same-user token rotation 允许仅更新 consumer 进程内 token / user projection，不要求重开 handoff 或发明 per-app token grant。
- clear / invalid / mismatch / user switch 必须显式把 consumer 迁移到 fail-closed 状态；不得等待下次重启或偶发 401 才发现本地 durable truth 已失效。
- 该规则不适用于 `apps/avatar`。Avatar 的 replacement posture 是 runtime binding revalidation：Desktop/Runtime 持有 auth、Realm、subject、agent、anchor truth，Avatar 只消费 explicit launch context、本地 visual package、以及 runtime IPC projections。

## Fact Sources

- `tables/bootstrap-phases.yaml` — Auth session 阶段
- `tables/store-slices.yaml` — Auth slice 定义
