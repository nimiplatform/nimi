# App Messaging Contract

> Owner Domain: `K-APP-*`

## K-APP-001 RuntimeAppService 方法集合

`RuntimeAppService` 方法固定为：

1. `SendAppMessage` — 发送应用间消息
2. `SubscribeAppMessages` — 订阅应用消息事件流
3. `InstallApp` — 触发 Runtime-owned Nimi App install lifecycle（见 `K-APP-011`）
4. `UninstallApp` — 触发 Runtime-owned Nimi App uninstall lifecycle（见 `K-APP-014`）
5. `GetAppStorage` — 读取 app-scoped storage truth projection（见 `K-APP-022`）
6. `GetAppPackageReadiness` — 读取 active release / install evidence package readiness projection（见 `K-APP-023`）
7. `GetAppInstallJob` — 读取单个 install job 的 typed projection（见 `K-APP-012`）
8. `ListAppInstallJobs` — 列出 install job 的 typed projection（见 `K-APP-012`）
9. `WatchAppInstallJobEvents` — 订阅 install job 进度事件流（见 `K-APP-013`）
10. `UpdateApp` — 触发 Runtime-owned Nimi App atomic update lifecycle（见 `K-APP-015`）
11. `HealthRepairApp` — 触发 Runtime-owned Nimi App health/repair lifecycle（见 `K-APP-016`）

App messaging 方法（1–2）与 app install/uninstall/update/repair lifecycle 方法
（3–10）共用 `RuntimeAppService`，但语义独立：lifecycle 方法不承载 app-to-app
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
| **消息回路检测** | Runtime 检测 A→B→A 回路：同一 `(from_app_id, to_app_id)` 对在 **1 秒内双向消息数 > 20** 时，自动熔断该对后续消息 **60 秒**，返回 `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`。熔断期间双方仍可与其他 app 通信 | 防止两个 app 之间形成无限消息回路（fork bomb 风险） |

## K-APP-006 — No Desktop-Local Alternate Message Bus

`RuntimeAppService.SendAppMessage` 是 admitted app-to-app messaging 的唯一
runtime-owned product path。Desktop renderer 不得创建 parallel local message bus
来替代 K-APP 的 runtime auth、rate-limit、loop detection、durable event ordering
或 audit posture。

## K-APP-006a 消费契约状态

AppService 的跨域消费契约状态：

| 消费层 | 当前状态 | Phase 2 启动前必须 |
|---|---|---|
| **SDK 方法投影** | 已 landed | 保持 SendAppMessage / SubscribeAppMessages 的 gRPC→SDK 参数映射、错误投影与 runtime public surface 对齐 |
| **Desktop UI Spec** | 无默认 Desktop 消费 | 若 Desktop 需直接使用 K-APP 路径（跨进程、审计场景），创建相应 UI spec |

> **设计完整性注意**：K-APP-001~005 定义了完整的消息传递模型。K-APP 的
> gRPC 路径已经存在 SDK 投影，但仍不是 Desktop shell 的默认 UI 消息面。

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

## K-APP-018 Runtime-Mediated File-API Surface And Path Enforcement

**Background fact (grep-evidence).** `K-APP-001` at this file lines
5–21 admits the `RuntimeAppService` "方法固定为" enumeration as exactly
nine methods: `SendAppMessage`, `SubscribeAppMessages`, `InstallApp`,
`UninstallApp`, `GetAppInstallJob`, `ListAppInstallJobs`,
`WatchAppInstallJobEvents`, `UpdateApp`, `HealthRepairApp`. **None of
those nine methods is a file-API method.** `K-APP-018` therefore
admits a NEW Runtime-mediated file-API surface; it does NOT inherit a
pre-existing file-API surface from `K-APP-001` or any other admitted
`K-APP-*` rule.

`MUST` (surface admission — packet-time-frozen method set).
`RuntimeAppService` admits a Runtime-mediated file-API method set
scoped to the Nimi-mediated `app-local-drafts` qualifier (`P-PERM-011`
on the Platform side; `P-NAPP-027` `nimi-mediated-default` storage
posture). The admitted method set is exactly the following five
methods, frozen as part of this rule:

1. `ReadAppLocalDraftFile` — read bytes from a file under the calling
   app's Nimi-owned data root. Request carries the calling app's
   `app_id` (resolved from the authenticated `RuntimeAuthService`
   session per `K-APP-005` 应用认证), a relative `path` under the
   calling app's data root, and an optional byte `range`. Reply carries
   the `bytes` payload, the resolved typed `qualifier`
   (`app-local-drafts`), and a fail-closed `reason_code` /
   `failure_detail` on the unhappy path.
2. `WriteAppLocalDraftFile` — write bytes to a file under the calling
   app's Nimi-owned data root. Request carries `app_id`, relative
   `path`, the `bytes` payload, and a typed `mode` enum
   (`overwrite` / `create-new` / `append`). Reply carries the typed
   write outcome and a fail-closed `reason_code` /
   `failure_detail` on the unhappy path. The 64 KB per-message size
   cap from `K-APP-005` 消息大小限制 does not apply to file payloads
   on this surface; chunking strategy is a transport-level concern
   below the contract, not a re-introduction of `K-APP-005` 's
   messaging-payload cap.
3. `ListAppLocalDraftDir` — list directory entries under the calling
   app's Nimi-owned data root. Request carries `app_id` and a
   relative `path`. Reply carries a typed list of
   `{name, kind, size, modified_at}` entries plus a fail-closed
   `reason_code` / `failure_detail` on the unhappy path.
4. `DeleteAppLocalDraftFile` — delete a file or empty directory under
   the calling app's Nimi-owned data root. Request carries `app_id`
   and a relative `path`. Reply carries the typed delete outcome and a
   fail-closed `reason_code` / `failure_detail`. Recursive directory
   deletion outside the typed `data/` / `cache/` / `tmp/` subtree is
   out of scope of this admission and remains rejected via
   `out_of_data_root` (below).
5. `MoveAppLocalDraftFile` — move/rename a file under the calling
   app's Nimi-owned data root. Request carries `app_id`, relative
   `source_path`, and relative `destination_path`. Both paths MUST
   resolve under the same calling app's data root; the destination
   path leaving the calling app's root is a fail-closed
   `out_of_data_root`. Reply carries the typed move outcome and a
   fail-closed `reason_code` / `failure_detail`.

**Amendment-clause to `K-APP-001`.** The five methods above extend
`K-APP-001` "方法固定为" enumeration at lines 5–21 of this file. The
extension is admitted INSIDE `K-APP-018`; `K-APP-001` 's rule body
remains unchanged. Future Runtime-mediated file-API method admissions
are subject to a separate admitting rule and do NOT enter
`RuntimeAppService` 's admitted method set by implication of this
clause.

`MUST` (path-enforcement invariant). Every method in the file-API set
admitted above MUST fail closed with typed reason `out_of_data_root`
when the resolved path leaves the calling app's
`<nimi_data>/apps/<app_id>/` root or enters another app's root
`<nimi_data>/apps/<other_app_id>/`. The escape modes covered by this
invariant include — non-exhaustively — parent traversal segments
(`..`) that escape the root, absolute paths that resolve outside the
root, symbolic-link traversal that crosses out of the root, and any
heuristic "close-enough" resolution that maps an escaping path to a
permitted neighbor inside the root. Path-enforcement applies to the
admitted five-method set; future surface extensions are subject to
their own admitting rule and do not inherit this invariant by
omission.

`MUST` (cross-references). `K-APP-018` cross-references `P-NAPP-027`
(Platform-side storage-posture admission; the Nimi-mediated data root
tree this surface resolves against) and `P-PERM-011` (Platform-side
qualifier semantics for `file.read.scoped` / `file.write.scoped` with
`qualifier: app-local-drafts`). The Runtime-side enforcement of the
qualifier semantics is THIS rule; the Platform-side admission of the
qualifier and root binding is `P-PERM-011`. The two rules are
intentionally parallel; neither redefines the other.

**Deferral acknowledgement (not admitted here).** Cross-app file
access — a method call from app A resolving into
`<nimi_data>/apps/<other_app_id>/` belonging to app B — remains
deferred to a future sub-topic via the `P-PERM-006` cross-app
authorization flow with explicit user confirmation at access time.
This rule does NOT admit cross-app file access; every cross-app path
attempt on the admitted five-method surface fails closed with
`out_of_data_root` until that future sub-topic admits the typed
cross-app flow shape on this surface.

`MUST NOT`. The Runtime-mediated file-API surface MUST NOT silently
remap an escaping path to a permitted neighbor inside the root. The
fail-closed behavior is `out_of_data_root`, not a remapped success.
The five admitted methods MUST NOT extend their reach to
`storage_policy_ref.kind: app-owned-os-storage` admissions
(`P-NAPP-027` / `P-NAPP-028`); on app-owned-os-storage admissions the
app uses OS-level file IO directly, and `K-APP-018` 's surface does
not mediate that path. Surface MUST NOT collapse the five typed
methods into a generic "file op" call; each method is an admitted
contract face.

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
`data`, `review`, `response`) are exactly the eight names the parent
topic 's wave-3 health surface enumerates. Each dimension produces
exactly one typed sub-state per `AppHealth` projection emission; the
sub-state vocabulary above is the admitted enum for that dimension.

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

**Carry-forward from wave-A2 typed-reason reuse note.** The wave-A2
typed reason `os_storage_disclosure_missing` (`P-NAPP-028` at
`.nimi/spec/platform/kernel/nimi-app-admission-contract.md` MUST NOT
clause) covers both "missing under app-owned-os-storage" and
"populated under nimi-mediated-default" admission-time invariants.
`K-APP-019` 's `storage` dimension surfaces the same typed reason at
projection time for the app-owned-os-storage branch; the projection
layer MUST surface a differentiated user message between
"disclosure missing" and "disclosure cross-populated" cases using
typed message text (the typed reason itself is shared by admission
intent — this rule does not invent a new typed reason in wave-C).

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
| `forced_update_required` | bool | true when the parent topic containment-and-response forced-update / remediation mechanism has been engaged and a remediated version is required before next launch |
| `rollback_available` | bool | true when a previous admitted release descriptor remains eligible per the descriptor 's `rollback_eligibility` (`P-NAPP-018`) and is materializable |
| `publisher_suspended` | bool | true when the publisher namespace is under suspension per the parent topic containment-and-response publisher-suspension mechanism |
| `report_received` | uint32 (typed-counted) | typed monotonic counter of post-release community reports received against this descriptor; `0` is "no report"; a non-zero count indicates the community report route has delivered at least one report and is the support-UX entry into report-driven detection |

Apps consume this projection. The Apps surface MUST NOT compute these
typed fields from raw data (raw review-state polling, raw descriptor
diffing, raw publisher-status fetches); Runtime owns the projection
and Apps reads it as typed truth.

`MUST` (cross-references). `K-APP-020` cross-references `P-ECO-004`
(`kill-switched` review-state at
`.nimi/spec/platform/kernel/nimi-ecosystem-contract.md:48-67`; the
projection 's `kill_switch_active` is the runtime-side projection of
that admitted state) and the parent topic containment-and-response
mechanisms (kill-switch, forced-update, rollback, publisher-
suspension, community-report route) at
`.nimi/topics/ongoing/2026-05-22-nimi-apps-third-party-distribution-and-admission/containment-and-response.md`.
`K-APP-020` does NOT redefine any `P-ECO-004` state or any parent
topic containment-and-response mechanism; it projects them.

`MUST NOT`. `K-APP-020` MUST NOT extend the five-field set above
under this rule; the typed field set is closed at wave-C admission.
A new response-state field is a separate authority-bearing
admission event. `K-APP-020` MUST NOT silently coerce one typed
field 's value from another (e.g. inferring
`forced_update_required: true` from `kill_switch_active: true`); the
five fields are orthogonal projections. The Apps surface MUST NOT
read raw P-ECO / containment-and-response state directly to compute
these fields; the projection seam is `K-APP-020`.

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

> 实现注记：`K-APP-018` 五方法的 `proto/runtime/v1/app.proto` 物化与
> `K-APP-019` / `K-APP-020` typed projection 物化随后续 Runtime app
> 实现 wave 落地；本组规则是其 normative 契约面。`K-APP-019` derivation
> table 与 `K-APP-021` state-to-action mapping table 是 packet-time
> frozen，不接受 free-form 投影层重新解释。

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
