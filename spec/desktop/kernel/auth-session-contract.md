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

| Desktop 状态 | SDK 层行为 | Runtime 层对应 |
|---|---|---|
| `bootstrapping` | SDK 连接初始化 / `OpenSession` | K-AUTHSVC `session.create` |
| `authenticated` | SDK session active，token 注入请求 | K-AUTHSVC session 有效期内 |
| `anonymous` | SDK 无 session，仅公开 API 可用 | K-AUTHSVC 无活跃 session |

Desktop auth 状态迁移不直接调用 Runtime session API；token 获取和刷新通过 Realm SDK 完成，Runtime 通过 metadata 中的 token 间接验证会话有效性。

## D-AUTH-005 — Auth 事件联动

DataSync 监听 `authChange` 事件：

- `isAuthenticated = true`：调用 `setToken(auth.token)`。
- `isAuthenticated = false`：清空 token，停止所有轮询。

## Fact Sources

- `tables/bootstrap-phases.yaml` — Auth session 阶段
- `tables/store-slices.yaml` — Auth slice 定义
