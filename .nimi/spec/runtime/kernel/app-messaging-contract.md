# App Messaging Contract

> Owner Domain: `K-APP-*`

## K-APP-001 RuntimeAppService 方法集合

`RuntimeAppService` 方法固定为：

1. `SendAppMessage` — 发送应用间消息
2. `SubscribeAppMessages` — 订阅应用消息事件流
3. `InstallApp` — 触发 Runtime-owned Nimi App install lifecycle（见 `K-APP-011`）
4. `UninstallApp` — 触发 Runtime-owned Nimi App uninstall lifecycle（见 `K-APP-014`）
5. `GetAppStorage` — 读取 app-scoped storage truth projection（见 `K-APP-022`）
6. `GetAccountAppInventory` — 读取 authenticated account app-inventory truth projection（见 `K-APP-024`）
7. `AdoptLocalApp` / `ListLocalAppAdoptions` / `RemoveLocalAppAdoption` — 显式本地 app 接入、读取、移除（见 `K-APP-025`）
8. `GetAppPackageReadiness` — 读取 active release / install evidence package readiness projection（见 `K-APP-023`）
9. `GetAppInstallJob` — 读取单个 install job 的 typed projection（见 `K-APP-012`）
10. `ListAppInstallJobs` — 列出 install job 的 typed projection（见 `K-APP-012`）
11. `WatchAppInstallJobEvents` — 订阅 install job 进度事件流（见 `K-APP-013`）
12. `UpdateApp` — 触发 Runtime-owned Nimi App atomic update lifecycle（见 `K-APP-015`）
12. `HealthRepairApp` — 触发 Runtime-owned Nimi App health/repair lifecycle（见 `K-APP-016`）
13. `OpenApp` — 触发 Runtime-owned Nimi App launch/open flow（见 `K-APP-017`）

App messaging 方法（1–2）与 app install/uninstall/update/repair lifecycle 方法
（3–13）共用 `RuntimeAppService`，但语义独立：lifecycle / projection 方法不承载
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

`OpenApp` 不承载 app-to-app message broker 语义，与
`SendAppMessage` / `SubscribeAppMessages` 语义独立（对齐 `K-APP-001`）。

## K-APP-018 Runtime-Mediated File-API Non-Admission

`RuntimeAppService` 的 current admitted method set is exactly the 13
methods listed in `K-APP-001` and
`.nimi/spec/runtime/kernel/tables/rpc-methods.yaml`. No Runtime-mediated
file-API RPC is admitted on the current `RuntimeAppService` surface.

The following method names are explicitly non-admitted on the current
surface and MUST NOT be exposed by Runtime, SDK, Kit, Desktop, Tester, or
scaffold clients as callable product APIs:

- `ReadAppLocalDraftFile`
- `WriteAppLocalDraftFile`
- `ListAppLocalDraftDir`
- `DeleteAppLocalDraftFile`
- `MoveAppLocalDraftFile`

`P-PERM-011` still admits the `app-local-drafts` qualifier semantics for
permission review and scope expression, but that qualifier does not by
itself admit a Runtime file API, SDK file client, Desktop bridge helper, or
generic REST/proxy path. Any current attempt to materialize a
Nimi-mediated file API outside the admitted method set fails closed by
absence of an admitted method; consumers MUST NOT emulate the missing
surface through `SendAppMessage`, `proxyHttp`, private Runtime APIs,
Realm REST, direct cross-app path access, or a generic "file op" wrapper.

For apps admitted with `storage_policy_ref.kind: app-owned-os-storage`
(`P-NAPP-027` / `P-NAPP-028`), file IO remains outside this Runtime app
messaging surface. For apps admitted with `nimi-mediated-default`, the
admitted storage truth remains the Runtime app-storage projection
(`GetAppStorage`, `K-APP-022`); it is not an authorization to expose raw
file read/write RPCs.

A Runtime-mediated file API cannot be admitted unless the same authority
change updates `K-APP-001`, `rpc-methods.yaml`,
`proto/runtime/v1/app.proto`, the Runtime implementation, SDK projection,
and consumer tests together. A rule body outside `K-APP-001` MUST NOT
amend the service method set by implication.

## K-APP-019 AppHealth Typed Diagnostic Projection

`MUST` (eight typed diagnostic dimensions). The `AppHealth` typed
projection MUST report exactly eight typed diagnostic dimensions, each
producing a typed sub-state:

| Dimension | Typed sub-states |
|---|---|
| `integrity` | `ok` / `digest_mismatch` / `signature_unverified` / `provenance_unverified` / `mirror_unreachable` |
| `runtime` | `ok` / `registration_missing` / `lifecycle_supervisor_failed` / `dependency_unready` |
| `nimi_api_permissions` | `ok` / `scope_missing` / `scope_revoked` / `scope_expired` |
| `storage` | `ok` / `root_missing` / `migration_pending` / `os_storage_disclosure_missing` |
| `publisher_disclosed_network` | `ok` / `disclosure_missing` / `disclosure_mismatch` |
| `data` | `ok` / `app_data_corrupt` / `cache_corrupt` |
| `review` | `approved` / `revision-requested` / `rejected` / `kill-switched` |
| `response` | `ok` / `forced_update_required` / `rollback_available` / `publisher_suspended` / `report_received` / `kill_switch_active` |

The eight dimension names (`integrity`, `runtime`,
`nimi_api_permissions`, `storage`, `publisher_disclosed_network`,
`data`, `review`, `response`) are exactly the eight names admitted by
this rule. Each dimension produces exactly one typed sub-state per
`AppHealth` projection emission; the sub-state vocabulary above is the
admitted enum for that dimension.

**Disambiguation from `P-NAPP-008`.** `P-NAPP-008` at
`.nimi/spec/platform/kernel/nimi-app-admission-contract.md:103-118`
admits the typed `health_repair_projection` set of eight overall
**STATES** the app can be in:

- `unavailable`
- `setup-required`
- `needs-confirmation`
- `in-progress`
- `failed`
- `unsupported`
- `repair-required`
- `stale-projection`

`K-APP-019` admits eight typed **DIMENSIONS** (the orthogonal
evaluation surfaces above). The two "eights" are different in
semantics: `P-NAPP-008` 's eight are mutually-exclusive overall
states; `K-APP-019` 's eight are orthogonal dimensions each emitting
its own sub-state per projection emission. The overall `P-NAPP-008`
state is **DERIVED** from the eight dimensions' sub-states per the
lookup table below. The two eights MUST NOT be conflated; consumers
MUST NOT pick one as a substitute for the other.

`MUST` (derivation table — dimensions to overall states). The
derivation from `K-APP-019` 's eight diagnostic dimensions to
`P-NAPP-008` 's eight overall states is admitted as a typed lookup
table inside this rule body. The table is the canonical mapping;
free-form interpretation by the projection layer is forbidden.

Reading the table: each row enumerates one `(dimension, sub-state)`
pair and the `P-NAPP-008` overall state it raises. Where one
`(dimension, sub-state)` row raises multiple overall states (e.g. the
`review` dimension 's `kill-switched` sub-state independently
contributes to both `unavailable` and `repair-required` overall-state
candidacy), all raised states are listed; the projection layer
resolves the final overall state by precedence
`unavailable > repair-required > failed > setup-required >
needs-confirmation > in-progress > unsupported > stale-projection`,
admitted as part of this table.

| Dimension | Sub-state | Raised overall state(s) |
|---|---|---|
| `integrity` | `ok` | (none — clears integrity contribution) |
| `integrity` | `digest_mismatch` | `failed` |
| `integrity` | `signature_unverified` | `failed` |
| `integrity` | `provenance_unverified` | `failed` |
| `integrity` | `mirror_unreachable` | `stale-projection` |
| `runtime` | `ok` | (none) |
| `runtime` | `registration_missing` | `setup-required` |
| `runtime` | `lifecycle_supervisor_failed` | `failed` |
| `runtime` | `dependency_unready` | `setup-required` |
| `nimi_api_permissions` | `ok` | (none) |
| `nimi_api_permissions` | `scope_missing` | `needs-confirmation` |
| `nimi_api_permissions` | `scope_revoked` | `repair-required` |
| `nimi_api_permissions` | `scope_expired` | `repair-required` |
| `storage` | `ok` | (none) |
| `storage` | `root_missing` | `repair-required` |
| `storage` | `migration_pending` | `in-progress` |
| `storage` | `os_storage_disclosure_missing` | `unsupported` |
| `publisher_disclosed_network` | `ok` | (none) |
| `publisher_disclosed_network` | `disclosure_missing` | `unsupported` |
| `publisher_disclosed_network` | `disclosure_mismatch` | `unsupported` |
| `data` | `ok` | (none) |
| `data` | `app_data_corrupt` | `repair-required` |
| `data` | `cache_corrupt` | `repair-required` |
| `review` | `approved` | (none) |
| `review` | `revision-requested` | `needs-confirmation` |
| `review` | `rejected` | `unavailable` |
| `review` | `kill-switched` | `unavailable` |
| `response` | `ok` | (none) |
| `response` | `forced_update_required` | `unavailable` |
| `response` | `rollback_available` | `repair-required` |
| `response` | `publisher_suspended` | `unavailable` |
| `response` | `report_received` | `needs-confirmation` |
| `response` | `kill_switch_active` | `unavailable` |

When all eight dimensions report `ok` (or the no-raise sub-states
above), the projection layer emits no `P-NAPP-008` raised state. The
`P-NAPP-008` overall state in this case is the absence-of-degraded
projection ("the app is OK on the eight admitted dimensions"); this
absence is the typed default and is not itself one of `P-NAPP-008` 's
admitted degraded states.

The typed reason `os_storage_disclosure_missing` (`P-NAPP-028` at
`.nimi/spec/platform/kernel/nimi-app-admission-contract.md` MUST NOT
clause) covers both "missing under app-owned-os-storage" and
"populated under nimi-mediated-default" admission-time invariants.
`K-APP-019` 's `storage` dimension surfaces the same typed reason at
projection time for the app-owned-os-storage branch; the projection
layer MUST surface a differentiated user message between
"disclosure missing" and "disclosure cross-populated" cases using
typed message text (the typed reason itself is shared by admission
intent; this rule does not invent a new typed reason).

`MUST NOT`. `K-APP-019` MUST NOT redefine `P-NAPP-008` 's overall
state set; this rule cross-references `P-NAPP-008` and admits the
derivation table only. `K-APP-019` MUST NOT collapse the eight typed
dimensions into a single "health" sub-state; each dimension is
independently emitted. The projection layer MUST NOT infer an
overall state outside the derivation table 's enumeration; free-form
"close enough" derivation is forbidden.

## K-APP-020 AppResponseState Typed Projection

`MUST` (typed fields). The `AppResponseState` typed projection MUST
surface exactly the following typed fields:

| Field | Type | Semantics |
|---|---|---|
| `kill_switch_active` | bool | projects from `P-ECO-004` `kill-switched` review-state — true when the app 's admitted descriptor 's `review.decision` (`P-NAPP-025`) or the registry row 's runtime kill-switch posture resolves to `kill-switched` |
| `forced_update_required` | bool | true when Runtime response-state policy resolves that the active descriptor requires a remediated version before next launch |
| `rollback_available` | bool | true when a previous admitted release descriptor remains eligible per the descriptor 's `rollback_eligibility` (`P-NAPP-018`) and is materializable |
| `publisher_suspended` | bool | true when Runtime response-state policy resolves that the publisher namespace is suspended for app launch/support purposes |
| `report_received` | uint32 (typed-counted) | typed monotonic counter of post-release community reports received against this descriptor; `0` is "no report"; a non-zero count indicates the admitted report aggregate has delivered at least one report and is the support-UX entry into report-driven detection |

Apps consume this projection. The Apps surface MUST NOT compute these
typed fields from raw data (raw review-state polling, raw descriptor
diffing, raw publisher-status fetches); Runtime owns the projection
and Apps reads it as typed truth.

`MUST` (source posture). `K-APP-020` cross-references `P-ECO-004`
for `kill-switched` review-state and `P-NAPP-018` for
`rollback_eligibility`. The remaining response-state policy inputs
(`forced_update_required`, `publisher_suspended`, `report_received`)
are Runtime projection inputs for this rule and must be resolved as
typed evidence before Runtime emits them. Runtime MUST NOT derive one
response field from another or from topic lifecycle reports.

`MUST NOT`. `K-APP-020` MUST NOT extend the five-field set above
under this rule; the typed field set is closed. A new response-state
field is a separate authority-bearing
admission event. `K-APP-020` MUST NOT silently coerce one typed
field 's value from another (e.g. inferring
`forced_update_required: true` from `kill_switch_active: true`); the
five fields are orthogonal projections. The Apps surface MUST NOT
read raw P-ECO, descriptor, publisher, report, or topic state directly
to compute these fields; the projection seam is `K-APP-020`.

## K-APP-021 Support Next-Action Mapping

`MUST` (closed ten-token next-action enum). Every typed degraded
`AppHealth` state (`K-APP-019`) and every degraded `AppResponseState`
(`K-APP-020`) MUST map to a typed next-action token. The admitted
token enum is exactly the following ten values, closed at this
admission:

1. `request_permission`
2. `repair_runtime_materialization`
3. `reinstall_descriptor`
4. `rollback`
5. `clear_cache`
6. `export_diagnostics`
7. `contact_publisher`
8. `stop_kill_switched`
9. `stop_rejected`
10. `await_forced_update`

The enum is closed. Extending the enum beyond ten values, or
contracting it below ten values, is a separate authority-bearing
admission event.

**Disambiguation from `K-APP-016`.** `K-APP-016`
`HealthRepairApp` at this file lines 293–307 admits an RPC with
exactly four typed action tokens: `cancel`, `retry`, `repair`,
`reinstall`. `K-APP-021` 's ten next-action tokens are NOT a
superset, subset, or rename of `K-APP-016` 's four RPC action
tokens. The two enums are different in domain:

- `K-APP-016` 's four tokens are RPC ACTIONS the caller invokes
  against `RuntimeAppService` to drive a lifecycle job; the typed
  enum lives at the gRPC surface.
- `K-APP-021` 's ten tokens are UX NEXT-ACTION PROJECTIONS the
  Support surface displays so the user knows what to do next; the
  typed enum lives at the projection surface. Some `K-APP-021`
  tokens map onto a `K-APP-016` action invocation
  (`repair_runtime_materialization` ultimately drives a
  `K-APP-016` `repair`; `reinstall_descriptor` ultimately drives a
  `K-APP-016` `reinstall`); others do not (`request_permission`,
  `rollback`, `clear_cache`, `export_diagnostics`,
  `contact_publisher`, `stop_kill_switched`, `stop_rejected`,
  `await_forced_update` are not `K-APP-016` actions). The two
  enums MUST NOT be conflated; the projection layer MUST NOT
  rewrite a `K-APP-021` token into a `K-APP-016` token without
  going through the action-binding semantics above.

`MUST` (state-to-action mapping table). The mapping from
`{AppHealth degraded state × AppResponseState flag}` to the ten
next-action tokens is admitted as a typed lookup table inside this
rule body. Free-form UX inference of next-action is forbidden; the
Support surface consumes this table.

Reading the table: rows are keyed on either a `K-APP-019` `(dimension,
sub-state)` row or a `K-APP-020` typed-flag value. Where a row 's
condition holds simultaneously with another row 's condition, the
projection layer resolves the final next-action by precedence
`stop_kill_switched > stop_rejected > await_forced_update > rollback >
request_permission > repair_runtime_materialization >
reinstall_descriptor > clear_cache > export_diagnostics >
contact_publisher`, admitted as part of this table.

| Source (dimension/sub-state OR response field) | Next-action token |
|---|---|
| `review` = `kill-switched` OR `AppResponseState.kill_switch_active` = true | `stop_kill_switched` |
| `review` = `rejected` | `stop_rejected` |
| `AppResponseState.forced_update_required` = true | `await_forced_update` |
| `AppResponseState.rollback_available` = true (when surfaced for a degraded condition that rollback resolves) | `rollback` |
| `nimi_api_permissions` = `scope_missing` | `request_permission` |
| `nimi_api_permissions` = `scope_revoked` | `request_permission` |
| `nimi_api_permissions` = `scope_expired` | `request_permission` |
| `runtime` = `registration_missing` | `repair_runtime_materialization` |
| `runtime` = `lifecycle_supervisor_failed` | `repair_runtime_materialization` |
| `runtime` = `dependency_unready` | `repair_runtime_materialization` |
| `storage` = `root_missing` | `repair_runtime_materialization` |
| `storage` = `migration_pending` | `repair_runtime_materialization` |
| `data` = `app_data_corrupt` | `reinstall_descriptor` |
| `integrity` = `digest_mismatch` | `reinstall_descriptor` |
| `integrity` = `signature_unverified` | `reinstall_descriptor` |
| `integrity` = `provenance_unverified` | `reinstall_descriptor` |
| `integrity` = `mirror_unreachable` | `export_diagnostics` |
| `data` = `cache_corrupt` | `clear_cache` |
| `storage` = `os_storage_disclosure_missing` | `export_diagnostics` |
| `publisher_disclosed_network` = `disclosure_missing` | `contact_publisher` |
| `publisher_disclosed_network` = `disclosure_mismatch` | `contact_publisher` |
| `AppResponseState.publisher_suspended` = true | `contact_publisher` |
| `AppResponseState.report_received` non-zero | `export_diagnostics` |
| `review` = `revision-requested` | `contact_publisher` |

The table covers every degraded condition admitted by `K-APP-019`
and every typed-flag condition admitted by `K-APP-020` that maps to a
support next-action. Conditions whose admitted sub-state is the
`ok` / `approved` / `(none)` no-raise case do not map to a
next-action token — there is no next-action to project when the app
is on the happy path of that dimension.

`MUST` (cross-references). `K-APP-021` cross-references `K-APP-016`
(the four-token RPC action enum from which `K-APP-021` is explicitly
distinct), `K-APP-019` (the eight diagnostic dimensions whose typed
sub-states the table reads from), and `K-APP-020` (the typed response
fields the table reads from).

`MUST NOT`. `K-APP-021` MUST NOT extend the ten-token next-action
enum under this rule. `K-APP-021` MUST NOT silently rewrite a token
to a `K-APP-016` RPC action token without going through the binding
semantics in the disambiguation clause above. The Support surface
MUST NOT skip the mapping table and infer a next-action from prose;
the typed table is the contract face.

`K-APP-019` derivation table 与 `K-APP-021` state-to-action mapping
table 是 closed contract faces，不接受 free-form 投影层重新解释。

## K-APP-022 App Storage Truth Projection

`MUST`：`GetAppStorage(app_id)` 是 Runtime-owned app-scoped storage truth
projection。它从 Runtime `dataRootRef` 和 Platform-admitted
`nimi_data` app layout 解析以下绝对路径：

- `<nimi_data>/apps/<app-id>/data`
- `<nimi_data>/apps/<app-id>/cache`
- `<nimi_data>/apps/<app-id>/tmp`
- active release root, only when an active installed release pointer resolves

`MUST`：runtime-registered developer apps may receive data/cache/tmp roots even
when no ordinary release descriptor or active release exists. This projects
storage truth only; it does not project package install or launch readiness.

`MUST NOT`：apps, Desktop, or SDK consumers must not read `~/.nimi/nimi.json`,
`~/.nimi/runtime/config.json`, or concatenate `<nimi_data>/apps/<app-id>` as an
alternate storage authority. Missing `dataRootRef`, invalid app id/path shape,
symlink/non-directory corruption, or unsupported storage policy must fail
closed with typed storage state/reason.

## K-APP-023 App Package Readiness Truth Projection

`MUST`：`GetAppPackageReadiness(app_id)` 是 Runtime-owned package readiness
truth projection。它读取 Runtime admitted registry / release descriptor、
selected `nimi_data` app layout、active release pointer、与
Runtime-written `install-evidence.json`，并返回 typed
`AppPackageReadinessProjection`：

- `ready` when active release pointer resolves and install evidence is in a
  verified state (`digest-verified` or `bundled-source`) for that active
  release;
- `install_required` when the app is admitted but has no active release;
- `update_required` when the active release is verified but differs from the
  currently bound release descriptor version;
- `repair_required` when active pointer / evidence / digest state is missing,
  corrupt, or not verified;
- `blocked` when Runtime package readiness cannot be evaluated because
  descriptor/storage authority is unavailable.

`MUST NOT`：Desktop, Kit, SDK, or apps must not scan
`<nimi_data>/apps/<app-id>/releases/*/.nimi/install-evidence.json`, parse
Runtime install evidence, or derive package readiness from file existence as
an alternate package authority. SDK may expose typed decoders and compose this
projection with Platform registry/admission rows for developer ergonomics, but
the readiness facts remain Runtime-owned.

## K-APP-024 Account App-Inventory Truth Projection

`MUST`：`GetAccountAppInventory()` 是 Runtime-owned authenticated account
app-inventory truth projection。Runtime resolves the account id from the
current authenticated Runtime account projection; the request must not accept a
renderer- or app-supplied `account_id`.

`MUST`：schema version 2 separates account visibility from local
materialization. `AccountAppInventoryRow.account_state` carries
`verified | entitled | disabled | removed | revoked` semantics; `install_state`
carries `not-installed | installed | adopted-local | removed`. A verified or
entitled row with `not-installed` is valid and is the authority for "Nimi
account verified but not installed" Apps visibility.

`MUST`：install, uninstall, and local-adoption lifecycle mutations may only
change local materialization fields. They MUST NOT create account entitlement
truth or silently upgrade a row to verified.

`MUST`：the response distinguishes an absent projection (`exists=false`) from a
present, validated `AccountAppInventoryRecord`. Corrupt JSON, unsupported
schema, account-id mismatch, invalid row state, invalid install state, or
invalid data policy must fail closed with
`APP_OPEN_LIBRARY_STATE_INVALID`.

`MUST NOT`：Desktop, SDK, Kit, or apps must not read
`~/.nimi/accounts/<account-id>/apps/inventory.json`, derive the authenticated
account directory, or expose a mutation path as an alternate inventory
authority. SDK may expose typed request/response helpers and decoders over this
Runtime surface, but Runtime remains the writer and validator.

## K-APP-025 Local App Adoption Truth Projection

`MUST`：`AdoptLocalApp(root_path, expected_app_id?)` is the only Runtime RPC that
can admit a locally installed external app into the Apps inventory. Runtime
canonicalizes `root_path`, reads `nimi.app.yaml` or `nimi.app.json`, validates
app id, display name, version, entry ref, permission scope ref, storage policy
ref, manifest shape, and local path containment, then writes a Runtime-owned
local adoption record. Any missing/invalid field fails closed before a record
is written.

`MUST`：`ListLocalAppAdoptions()` returns only Runtime-owned local adoption
records. `RemoveLocalAppAdoption(app_id, delete_durable_data_confirmed=false)`
marks the adoption removed and may delete durable data only when the destructive
confirmation is explicit.

`MUST`：local adoption is not Platform public admission. It may create a local
inventory source, but OpenApp must still pass account/session, app data,
permissions, AIConfig, manifest, and storage gates. A local-adopted app without
an authenticated account may be visible as sign-in-required but MUST NOT launch.

`MUST NOT`：Runtime, Desktop, SDK, Kit, or apps must not scan package-manager
install roots, workspaces, source trees, app-local specs, or file presence to
manufacture Apps inventory. Local adoption must not bypass `P-NAPP-*`,
`P-PERM-*`, `S-AICONF-*`, or scoped app binding gates.
