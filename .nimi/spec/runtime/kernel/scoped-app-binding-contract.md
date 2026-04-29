# Scoped App Binding Contract

> Owner Domain: `K-BIND-*`

## K-BIND-001 服务职责与归属

scoped app binding 是 Runtime-issued 的 opaque capability，指向一个具体的 app / agent / window / anchor relation。它由 `RuntimeAccountService.IssueScopedAppBinding` 与 `RevokeScopedAppBinding` 拥有（见 `account-session-contract.md` `K-ACCSVC-002`）。

scoped binding 不是 account truth，不可被赎回为 durable subject、account、Realm token、refresh token、或 Runtime app session 权威。

Runtime-issued app access token 是 `RuntimeAccountService.GetAccessToken`
管理的独立 account-token-broker surface。它不是 scoped binding carrier，也不得作为 binding-only Avatar capability 的一部分传递。

Default Nimi Avatar launch is no longer a Desktop scoped-binding consumer.
Avatar default launch is governed by `apps/avatar/spec/kernel/app-shell-contract.md`
`NAV-SHELL-FIRST-PARTY-RUNTIME-*` and uses local first-party Runtime account
projection. This contract continues to govern explicit binding-only / embedded /
delegated / external / mod capability consumers.

## K-BIND-002 Explicit Binding-Only Avatar Relation Tuple

When an explicit binding-only Avatar mode is separately admitted, Avatar
binding 必须包含的字段：

- `binding_id`
- `runtime_app_id`
- `avatar_instance_id`
- `agent_id`
- `conversation_anchor_id`
- `world_id`（required when world relation exists）
- `purpose = avatar.interaction.consume`
- `issued_at`
- `expires_at`
- `scopes`
- `revocation_reason`（仅在 revoke 后填充）

Avatar binding 必需 scope 集合：

- `runtime.agent.turn.read`
- `runtime.agent.turn.write`（仅当输入启用时）
- `runtime.agent.presentation.read`
- `runtime.agent.state.read`

不得包含超出该集合的 scope。

## K-BIND-003 Carrier Classification

| Carrier | 分类 | 原因 |
|---|---|---|
| 仅通过 Runtime IPC 解析的 opaque binding ID | `allowed` | 无 token / subject 材料离开 Runtime |
| Bridge-side opaque handle，scope 至 app / window | `allowed` | handle 在 Runtime bridge 之外不可赎回 |
| Protected access material，仅在 Runtime bridge 后存储 | `allowed-only-behind-runtime-bridge` | binding-only consumer / app 永远不得作为 durable token 读取 |
| Avatar / app 直接可读的 app session token | `forbidden` | 等同于 app auth |
| Realm access token in binding carrier | `forbidden` | binding 不得成为 Realm identity bootstrap 旁路 |
| Realm refresh token | `forbidden` | durable account custody 旁路 |
| Raw JWT 或解码后的 subject | `forbidden` | subject / account truth 泄漏 |
| `subject_user_id` 字段 | `forbidden` | 调用方提供的 subject truth |

Invariant: local first-party 消费者不允许把 binding 材料赎回为 durable account / session / subject / token truth。需要 direct Realm data access 的 full first-party app 必须使用单独的 Runtime-backed short-lived access-token provider，不能把 binding carrier 当 token surface。

## K-BIND-004 生命周期

| 状态 | 含义 |
|---|---|
| `issued` | Runtime 已铸造，但消费方尚未激活 |
| `active` | 消费方可以执行 scoped 操作 |
| `suspended` | 临时暂停；visual 可继续，interaction 不可用 |
| `revoked` | 永久失效 |
| `expired` | 超时；app 必须通过 owner 重新申请 |
| `superseded` | 因 relation 变化或 rebind 被替换 |

状态转换必须由 Runtime 单一权威驱动；消费方不得自报 binding state。

## K-BIND-005 Revocation Reasons

- `logout`
- `user_switch`
- `daemon_restart_no_recovery`
- `custody_unavailable`
- `account_expired`
- `anchor_switch`
- `avatar_closed`
- `app_closed`
- `scope_changed`
- `binding_replay`
- `policy_revoked`

revocation 必须在第一次 stale request 拒绝之前或同时发出 observable event。

## K-BIND-006 Stale Request Rejection

每个 scoped Runtime 操作必须验证：

- binding 存在
- binding state 为 `active`
- app / window relation 匹配
- Avatar binding 必须匹配 `avatar_instance_id`
- agent / anchor / world 选择器匹配
- scope 包含所请求操作
- 未到 `expires_at`

校验失败必须返回 typed `unavailable` / `permission_denied` 状态。禁止回退到 Realm、shared auth、anonymous subject、或 fixture 模式。

## K-BIND-007 Replay 行为

binding carrier 在其 app / window relation 之外被 replay 时，Runtime 必须：

1. 拒绝请求（fail-close）
2. 发出 `binding.revoked` 或 `binding.replay_detected`
3. 审计中包含 `binding_id` 与 relation fingerprint，不含 secret 材料
4. 若 Avatar visual 包已加载且仍合法，保持可见

## K-BIND-008 Binding-Only Avatar `open_new` Anchor Ownership

Binding-only Avatar embodiment 不允许调用 `runtime.agent.anchors.open` 或任何 anchor 创建路径。

Binding-only `open_new` 流程：

1. Desktop 或 Runtime 创建 / 预约 anchor。
2. Runtime 发出包含 `conversation_anchor_id` 的 binding。
3. Binding-only Avatar embodiment 仅通过 binding projection 消费 `conversation_anchor_id`。

Binding-only Avatar embodiment 不得拥有 anchor 创建、reservation、或所有权。

Default Avatar app is now admitted separately as a Runtime-brokered local
first-party app. In that default mode, Avatar creates or recovers its own
conversation context through Runtime / SDK-authorized first-party APIs and still
must not own refresh token, durable account session, or independent Realm auth
truth.

## K-BIND-009 Event Contract

binding 事件家族（与 `K-ACCSVC-006` 一致）：

- `binding.issued`
- `binding.activated`
- `binding.suspended`
- `binding.revoked`
- `binding.expired`
- `binding.superseded`
- `binding.replay_detected`

最小 payload：`event_id`、`sequence`、`emitted_at`、`binding_id`、`relation_tuple_redacted`、`state`、`reason_code`。禁止包含 carrier 内部材料 / token / secret。

## K-BIND-010 Account 派生约束

`IssueScopedAppBinding` 必须从 Runtime account custody 内部派生 subject / account 上下文。

- 调用方不得提供 `subject_user_id`、Realm token、refresh token、或 raw JWT。
- 调用方必须是 Runtime app registry/admission policy 已登记的 local first-party app instance；`caller.app_id` / `caller.app_instance_id` 必须与待发放 binding relation 精确一致。
- account state 不为 `authenticated` 时，binding 发放必须 fail-close（reason `account_unavailable`）。
- account state 从 `authenticated` 转出时，active/issued binding 必须 revoke 或 suspend；覆盖 custody unavailable、refresh failure / reauth-required、logout、switch、daemon restart no-custody、policy revoke。
- 切换 / logout / reauth-required / custody-unavailable 期间，正在飞的 binding issuance 必须取消并发出 `binding.revoked` reason `account_expired` / `user_switch` / `logout` / `account_unavailable`。

## K-BIND-011 与 Grant Service 的关系

`RuntimeGrantService`（`K-GRANT-*`）继续负责 external-principal grant 与 caller-supplied subject 流程。external-principal grant 与本契约不互通：

- local first-party scoped binding 必须由 `RuntimeAccountService.IssueScopedAppBinding` 发出，subject 由 Runtime 内部派生。
- external-principal grant 仍由 `RuntimeGrantService` 发出，使用现有 `subject_user_id` 流程。
- 二者 binding ID 命名空间必须可区分，且不可互相赎回。

## K-BIND-012 与 App Messaging 的关系

`runtime.agent` reactive chat seam（`K-RPC-004c`、`K-APP-008`）在 explicit
binding-only consume mode 下必须验证 caller 持有匹配的 scoped binding：

- `SendAppMessage` 发往 `runtime.agent` 时必须附带 scoped binding attachment（`binding_id`、optional non-secret `binding_handle`、以及用于校验的 relation selector 字段）；缺失或不匹配 fail-close。
- `SubscribeAppMessages` 订阅 `runtime.agent` 时必须附带同一 scoped binding attachment；缺失或不匹配 fail-close。
- `RuntimeAgentService.SubscribeAgentEvents` 若被 binding-only consume mode 用于
  `runtime.agent.state.*`、`runtime.agent.presentation.*`、或 hook/state
  projection consumption，必须通过 request context 附带 scoped binding
  attachment；缺失或不匹配 fail-close。
- binding-only consume mode 不得用 `subject_user_id`、agent id、anchor id、protected-access scope、或 app session 作为 scoped binding proof。
- binding 撤销后，正在订阅的 stream 必须发出 `binding.revoked` 并关闭。

Default local first-party Avatar runtime-agent consume does not use scoped
binding attachment. It must use admitted first-party Runtime / SDK account and
agent authorization paths.

Scoped binding attachment 是非 secret carrier。它只允许包含
`binding_id`、optional `binding_handle`、`runtime_app_id`、`app_instance_id` /
`window_id`（如适用）、`avatar_instance_id`、`agent_id`、
`conversation_anchor_id`、和 optional `world_id`。它不得包含 Realm token、
Runtime app session token、refresh token、raw JWT、或 decoded subject。

## K-BIND-013 Daemon Restart 行为

daemon 重启时所有 scoped binding 全部失效。Runtime 必须：

1. 在恢复 account projection 前发出 `binding.revoked` reason `daemon_restart_no_recovery`，覆盖所有先前已发 binding。
2. 不允许 binding 持久化或跨重启复活。
3. 消费方必须重新申请 binding；旧 binding_id 永远拒绝。

## K-BIND-014 Audit

binding 发放、激活、suspend、revoke、expire、supersede、replay 必须写审计。最小字段：`binding_id`、relation tuple（去敏）、`state`、`reason_code`、`account_id`（如适用）、`device_id`。

禁止记录 carrier 内部材料、protected access material、token。

## K-BIND-015 Fail-Close Doctrine

binding 相关 fail-close 场景：

- caller 缺失或提供错误 binding_id
- binding state 非 `active`
- relation tuple 不匹配
- scope 不覆盖请求
- account state 非 `authenticated`
- custody unavailable、refresh failure / reauth-required、logout、switch、daemon restart no-custody 后的 stale binding reuse
- daemon restart 后旧 binding 被复用
- replay 检测命中

任何场景下都不得回退到 anonymous subject、shared auth、Realm direct identity bootstrap、或 fixture mode。Full first-party app direct Realm data access 只允许通过 `K-ACCSVC-005` / `GetAccessToken` 的 Runtime-issued short-lived access token，不属于 binding fallback。Default Avatar app falls under that full first-party rule, not this binding-only fallback path.
