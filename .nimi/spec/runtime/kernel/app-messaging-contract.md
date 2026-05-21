# App Messaging Contract

> Owner Domain: `K-APP-*`

## K-APP-001 RuntimeAppService 方法集合

`RuntimeAppService` 方法固定为：

1. `SendAppMessage` — 发送应用间消息
2. `SubscribeAppMessages` — 订阅应用消息事件流
3. `InstallApp` — 触发 Runtime-owned Nimi App install lifecycle（见 `K-APP-011`）
4. `UninstallApp` — 触发 Runtime-owned Nimi App uninstall lifecycle（见 `K-APP-014`）
5. `GetAppInstallJob` — 读取单个 install job 的 typed projection（见 `K-APP-012`）
6. `ListAppInstallJobs` — 列出 install job 的 typed projection（见 `K-APP-012`）
7. `WatchAppInstallJobEvents` — 订阅 install job 进度事件流（见 `K-APP-013`）
8. `UpdateApp` — 触发 Runtime-owned Nimi App atomic update lifecycle（见 `K-APP-015`）
9. `HealthRepairApp` — 触发 Runtime-owned Nimi App health/repair lifecycle（见 `K-APP-016`）

App messaging 方法（1–2）与 app install/uninstall/update/repair lifecycle 方法
（3–9）共用 `RuntimeAppService`，但语义独立：lifecycle 方法不承载 app-to-app
message broker 语义，messaging 方法不承载 install/uninstall/update/repair 语义。

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
  emission remain outside this contract unless a later runtime and SDK
  authority packet admits them
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
- Avatar may use Runtime-issued short-lived access tokens through SDK
  local-first-party mode for direct Realm data access; this is not a scoped
  binding carrier and must not expose refresh-token custody.
- Avatar must validate `agent_id` and resolve visual package / private data
  through Runtime / SDK authority before loading private agent data.
- Explicit binding-only Avatar modes must use `K-BIND-*` scoped binding
  attachment and must fail closed when binding is missing or invalid.

## K-APP-011 InstallApp Lifecycle

`MUST`：`InstallApp` 由 Runtime 拥有，是 Nimi App install 的唯一 RPC 入口。
Runtime registration / supervision / sandbox 归 Runtime 所有
（Platform `P-NAPP-006`）。Install handler 必须：

- 解析 `app_id` 对应的 admitted Nimi App registry row 与其 bound release
  descriptor；
- 对 `external-immutable-artifact` descriptor，仅从 descriptor 的 artifact
  locator 下载，对下载字节计算 `sha256`，与 descriptor 比对，digest 不匹配
  时在 unpack 之前 fail closed（Platform `P-NAPP-014`）；
- 对 `bundled-with-nimi` descriptor，从 atomic Nimi release bundle 的
  bundled-app artifact 物化，不授权外部 download；
- 在 `<nimi_data>/apps/<app-id>/{releases/<version>,data,cache,tmp}` 物化
  存储根（Platform `P-NAPP-015`）；
- 写入 Runtime-owned `install-evidence.json`。

`MUST NOT`：install handler 不得在 digest/manifest/storage 违例时返回
pseudo-success；失败 install 必须留下 recoverable 状态（retry / 移除
partial files），不得投影为 success。

## K-APP-012 AppInstallJob Typed Projection

`MUST`：`InstallApp` / `GetAppInstallJob` / `ListAppInstallJobs` 返回
typed `AppInstallJob`，携带 stable job id、typed `state`、typed `phase`、
typed `source_kind`、`release_descriptor_ref`、storage projection、与
fail-closed `reason_code` / `failure_detail` / `retryable`。

`MUST NOT`：不得从 transfer completion、endpoint reachability、process
liveness、file existence 推断 `installed`；不得用单一 `failed` 文案
collapse 多种 fail-closed reason。

## K-APP-013 WatchAppInstallJobEvents 事件流

`MUST`：`WatchAppInstallJobEvents` 以 server-stream 投影 install job 的
typed 进度帧。每个 `AppInstallJobEvent` 携带单调递增 `sequence` 与该时刻
完整的 `AppInstallJob` 快照，使 consumer 不从 partial delta 重建状态。

`MUST NOT`：进度流不承载 audit / permission / spend 事件。

## K-APP-014 UninstallApp Lifecycle

`MUST`：`UninstallApp` 默认移除 `<nimi_data>/apps/<app-id>/releases` 下的
release payload，保留 `<nimi_data>/apps/<app-id>/data` 下的 durable data
（Platform `P-NAPP-015`）。只有当 caller 显式确认 destructive delete 时才
额外移除 durable data。

`MUST NOT`：uninstall 不得隐式删除 shared models、Runtime dependencies、
account data、或其他 app 的数据。

## K-APP-015 UpdateApp Atomic Update Lifecycle

`MUST`：`UpdateApp` 由 Runtime 拥有，是 Nimi App update 的唯一 RPC 入口。
Update handler 必须：

- 解析 `app_id` 对应的 admitted Nimi App registry row 与其当前 bound release
  descriptor；
- 对 `external-immutable-artifact` descriptor，仅从 descriptor 的 artifact
  locator 下载新 release，对下载字节计算 `sha256`，与 descriptor 比对，digest
  不匹配时在 unpack 之前 fail closed（Platform `P-NAPP-014`）；
- 在 `<nimi_data>/apps/<app-id>/releases/<new-version>` 物化新 release，
  完全 materialize + verify + 写入 evidence **之后**，才以一次 atomic
  pointer swap 切换 active release；
- 保留 `<nimi_data>/apps/<app-id>/data` 下的 durable data 不变
  （Platform `P-NAPP-015`）；
- 区分 required（breaking）update 与 non-breaking update：required update
  在 caller 确认前 fail closed。

`MUST NOT`：失败的 update 不得 corrupt 既有 installed release——active
release pointer 在 swap commit 前必须仍指向旧 release，旧 release 保持可用；
update 不得删除或改写 durable data；不得在 digest/storage/swap 违例时返回
pseudo-success。

## K-APP-016 HealthRepairApp Lifecycle

`MUST`：`HealthRepairApp` 由 Runtime 拥有，是 Nimi App health/repair 的唯一
RPC 入口。它仅 admit 四个显式 action token：`cancel`、`retry`、`repair`、
`reinstall`（SDK `S-APP-002`）。

- `cancel` — 取消一个 in-flight lifecycle job；被取消的 job 进入 recoverable
  cancelled 终态，可被 retry，不投影为 success；
- `retry` — 以相同 kind 重新派发一个 failed / cancelled lifecycle job；
- `repair` — drop（可能损坏的）release payload 并重新 materialize 同版本
  release，保留 durable data；
- `reinstall` — 干净重装当前 bound descriptor，保留 durable data。

`MUST NOT`：任何 action 不得删除 durable data；不得把失败的 repair op 投影为
success；不得 admit 上述四个 token 之外的 action。

## K-APP-017 OpenApp Launch Flow

`MUST`：`RuntimeAppService` admit 一个 `OpenApp` RPC，作为 Nimi App
launch（Open flow）的唯一 Runtime RPC 入口。Runtime 拥有 app launch
supervision（Platform `P-NAPP-006`）。`OpenApp` 必须：

- 解析 `app_id` 对应的 admitted Nimi App registry row
  （`admission_status=admitted`、`ordinary_visibility=ordinary-visible`）；
- 接收一个显式的 canonical `AIScopeRef`，且该 ref 必须是 `P-AISC-007`
  定义的 app-launch scope 形状 `{ kind: 'app', ownerId: <admitted app_id>,
  surfaceId? }`，其 `ownerId` 必须与被 launch 的 `app_id` 一致；
- 按 Open flow 顺序校验并 launch：verify package + account library state +
  app data state → verify permissions 已 grant 或 promptable → ensure app
  AIConfig 存在（首次 launch 走 `S-AICONF-009` 的 per-app first-launch
  AIConfig initialization：app recommended profile if declared+satisfied,
  else Account Default Profile；既有 per-app AIConfig 永不被覆盖）→
  validate manifest requirements → launch；
- 返回 typed launch projection，并对 package / library / app-data /
  permission / AIConfig / manifest 任一环节的 fail-closed reason 携带
  typed `reason_code`。

`MUST NOT`：`OpenApp` 不得在缺少显式 `AIScopeRef` 时 launch，不得从 active
chat、renderer-local current app、或默认 scope 隐式推断 launch scope
（对齐 SDK `S-APP-003`）。它不得从 transfer completion、process liveness、
file existence 推断 launch 成功；不得用单一 generic `unavailable` /
`failed` 文案 collapse 多种 fail-closed reason；不得在 permission 未授予、
AIConfig 无法解析、或 manifest requirement 未满足时返回 pseudo-success；
不得在 Open flow 内静默改写既有 per-app AIConfig 或 factory profile
template。

`MUST`：`UninstallApp`（`K-APP-014`）必须发射一个可被 watch 的 lifecycle
job —— `AppLifecycleJobKind` admit 一个 `uninstall` job kind，使
`UninstallApp` 产出一个 typed `AppInstallJob`（`K-APP-012`）并可通过
`WatchAppInstallJobEvents`（`K-APP-013`）订阅其 typed 进度帧。`uninstall`
job 是 `uninstalling` 卡片状态的唯一 live-job 真相源。

`MUST NOT`：`uninstalling` 进度态不得由 renderer-local in-flight flag 或
其他 parallel-truth 信号推断；uninstall 进度 job 不得承载
audit / permission / spend 事件，也不得改变 `K-APP-014` 的 durable-data
保留语义。

> 实现注记：`OpenApp` RPC 与 `AppLifecycleJobKind.uninstall` 的
> `proto/runtime/v1/app.proto` 物化随后续 app-launch 实现 wave 落地；本规则
> 是其 normative 契约面。`OpenApp` 不承载 app-to-app message broker 语义，
> 与 `SendAppMessage` / `SubscribeAppMessages` 语义独立（对齐 `K-APP-001`）。
