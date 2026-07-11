# App Messaging Contract

> Owner Domain: `K-APP-*`

Split authority map:

- `app-lifecycle-contract.md`: K-APP-011..018 and K-APP-026
- `app-projection-contract.md`: K-APP-019..025
## K-APP-001 RuntimeAppService 方法集合

`RuntimeAppService` 方法固定为：

1. `SendAppMessage` — 发送应用间消息
2. `SubscribeAppMessages` — 订阅应用消息事件流
3. `PrepareAppLifecycleIntent` — 解析并冻结 Desktop 将展示的 canonical lifecycle impact（见 `K-APP-026`）
4. `GetAppLifecycleIntentStatus` — 查询 non-authorizing intent/reconciliation 状态（见 `K-APP-026`）
5. `InstallApp` — 触发 Runtime-owned Nimi App install lifecycle（见 `K-APP-011`）
6. `UninstallApp` — 触发 Runtime-owned Nimi App uninstall lifecycle（见 `K-APP-014`）
7. `GetAppStorage` — 读取 app-scoped storage projection（见 `K-APP-022`）
8. `GetAccountAppInventory` — 读取 authenticated account app-inventory projection（见 `K-APP-024`）
9. `AdoptLocalApp` — 创建显式本地 app adoption（见 `K-APP-025`）
10. `ListLocalAppAdoptions` — 读取本地 app adoption（见 `K-APP-025`）
11. `RemoveLocalAppAdoption` — 移除本地 app adoption（见 `K-APP-025`）
12. `GetAppPackageReadiness` — 读取 active release / install evidence package readiness projection（见 `K-APP-023`）
13. `GetAppInstallJob` — 读取单个 install job 的 typed projection（见 `K-APP-012`）
14. `ListAppInstallJobs` — 列出 install job 的 typed projection（见 `K-APP-012`）
15. `WatchAppInstallJobEvents` — 订阅 install job 进度事件流（见 `K-APP-013`）
16. `UpdateApp` — 触发 Runtime-owned Nimi App atomic update lifecycle（见 `K-APP-015`）
17. `HealthRepairApp` — 触发 Runtime-owned Nimi App health/repair lifecycle（见 `K-APP-016`）
18. `OpenApp` — 触发 Runtime-owned Nimi App launch/open flow（见 `K-APP-017`）

App messaging 方法（1–2）与 lifecycle intent/install/uninstall/update/repair 方法
（3–18）共用 `RuntimeAppService`，但语义独立：lifecycle / projection 方法不承载
app-to-app message broker 语义，messaging 方法不承载 install/uninstall/update/repair/open
语义。

## K-APP-002 SendAppMessage 语义

应用间消息发送：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `from_app_id` | string | 是 | 发送方应用 ID |
| `to_app_id` | string | 是 | 接收方应用 ID |
| `subject_user_id` | string | 否 | 关联用户 |
| `message_type` | string | 否 | 消息类型标识 |
| `payload` | Struct | 否 | 消息载荷（任意 JSON） |
| `require_ack` | bool | 否 | 是否需要确认 |
| `scoped_binding` | ScopedRuntimeBindingAttachment | 条件必填 | `to_app_id=runtime.agent` 且消息族属于 K-APP-008 时必填；包含 binding id / optional handle / non-secret relation selectors |

返回 `message_id`（ULID）、`accepted`、`reason_code`。

## K-APP-003 SubscribeAppMessages 事件流

订阅接收消息事件流：

请求参数：
- `app_id`：订阅方应用 ID（必填）。
- `subject_user_id`：过滤关联用户（可选）。
- `cursor`：续传游标（可选）。
- `from_app_ids`：过滤发送方列表（repeated，可选）。
- `scoped_binding`：当订阅 `from_app_ids` 包含 `runtime.agent` 且该
  stream 用于 explicit binding-only consume 时必填；携带
  non-secret binding id / optional handle / relation selectors。

`AppMessageEvent` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_type` | AppMessageEventType | 事件类型 |
| `sequence` | uint64 | 单调递增序号 |
| `message_id` | string | 消息 ID |
| `from_app_id` | string | 发送方 |
| `to_app_id` | string | 接收方 |
| `subject_user_id` | string | 关联用户 |
| `message_type` | string | 消息类型 |
| `payload` | Struct | 消息载荷 |
| `reason_code` | ReasonCode | 结果码 |
| `trace_id` | string | 追踪 ID |
| `timestamp` | Timestamp | 事件时间 |

## K-APP-004 AppMessageEventType 枚举

| 值 | 含义 |
|---|---|
| `RECEIVED` | 消息已接收 |
| `ACKED` | 消息已确认 |
| `FAILED` | 消息投递失败 |

## K-APP-005 安全基线

AppMessaging 的安全基线规则，实现必须满足：

| 规则 | 约束 | 理由 |
|---|---|---|
| **应用认证** | `SendAppMessage` 必须验证 `from_app_id` 已通过 RuntimeAuthService 注册且当前 session 持有对应 token。未认证请求返回 `UNAUTHENTICATED` | 防止任意进程冒充已注册应用发送消息 |
| **消息大小限制** | `payload` Struct 序列化后不得超过 **64 KB**。超限返回 `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | 防止单条消息耗尽 Runtime 内存 |
| **发送速率限制** | 单个 `from_app_id` 发送速率上限为 **100 条/秒**（滑动窗口）。超限返回 `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | 防止消息风暴和 DoS |
| **消息回路检测** | Runtime 检测 A→B→A 回路：同一 `(from_app_id, to_app_id)` 对在 **1 秒内双向消息数 > 20** 时，自动熔断该对后续消息 **60 秒**，返回 `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`。熔断期间双方仍可与其他 app 通信 | 防止两个 app 之间形成无限消息回路（fork bomb 风险） |

## K-APP-006 — No Desktop-Local Alternate Message Bus

`RuntimeAppService.SendAppMessage` 是 admitted app-to-app messaging 的唯一
runtime-owned product path。Desktop renderer 不得创建 parallel local message bus
来替代 K-APP 的 runtime auth、rate-limit、loop detection、durable event ordering
或 audit posture。

## K-APP-006a 消费契约

AppService 的跨域消费契约：

| 消费层 | 契约 |
|---|---|---|
| **SDK 方法投影** | 保持 SendAppMessage / SubscribeAppMessages 的 gRPC→SDK 参数映射、错误投影与 runtime public surface 对齐 |
| **Desktop UI Spec** | Desktop 没有默认 K-APP UI 消费权；若 Desktop 需直接使用 K-APP 路径（跨进程、审计场景），必须先有对应 Desktop UI spec |

> **设计完整性注意**：K-APP-001~005 定义了完整的消息传递模型。K-APP 的
> gRPC 路径已经存在 SDK 投影，但仍不是 Desktop shell 的默认 UI 消息面。

## K-APP-007 App Messaging Delivery, Retention, And Backpressure

`RuntimeAppService.SendAppMessage` / `SubscribeAppMessages` 的 admitted
delivery semantics 是 process-local live delivery：

- Runtime does not persist app-message events.
- Runtime does not replay events to subscribers that were not connected when
  the event was published.
- `sequence` is monotonic only within one Runtime process lifetime and resets
  after Runtime restart.
- `SubscribeAppMessagesRequest.cursor` is not admitted for replay or durable
  resume on this surface. A non-empty cursor MUST fail closed with
  `INVALID_ARGUMENT` + `PROTOCOL_ENVELOPE_INVALID`.
- A subscriber stream owns a bounded relay buffer of 32 events. When the
  consumer is too slow and the relay observes three consecutive drops, Runtime
  MUST close that subscriber with `RESOURCE_EXHAUSTED`; `SendAppMessage`
  success MUST NOT be interpreted as durable delivery to that subscriber.

The app-message bus is therefore suitable for live app-to-app notifications
and for the reserved `runtime.agent` reactive consume seam. It is not a
durable inbox, durable event log, cross-restart replay stream, audit log, or
product message-history authority. Durable product records must be committed
through their owning Runtime / Realm / Cognition / app surface.

## K-APP-008 Reserved `runtime.agent` Reactive Chat Target

`runtime.agent` 是保留的 runtime-owned app target，用于
`RuntimeAgentService` 的 app-facing reactive chat consume seam。

固定规则：

- `runtime.agent` 不是通用 app-bus target；只有本规则 admit 的消息族可
  以通过该 target 传输
- admitted ingress families 固定为：
  `runtime.agent.turn.request`,
  `runtime.agent.turn.interrupt`
- admitted projection families 固定为：
  `runtime.agent.turn.accepted`,
  `runtime.agent.turn.started`,
  `runtime.agent.turn.reasoning_delta`,
  `runtime.agent.turn.text_delta`,
  `runtime.agent.turn.structured`,
  `runtime.agent.turn.message_committed`,
  `runtime.agent.turn.post_turn`,
  `runtime.agent.turn.completed`,
  `runtime.agent.turn.failed`,
  `runtime.agent.turn.interrupted`,
  `runtime.agent.turn.interrupt_ack`
- public chat session snapshot is a query surface and must use
  `RuntimeAgentService.GetPublicChatSessionSnapshot`; it is not admitted as
  `RuntimeAppService` request/reply traffic.
- semantic ownership of these families remains on `RuntimeAgentService` even
  when the transport owner is `RuntimeAppService`
- first-party consumers may use `SendAppMessage` /
  `SubscribeAppMessages` against `runtime.agent` for this seam, but must not
  reinterpret that transport path as proof of a generic cross-app chat bus
- `runtime.agent` reactive chat seam admits a dedicated transport capability
  family:
  - admitted ingress via `SendAppMessage` to `to_app_id=runtime.agent` with an
    admitted ingress message type requires `runtime.agent.turn.write`
- admitted `SubscribeAppMessages` reads that filter `from_app_ids` including
    `runtime.agent` require `runtime.agent.turn.read`
  - admitted ingress / subscribe for explicit binding-only consume must carry a
    scoped binding attachment and Runtime must validate it against `K-BIND-006`
    / `K-BIND-012`, including current authenticated account state;
    `subject_user_id` remains available for unrelated modes but is not scoped
    binding proof
  - generic cross-app app-bus traffic outside this reserved seam continues to
    use `runtime.app.send.cross_app`
- `runtime.agent.*` RPC projection remains separate and covers
  lifecycle/state/memory/admin/read rather than reactive chat transport

## K-APP-009 Companion Multi-App Interaction Boundary

Agent Companion multi-app interaction uses explicit runtime app messaging and
runtime-owned `runtime.agent.*` projection families. It is not a platform event
broker.

Fixed rules:

- first-party app-local event names such as `desktop.chat.*` and `avatar.*`
  may be documented by their owning app specs, but those names do not become
  runtime-owned event families by appearing in app-message payloads
- RuntimeAppService transports addressed app messages; it does not own Desktop
  shell event semantics, Avatar carrier event semantics, or SDK app-event
  schema truth
- app-to-app coordination for the companion path must carry explicit app id,
  subject context when required, and any runtime continuity identifiers needed
  by the receiving app; receivers must not infer `agent_id` or
  `conversation_anchor_id` from same-agent traffic or app-local session ids
- `runtime.agent` remains the only reserved runtime-owned target for reactive
  agent chat and admitted projection families; app-local targets must not
  mint new `runtime.agent.*` payload shapes
- wildcard subscription, cancellable before-events, and SDK-owned app-event
  emission are not admitted by this contract
- malformed payloads, missing explicit identity, unauthorized app ids, or
  unsupported message types must fail closed rather than being converted into
  local UI cues

## K-APP-010 Avatar Runtime Boundary

Fixed rules:

- Default Avatar is a Runtime-admitted local first-party app (`nimi.avatar`).
  It may consume `RuntimeAppService` / `runtime.agent` projection through normal
  first-party Runtime / SDK account and agent authorization paths.
- Avatar must not read shared desktop auth session, receive refresh token,
  maintain independent login truth, or use caller-supplied subject/user/JWT
  truth.
- Avatar launch context may carry only minimal launch intent: `agent_id`,
  optional `avatar_instance_id`, and optional non-authoritative `launch_source`.
  It must not carry scoped binding, conversation anchor, visual package,
  account/user, Realm, or auth material in the default path.
- Avatar uses Runtime-mediated Realm and Runtime service operations only. SDK,
  renderer and host receive typed results, never account bearer material.
- Avatar must validate `agent_id` and resolve visual package / private data
  through Runtime / SDK authority before loading private agent data.
- Explicit binding-only Avatar modes must use `K-BIND-*` scoped binding
  attachment and must fail closed when binding is missing or invalid.
