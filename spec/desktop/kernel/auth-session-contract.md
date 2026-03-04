# Auth Session Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 认证会话生命周期契约。定义 desktop 和 web 两种环境下的 token 获取、持久化、刷新和失效策略。

## D-AUTH-001 — Session Bootstrap

`bootstrapAuthSession` 在启动序列中执行（`D-BOOT-007`）。

- 输入：`flowId`（追踪 ID）、`accessToken`（来自 runtime defaults）。
- 成功时：设置 `auth.status = 'authenticated'`、存储 token。
- 失败时：设置 `auth.status = 'anonymous'`、清除 token。

## D-AUTH-002 — Token 持久化（Desktop）

Desktop 环境通过 Tauri backend 持久化 token：

- 获取：`runtime_defaults` IPC 命令返回 `realm.accessToken`。
- 更新：DataSync facade 的 `setToken()` 同步到热状态和 Zustand store。
- 清除：`clearAuthSession()` 清空 store 并停止所有轮询。

## D-AUTH-003 — Token 持久化（Web）

Web 环境通过浏览器存储持久化 token：

- 获取：从 localStorage 读取（禁止使用 cookie 存储 token，参考 `D-SEC-010`）。
- 更新：写入 localStorage。
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
- `onTokenRefreshed`：更新 DataSync 的 `accessToken`/`refreshToken`、写入热状态、同步 Store、重新调度主动刷新计时器。
- `onRefreshFailed`：清空 auth 状态（`store.clearAuth()`）、停止所有轮询、清除主动刷新计时器，用户状态转 anonymous。

## D-AUTH-007 — Token 刷新: Proactive

过期前 60 秒计时器触发主动刷新：

- 使用 `Realm.decodeTokenExpiry(jwt)` 计算 token 过期时间。
- 在 `expiresInMs - 60000` 时调度 `setTimeout`。
- 登录成功 / `onTokenRefreshed` 回调 / `authChange` 事件后重新调度计时器。
- logout / clearAuth 时清除计时器。

## D-AUTH-008 — refreshToken 持久化

refreshToken 与 accessToken 对等持久化：

- 热状态（`DataSyncHotState.refreshToken`）：跨 HMR 保活。
- Store（`AuthState.refreshToken`）：写入 localStorage 持久化。
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

## Fact Sources

- `tables/bootstrap-phases.yaml` — Auth session 阶段
- `tables/store-slices.yaml` — Auth slice 定义
