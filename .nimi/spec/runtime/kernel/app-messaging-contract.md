# App Messaging Contract

> Owner Domain: `K-APP-*`

## K-APP-001 RuntimeAppService 方法集合

`RuntimeAppService` 方法固定为：

1. `SendAppMessage` — 发送应用间消息
2. `SubscribeAppMessages` — 订阅应用消息事件流

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
- `scoped_binding`：当订阅 `from_app_ids` 包含 `runtime.agent` 或该
  stream 用于 Desktop-launched Avatar binding-only consume 时必填；携带
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

AppMessaging 的安全基线规则，实现必须在 Phase 2 启动时优先满足：

| 规则 | 约束 | 理由 |
|---|---|---|
| **应用认证** | `SendAppMessage` 必须验证 `from_app_id` 已通过 RuntimeAuthService 注册且当前 session 持有对应 token。未认证请求返回 `UNAUTHENTICATED` | 防止任意进程冒充已注册应用发送消息 |
| **消息大小限制** | `payload` Struct 序列化后不得超过 **64 KB**。超限返回 `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | 防止单条消息耗尽 Runtime 内存 |
| **发送速率限制** | 单个 `from_app_id` 发送速率上限为 **100 条/秒**（滑动窗口）。超限返回 `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | 防止消息风暴和 DoS |
| **消息回路检测** | Runtime 检测 A→B→A 回路：同一 `(from_app_id, to_app_id)` 对在 **1 秒内双向消息数 > 20** 时，自动熔断该对后续消息 **60 秒**，返回 `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`。熔断期间双方仍可与其他 app 通信 | 防止两个 mod 之间形成无限消息回路（fork bomb 风险） |

## K-APP-006 与 Desktop Mod interMod 消息的关系

Desktop 存在两条 mod 间通信路径：

| 路径 | 机制 | 安全边界 | 适用场景 |
|---|---|---|---|
| **D-HOOK interMod**（`S-MOD-002`/`S-MOD-011`） | Renderer 进程内同步回调 | Desktop mod governance（D-MOD-005）capability sandbox | 同进程低延迟通信（UI 联动、数据共享） |
| **K-APP SendAppMessage**（`K-APP-001~005`） | Runtime gRPC 跨进程消息 | Runtime auth 拦截器（K-DAEMON-005）+ K-APP-005 安全基线 | 跨进程持久消息（离线缓冲、审计追踪） |

路由规则：
- Mod 间通信**默认走 D-HOOK interMod 路径**（低延迟、无序列化开销）。
- 需要 **审计追踪** 或 **跨重启持久化** 或 **跨进程** 时走 K-APP 路径。
- 两条路径**不做消息去重**——发送方有责任选择唯一路径，同时使用两条路径发送同一消息的行为是应用层错误。

## K-APP-006a 消费契约状态

AppService 的跨域消费契约状态：

| 消费层 | 当前状态 | Phase 2 启动前必须 |
|---|---|---|
| **SDK 方法投影** | 已 landed | 保持 SendAppMessage / SubscribeAppMessages 的 gRPC→SDK 参数映射、错误投影与 runtime public surface 对齐 |
| **Desktop UI Spec** | D-HOOK interMod 路径已有（K-APP-006），K-APP 路径仍无默认 Desktop 消费 | 若 Desktop 需直接使用 K-APP 路径（跨进程、审计场景），创建相应 UI spec |

> **设计完整性注意**：K-APP-001~005 定义了完整的消息传递模型。Desktop 当前主要通过 D-HOOK interMod 路径实现 mod 间通信。K-APP 的 gRPC 路径已经存在 SDK 投影，但仍不是 Desktop mod 的默认同进程消息总线。

## K-APP-007 Deferred Decisions

以下决策在 Phase 2 Draft 阶段有意推迟，实现期允许修正：

| 决策 | 当前状态 | 推迟原因 |
|---|---|---|
| **消息保留策略** | 未定义 | 需确定消息是否持久化、保留时长、容量上限（环形缓冲 vs 无限增长） |
| **投递顺序保证** | `sequence` 单调递增，但未定义跨重启行为 | 需确定 sequence 是否持久化、重启后是否重置 |
| **背压机制** | 未定义 | 高频消息场景下 `SubscribeAppMessages` 的流控策略（丢弃/缓冲/拒绝）。K-APP-005 的速率限制是入口层保护，背压是出口层保护，两者互补 |

## K-APP-008 Reserved `runtime.agent` Reactive Chat Target

`runtime.agent` 是保留的 runtime-owned app target，用于
`RuntimeAgentService` 的 app-facing reactive chat consume seam。

固定规则：

- `runtime.agent` 不是通用 app-bus target；只有本规则 admit 的消息族可
  以通过该 target 传输
- admitted ingress families 固定为：
  `runtime.agent.turn.request`,
  `runtime.agent.turn.interrupt`,
  `runtime.agent.session.snapshot.request`
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
  `runtime.agent.turn.interrupt_ack`,
  `runtime.agent.session.snapshot`
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
  - admitted ingress / subscribe for Desktop-launched Avatar binding-only
    consume must carry a scoped binding attachment and Runtime must validate it
    against `K-BIND-006` / `K-BIND-012`, including current authenticated account
    state; `subject_user_id` remains available for unrelated modes but is not
    proof for Desktop-launched Avatar
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
  emission remain outside this contract unless a later runtime and SDK
  authority packet admits them
- malformed payloads, missing explicit identity, unauthorized app ids, or
  unsupported message types must fail closed rather than being converted into
  local UI cues

## K-APP-010 Avatar Runtime Binding Boundary

Avatar runtime interaction consumes `RuntimeAppService` / `runtime.agent`
projection through a Desktop/Runtime-owned binding. Avatar is not an auth,
Realm, subject, agent, or anchor truth owner.

Fixed rules:

- Avatar must not read shared desktop auth session, call Realm HTTP, call
  Realm `MeService`, or create an app-level Realm client to satisfy
  `RuntimeAppService` session/protected-access requirements.
- Avatar launch context may identify the selected target
  (`agent_id`, `avatar_instance_id`, `conversation_anchor_id` or `open_new`)
  and local visual package selection, but must not carry raw Realm JWT,
  refresh token, `subject_user_id`, Realm base URL, or app-local login state.
- Any runtime app session or protected access needed for Avatar's
  `runtime.agent` consume path must be minted or delegated by Desktop/Runtime
  as a scoped runtime binding for the selected
  `runtime_app_id + avatar_instance_id + agent_id + conversation_anchor_id`
  relation.
- A scoped Avatar runtime binding may expose only opaque runtime IPC binding
  material to Avatar; it must not expose Realm token, refresh token, or
  durable subject/user truth.
- Runtime must reject the binding once account state leaves authenticated
  custody; Avatar may keep the local visual carrier visible while interaction
  becomes unavailable.
- Runtime binding failure must close only interaction, voice, activity,
  app-message subscribe/send, and runtime-driven presentation. A valid local
  Agent Center visual package must continue to render.
- Missing runtime binding must fail closed and observable. It must not silently
  downgrade to mock fixture mode, same-agent fallback, anonymous subject,
  app-local login, or Realm direct access.
