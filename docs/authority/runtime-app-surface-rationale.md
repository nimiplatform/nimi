# Runtime App Surface - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/app-surface.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/app-lifecycle-contract.md -->

# Runtime App Lifecycle Contract

> Owner Domain: `K-APP-*`

Runtime K-APP owns PC-local principal/record lifecycle. It does not own
Platform package format, K-GRANT grant state, K-PLOCAL process/session facts,
account custody, or operation-domain policy.

All mutations require Runtime-derived `local_app_control` on the current
protected Desktop connection. Public TCP, app id, caller enum, renderer
metadata, request confirmation, endpoint, environment, or portable bearer is
denied before target parsing.

## K-APP-011 Immutable Local-app Admission Posture

The 0K wire/schema reserves immutable principal and record lifecycle fields,
but positive install/import is typed unavailable until 0P defines signed
package and attestation mapping and Lane P implements it. No existing catalog
download, local adoption, source directory, or unsigned package path may create
an immutable principal or runnable record.

Any retained `InstallApp` symbol during the atomic wire migration is inactive
and must fail with the stable immutable-profile-unavailable reason. The final
package/import RPC shape is owned by 0P and cannot reshape the 0K principal,
record, grant, launch, or session contracts.

## K-APP-012 App Lifecycle Job Projection

Lifecycle job projections are typed owner results, not admission truth. A job
must carry stable id, kind, state, phase, target record/principal refs where
available, generation, reason code, redacted detail, and retryability. A future
immutable job remains `unavailable` before 0P/P; it cannot report installed,
updated, or runnable success.

## K-APP-013 App Lifecycle Event Stream

Lifecycle events carry monotonic sequence and full typed job snapshot. They do
not carry grant, credential, launch lease, process, session proof, or domain
operation truth. An unavailable immutable lifecycle emits an explicit terminal
failure rather than synthetic progress or success.

## K-APP-014 Remove And Tombstone Lifecycle

Removing an active immutable record or revoking a development authorization
transactionally revokes its leases/sessions and permanently tombstones the
principal. Retained durable data remains keyed to the tombstone and is
delete-only after fresh presence. Reinstall or re-authorization allocates a
new non-reused principal and inherits no permission decision, storage, app-scoped audience,
session, or audit subject.

Before 0P/P, immutable remove/uninstall is typed unavailable because no 0K
positive immutable install exists. Development revoke is active through the
Developer Mode lifecycle.

## K-APP-015 Immutable Update And Promotion Posture

Positive immutable update and imported-to-verified promotion are typed
unavailable until 0P/P. The frozen semantic seam is exact: eligible update or
promotion preserves `local_app_principal_id`, increments record/provenance or
release generation as applicable, invalidates current leases/sessions, and
never creates or widens a grant. Signer/attestation mapping and atomic package
promotion remain 0P authority.

## K-APP-016 Immutable Repair Posture

Immutable repair/reinstall cannot be active before the 0P package and fixed-
host lifecycle exists. Requests fail with typed immutable-profile-unavailable;
they do not download catalog bytes, scan local directories, or revive a
tombstoned principal. Development recovery uses supervised rebuild/restart and
new K-PLOCAL lease/session, not an immutable repair alias.

## K-APP-017 Prepare Local-app Launch

`PrepareLocalAppLaunch` is the sole local-app launch preparation RPC. It is
callable only by Runtime-derived `local_app_control` and selects one active
record by opaque `local_app_record_id`. Runtime resolves OS-user anchor,
principal, provenance revision, release-or-project generation, capability
fingerprint, execution profile, host/payload digest slots, current account,
and boot epoch.

Success creates one short-lived K-PLOCAL launch lease and returns only an
opaque host-private `local_app_bootstrap` plus expiry. It does not launch a raw
executable, create a session/grant, or return principal/account/provenance
details. `BindLocalAppProcess` and request-empty `OpenLocalAppSession` complete
the protected process/session path under K-PLOCAL-008.

The positive 0K profile is an approved, supervised `local_development` record.
Immutable execution profiles return typed unavailable until 0P/P. A shortcut
invokes the verified Nimi/Desktop launcher with a record selector; it never
points to app code.

## K-APP-018 Runtime-mediated File API Non-admission

No generic local-app file API is admitted by 0K. Principal-keyed private
storage exists as an owner seam, but apps cannot convert it into raw filesystem
or path authority. Any future typed file operation must resolve the current
principal and grant and must not expose another principal's root.

The K-APP-032 exact JSON storage operations are not a generic file API. They do
not admit raw bytes, roots, absolute paths, directory listing, range reads,
move, mode, or arbitrary delete, and therefore do not weaken this prohibition.

## K-APP-026 Protected Local-app Control Protocol

Lifecycle and development mutations consume the live protected Desktop
connection, `local_app_control`, current OS-user anchor/account/boot epoch,
exact target generation, and any presence challenge required by the Nimi-owned
operation being requested in one service-owned transaction. The zero-permission
local-project run decision is completed by the foreground verified Desktop
confirmation UX itself; it MUST NOT add a second Windows Hello, OS credential,
or Realm reauthentication challenge. Returned evaluation/job/bootstrap ids are
correlation only.

The logical role covers local-app lifecycle UX coordination, future permission UX,
protected launch, and development supervision. It does not generalize
`OpenDesktopSession` account control and creates no portable controller
credential. A future controller requires a separate transport/identity
admission while consuming the same logical role.

## K-APP-027 Local Development Lifecycle

Production Developer Mode is the sole positive 0K lifecycle. Enabling the
global mode grants nothing. `EvaluateLocalDevelopmentProject` resolves the
canonical project-root file identity, declared app id, capability fingerprint,
current account, and fixed shell/entry policy without creating authority.
`DecideLocalDevelopmentProject` consumes exactly `run_once | allow_project`
through the foreground verified Desktop approval UX, including the native-code
risk acknowledgement, then creates a new isolated development
principal/record with zero user permissions. A developer manifest may include closed,
typed `local_development.runtime_scoped_binding_requests` in the capability
fingerprint. Such a declaration is request eligibility only: it grants no
operation, binding, account authority, or Runtime Agent turn authority. The
admitted public permission flow and a Runtime-issued scoped binding remain required.

Every supervised host process uses `PrepareLocalAppLaunch`, a new process bind,
and a new common local-app session. Controlled HMR/rebuild/restart and Runtime
restart may preserve the durable authorization while rotating technical state.
Mode off, account switch/logout, supervisor end, and Runtime replacement revoke
live leases, process bindings, and sessions without expiring an unchanged
`allow_project` consent. Explicit revoke, copied/changed project, capability
expansion, shell/entry/origin mismatch, or uncontrolled output invalidates that
consent and requires fresh approval. Preserved consent never auto-runs a host.
When a `run_once` supervisor run reaches any terminal condition, Runtime
tombstones that principal and marks its record removed; another run requires a
fresh decision and new non-reused principal/record. An `allow_project` consent does
not transfer across account switch: its live carrier is revoked, it remains
bound to the original account; returning to that account may reuse the unchanged
consent without a new project decision or credential challenge while still
creating new technical carriers.

The development principal may use a controlled production account only through
the common K-GRANT/K-ACCSVC/owner-operation envelope. It receives no credential,
portable proof, stronger permission, or persistent Nimi-managed autostart.

## Fact Sources

- `local-app-principal-record-contract.md` — `K-APP-028..K-APP-031`
- `tables/local-app-principal-record-schema.yaml`
- `protected-local-session-contract.md` — `K-PLOCAL-*`
- `account-session-contract.md` — `K-ACCSVC-*`
- `grant-service.md` — `K-GRANT-*`
- `config/platform-nimi-app-local-development-admission.yaml`

---

<!-- source: .nimi/spec/runtime/kernel/app-messaging-contract.md -->

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
5. `InstallApp` — immutable package seam；0K 固定返回 typed unavailable（见 `K-APP-011`）
6. `UninstallApp` — immutable package seam；0K 无 positive materialization（见 `K-APP-014`）
7. `GetAppStorage` — 读取 app-scoped storage projection（见 `K-APP-022`）
8. `GetAccountAppInventory` — 读取 authenticated account app-inventory projection（见 `K-APP-024`）
9. `GetAppPackageReadiness` — 读取 opaque package seam typed-unavailable projection（见 `K-APP-023`）
10. `GetAppInstallJob` — 0K typed-unavailable job seam（见 `K-APP-012`）
11. `ListAppInstallJobs` — 0K typed-unavailable job seam（见 `K-APP-012`）
12. `WatchAppInstallJobEvents` — 0K typed-unavailable event seam（见 `K-APP-013`）
13. `UpdateApp` — immutable update seam；0K 固定返回 typed unavailable（见 `K-APP-015`）
14. `HealthRepairApp` — immutable repair seam；0K 固定返回 typed unavailable（见 `K-APP-016`）
15. `PrepareLocalAppLaunch` — 创建 single-use protected launch lease（见 `K-APP-017`）
16. `BindLocalAppProcess` — 将 exact native process 绑定到 current lease（见 `K-PLOCAL-008`）

App messaging 方法（1–2）与 lifecycle intent/package-seam/local-app launch 方法
（3–16）共用 `RuntimeAppService`，但语义独立：lifecycle / projection 方法不承载
app-to-app message broker 语义，messaging 方法不承载 package/launch
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
| **应用认证** | `SendAppMessage` 必须从当前已认证连接派生发送主体；ordinary/external callers 使用各自已 admitted 的会话，`LOCAL_APP` 只使用 host-injected `local_app_session`，Runtime 从 principal record 派生 `from_app_id` 并拒绝请求自报不一致。LOCAL_APP 不持有 token、bearer 或可移植凭据。未认证或不匹配请求返回 `UNAUTHENTICATED` | 防止任意进程冒充已注册应用，并保持 local-app principal/session authority 不泄露 |
| **消息大小限制** | `payload` Struct 序列化后不得超过 **64 KB**。超限返回 `INVALID_ARGUMENT` + `APP_MESSAGE_PAYLOAD_TOO_LARGE` | 防止单条消息耗尽 Runtime 内存 |
| **发送速率限制** | ordinary caller 按已认证 sender identity、`LOCAL_APP` 按 `local_os_user_anchor + local_app_principal_id` 的发送速率上限为 **100 条/秒**（滑动窗口）；app ID 仅作路由标签，不能合并两个 principal 的预算。超限返回 `RESOURCE_EXHAUSTED` + `APP_MESSAGE_RATE_LIMITED` | 防止消息风暴、DoS 与同 app-id principal 预算串扰 |
| **消息回路检测** | Runtime 检测 A→B→A 回路：同一无序 app pair 在 **1 秒内方向切换达到 20 次** 时，自动熔断该 pair 后续消息 **60 秒**，返回 `FAILED_PRECONDITION` + `APP_MESSAGE_LOOP_DETECTED`。单个请求后同向产生多个 streaming / presentation 投影只形成一次方向切换，不得按投影数量误判为回路；熔断期间双方仍可与其他 app 通信 | 防止两个 app 之间形成无限 ping-pong 回路，同时保留合法的一对多流式投影 |

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

---

<!-- source: .nimi/spec/runtime/kernel/app-projection-contract.md -->

# Runtime App Projection Contract

> Owner Domain: `K-APP-*`

Runtime-owned app health, response-state, next-action, storage, package
readiness, account inventory, and local-record projection authority.

This file is a semantic split from `app-messaging-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

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
`.nimi/spec/platform/app-ecosystem.authority.yaml:103-118`
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
`.nimi/spec/platform/app-ecosystem.authority.yaml` MUST NOT
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
response field from another or from host execution dossiers.

`MUST NOT`. `K-APP-020` MUST NOT extend the five-field set above
under this rule; the typed field set is closed. A new response-state
field is a separate authority-bearing
admission event. `K-APP-020` MUST NOT silently coerce one typed
field 's value from another (e.g. inferring
`forced_update_required: true` from `kill_switch_active: true`); the
five fields are orthogonal projections. The Apps surface MUST NOT
read raw P-ECO, descriptor, publisher, report, or host task state directly
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

`MUST`：app-private storage is Runtime-owned principal-scoped truth. A
local-app session resolves its opaque principal internally; the request does
not accept `app_id` or a principal override. Runtime derives the following
roots:

- `<nimi_data>/apps/<local-app-principal-id>/data`
- `<nimi_data>/apps/<local-app-principal-id>/cache`
- `<nimi_data>/apps/<local-app-principal-id>/tmp`
- immutable release root is absent in 0K; a later 0P/P may add its positive
  projection without changing the principal-keyed data/cache/tmp roots

`MUST`：an active development principal may receive data/cache/tmp roots without
an immutable release. Same-app-id principals remain isolated. Tombstoned data
is not rebound to a new authorization and is delete-only after fresh presence.

`MUST NOT`：apps, Desktop, or SDK consumers must not read `<runtime_owner_state_root>/nimi.json`,
`~/.nimi/runtime/config.json`, or concatenate `<nimi_data>/apps/<app-id>` as an
alternate storage authority. Missing `dataRootRef`, invalid principal/path shape,
symlink/non-directory corruption, or unsupported storage policy must fail
closed with typed storage state/reason.

## K-APP-032 Protected Local-app JSON Storage Operations

RuntimeAppService owns exactly three local-app storage methods:
`ReadLocalAppStorageJson`, `WriteLocalAppStorageJson`, and
`RemoveLocalAppStorageJson`. They are admitted only on `local_app_host` after
the current process-bound session, principal and account partition are
revalidated. This is the `app.private_storage` base entitlement: it creates no
permission decision, user prompt, selector or grant row. The request carries
only `relative_path` and, for write, one JSON value. It carries no app id,
principal id, account id, root, absolute path, quota, permission id, decision
id, credential, endpoint, or method selector.

Runtime resolves
`<nimi_data>/apps/<current-local-app-principal-id>/data` from K-APP-022,
requires an ASCII slash-separated relative `.json` path of at most 240 UTF-8
bytes, rejects empty/dot/parent/absolute/backslash/colon segments, and rejects
symlink or non-regular components. A JSON document is at most 256 KiB and the
durable principal partition is at most 16 MiB. Writes are serialized and
atomically replaced; remove is idempotent for an absent entry.

Read/write responses contain only the JSON value, `size_bytes`, and canonical
reason code. Remove contains only `removed` and reason code. No response,
error detail, audit projection, log, Kit/SDK projection, or renderer payload may
contain a root or absolute path. Runtime emits
`APP_STORAGE_PATH_INVALID`, `APP_STORAGE_ENTRY_NOT_FOUND`,
`APP_STORAGE_QUOTA_EXCEEDED`, or `APP_STORAGE_UNAVAILABLE` as applicable and
never falls back to `GetAppStorage`, public TCP, Node filesystem access, app-id
partitioning, or a generic file API.

## K-APP-023 App Package Readiness Projection

0K admits `GetAppPackageReadiness` only as an opaque typed-unavailable seam.
The response identifies `blocked / immutable_profile_unavailable` without
reading or asserting an active release, install job, install evidence, package
root, update candidate, rollback candidate, or repair state. It cannot create a
principal/record and cannot authorize launch.

`MUST`：Runtime derives the blocked response without accepting app ID, path,
descriptor, digest, release, or account selectors as package truth. A later 0P
may populate only the already frozen `immutable_lineage_id`, opaque provenance
attestation refs/revision, `execution_profile_ref`, `host_executable_digest`,
and `payload_root_digest` fields. It must not reshape the 0K principal, record,
grant, lease, process, or session schema.

`MUST NOT`：Runtime, Desktop, Kit, SDK, or apps must scan a package directory,
active pointer, install evidence, or file existence in 0K. `ready`,
`install_required`, `update_required`, `repair_required`, package jobs and
positive immutable launch are unavailable until 0P/P is independently admitted.

## K-APP-024 Account App-Inventory Projection

`MUST`：`GetAccountAppInventory()` 是 Runtime-owned authenticated account
app-inventory projection。Runtime resolves the account id from the
current authenticated Runtime account projection; the request must not accept a
renderer- or app-supplied `account_id`.

`MUST`：schema version 2 separates account visibility from local
materialization. `AccountAppInventoryRow.account_state` carries
`verified | entitled | disabled | removed | revoked` semantics; `install_state`
carries `not-present | local-record-active | local-record-dormant | removed`.
Account eligibility and PC-local principal/record state remain separate and
must not be collapsed into one installed boolean.

`MUST`：immutable/development lifecycle mutations may only
change local materialization fields. They MUST NOT create account entitlement
truth or silently upgrade a row to verified.

`MUST`：the response distinguishes an absent projection (`exists=false`) from a
present, validated `AccountAppInventoryRecord`. Corrupt JSON, unsupported
schema, account-id mismatch, invalid row state, invalid install state, or
invalid data policy must fail closed with
`PROTOCOL_ENVELOPE_INVALID`.

`MUST NOT`：Desktop, SDK, Kit, or apps must not read
`~/.nimi/accounts/<account-id>/apps/inventory.json`, derive the authenticated
account directory, or expose a mutation path as an alternate inventory
authority. SDK may expose typed request/response helpers and decoders over this
Runtime surface, but Runtime remains the writer and validator.

## K-APP-025 Retired Local Adoption Boundary

The predecessor local-adoption family is retired and must be removed from
Proto, generated clients, Runtime handlers/stores, SDK/Kit exports, Desktop UX,
tests, and inventory states in the atomic public wire epoch. It has no active
success behavior and no alias.

Mutable source enters through K-APP-027 Developer Mode and creates a fresh
isolated development principal/record only after Runtime presence and approval.
Immutable bytes remain typed unavailable until 0P/P. Package-manager roots,
workspace/source scanning, app-local manifests, app id, file presence, process
liveness, or an inventory-only record cannot create runnable truth.

---

<!-- source: .nimi/spec/runtime/kernel/local-app-principal-record-contract.md -->

# Local App Principal And Record Contract

> Owner Domain: `K-APP-*`

## Scope

This contract owns only the PC-local `LocalAppPrincipal` and
`LocalAppRecord` lifecycle seam. Protected launch/process/session facts remain
`K-PLOCAL-*`; future Runtime-owned permission decisions follow `K-GRANT-*`;
account
and credential custody remains `K-ACCSVC-*`; operation and resource semantics
remain with their existing owners.

## K-APP-028 Local OS-user Partition

Every principal and record is partitioned by a Runtime-derived
`local_os_user_anchor`. Its sole source is the same-OS
`local_os_user_anchor_derivation` in
`tables/protected-local-os-profiles.yaml`; it is never accepted from a request,
environment variable, project, package, Desktop, SDK, or app. The admitted
Windows row remains the verified interactive-user SID established by
`K-PLOCAL-003`; unadmitted platform rows are requirements only.

The first Runtime data root admits exactly one active anchor. A different SID
under the Windows row, or a different same-OS principal/login-session anchor
under any future admitted row, fails closed before principal, record, private
storage, permission, autostart, launch, session, or audit state can be read or
mutated. Fast User Switching cannot reuse the prior anchor. This is a single-PC
partition and does not create device enrollment, cross-PC recovery, or cloud
truth.

## K-APP-029 Stable Local Security Principal

Runtime allocates a random, non-reused opaque `local_app_principal_id` for
each admission instance. The identifier, rather than `app_id` or provenance,
is the security subject for app-private storage, app-scoped audience/access,
grants, sessions, and audit.

An immutable principal carries an opaque `immutable_lineage_id`. Its package
key and attestation mapping is unavailable until 0P, but 0P may only populate
the frozen field. A development principal carries a Runtime-owned
`development_authorization_id`, canonical project-root file identity, and the
declared `app_id`. Exactly one principal-kind anchor is present.

Update and exact imported-to-verified promotion preserve the principal.
Uninstall or project-authorization revoke tombstones it permanently. Any
reinstall or re-authorization, including the same signer, project, or app id,
allocates a new principal and inherits no permission decision, storage, audience, session,
or audit identity. Retained tombstoned data is delete-only after fresh
presence; rebind and migration are not admitted.

`app_id` remains a display/routing identifier. A development project that
declares the same `app_id` as an immutable app, or immutable records with
different lineage, remain isolated principals.

## K-APP-030 Lifecycle Record And Opaque Package Seam

`LocalAppRecord` binds one principal to current provenance and lifecycle. It
contains the closed `verified | user_imported | local_development` trust
class, opaque provenance-attestation references, `provenance_revision`,
install-or-project generation, active capability fingerprint, opaque
`execution_profile_ref`, host executable digest slot, payload-root digest
slot, and lifecycle state.

The record contains no grant boolean, permission result, account owner,
session proof, or operation-policy decision. Immutable positive install,
update, and promotion are typed unavailable until 0P defines how signed
package and Platform-attestation inputs map into the already frozen opaque
fields. No package authority may reshape this schema.

Promotion increments `provenance_revision` and transactionally invalidates
all current launch leases and local-app sessions without creating or widening
a grant. A new session revalidates any still-compatible grant. Delisting
changes discovery only; security revoke blocks execution and cannot fall back
to another provenance class.

## K-APP-031 Owner Separation And Resolver

The principal store and lifecycle-record store are separate from the
account-grant store and protected launch/session store. A resolver may join
them into an immutable per-operation context, but it cannot mutate another
owner's store or cache an authorization result.

Private preparation is permitted before public cutover only when unreachable
from production, unregistered as a public RPC/export, and not an active second
store. Dual read, dual write, app-id positive fallback, and record-embedded
grant state are forbidden.

Account-scoped app-private data uses `local_os_user_anchor + account_id +
local_app_principal_id`; machine-local principal/record identity itself is not
account-owned. Canonical LocalAgent, `ConversationAnchor`, transcript,
presentation, and Agent-memory identity remain RuntimeAgentService/Cognition
truth and are not repartitioned or owned by the app principal.

## Fact Sources

- `tables/local-app-principal-record-schema.yaml`
- `config/platform-nimi-app-local-trust-classes.yaml`
- `protected-local-session-contract.md` — `K-PLOCAL-*`
- `grant-service.md` — `K-GRANT-*`
- `account-session-contract.md` — `K-ACCSVC-*`
- `runtime-agent-service-contract.md` — `K-AGCORE-*`
- `.nimi/spec/cognition/standalone-services.authority.yaml` — `C-APMEM-*`

---

<!-- source: .nimi/spec/runtime/kernel/scoped-app-binding-contract.md -->

# Scoped App Binding Contract

> Owner Domain: `K-BIND-*`

## K-BIND-001 服务职责与归属

scoped app binding 是 Runtime-issued 的 opaque capability，指向一个具体的 app / agent / window / anchor relation。它由 `RuntimeAccountService.IssueScopedAppBinding` 与 `RevokeScopedAppBinding` 拥有（见 `account-session-contract.md` `K-ACCSVC-002`）。

scoped binding 不是 account truth，不可被赎回为 durable subject、account、Realm token、refresh token、或 Runtime app session 权威。

Workspace knowledge binding is not a scoped app binding relation and must not
reuse Avatar / agent / window / anchor tuple semantics. WORKSPACE_PRIVATE
knowledge access uses the workspace-specific binding authority in
`workspace-binding-contract.md` (`K-BIND-016..024`).

The removed public token accessor identity is reserved. Scoped binding never
carries or redeems account bearer material;
all local app Realm access uses the Runtime-mediated broker.

Default Nimi Avatar launch is no longer a Desktop scoped-binding consumer.
Avatar default launch is governed by `.nimi/spec/avatar/embodiment-surface.authority.yaml`
`K-NAV-SHELL-FIRST-PARTY-RUNTIME-*` and uses local first-party Runtime account
projection. This contract continues to govern explicit binding-only / embedded /
delegated / external capability consumers.

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

Invariant: no local consumer may redeem binding material into durable account,
session, subject, bearer, or token truth. First-party, bundled, local-app and
binding-only callers all use Runtime-mediated operations; binding
is an authorization relation, never a token surface.

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
- 调用方必须是 Runtime owner policy 已登记的 local first-party app instance；
  `caller.app_id` / `caller.app_instance_id` 必须与待发放 binding relation 精确
  一致。Third-party `LOCAL_APP`, including local-development projects, is
  categorically ineligible for this binding and uses only its process-bound
  session plus any separately admitted public permission decision.
- account state 不为 `authenticated` 时，binding 发放必须 fail-close（reason `account_unavailable`）。
- account state 从 `authenticated` 转出时，active/issued binding 必须 revoke 或 suspend；覆盖 custody unavailable、refresh failure / reauth-required、logout、switch、daemon restart no-custody、policy revoke。
- 切换 / logout / reauth-required / custody-unavailable 期间，正在飞的 binding issuance 必须取消并发出 `binding.revoked` reason `account_expired` / `user_switch` / `logout` / `account_unavailable`。

## K-BIND-011 与 Grant Service 的关系

The former public credential-grant family is physically removed.
External-principal binding cannot interoperate with or substitute for this
scoped local binding contract:

- admitted first-party scoped binding 必须由 `RuntimeAccountService.IssueScopedAppBinding` 发出，subject 由 Runtime 内部派生。Third-party `LOCAL_APP` uses its separate process-bound session and exact account+principal grant and never mints a first-party scoped binding.
- no public external-principal grant or caller-supplied `subject_user_id`
  issuance path is admitted;
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

任何场景下都不得回退到 anonymous subject、shared auth、Realm direct identity
bootstrap、fixture mode 或 public token RPC。Full first-party apps and default
Avatar use the same Runtime-mediated broker as every local app; no binding or
caller class permits an app/host bearer fallback.

---

<!-- source: .nimi/spec/runtime/kernel/auth-service.md -->

# Auth Service Contract

> Owner Domain: `K-AUTHSVC-*`

## K-AUTHSVC-001 服务职责

`RuntimeAuthService` owns binding-only app/external-principal session lifecycle
and the common process-bound local-app identity session. The former public
credential-grant family has been physically removed. Protected operation
decisions are Runtime-private and require the exact verified origin, current
separate grant and operation-owner policy.

`RuntimeAuthService` **不负责** local machine account session、login lifecycle、custody、refresh、logout、user switch、daemon restart recovery、或首方 scoped app binding；这些权威由 `RuntimeAccountService`（`K-ACCSVC-*`，见 `account-session-contract.md`）拥有。Protected-local origin、Desktop process verification 与 control-session authority 由 `K-PLOCAL-*` 拥有，Auth service 只消费其 immutable origin context。

## K-AUTHSVC-002 方法集合（权威）

`RuntimeAuthService` 方法固定为：

1. `RegisterApp`
2. `OpenSession`
3. `RefreshSession`
4. `RevokeSession`
5. `RegisterExternalPrincipal`
6. `OpenExternalPrincipalSession`
7. `RevokeExternalPrincipalSession`
8. `OpenDesktopSession`（仅 `desktop_control`）
9. `OpenLocalAppSession`（request-empty；仅已绑定 launch lease/process/record 的 `local_app_bootstrap`）
10. `RenewLocalAppSession`（request-empty；仅当前 exact `local_app_host` / `local_app_session`）

两种 protected session-open request 均为空。`OpenDesktopSession` keeps
Desktop account-control semantics; `OpenLocalAppSession` is the single
third-party app session path. Neither accepts app id, caller class, source host,
principal, trust, lease, process, account, grant, or portable proof override,
and neither returns a portable authorization bearer.
`RenewLocalAppSession` is not another open path: it atomically replaces only
the current Runtime-private short-lived technical session on the same verified
host connection after complete revalidation. It never changes origin role,
reconsumes a lease, or repeats durable consent, and it returns only the same
sanitized session posture projection.

## K-AUTHSVC-003 RegisterApp 最小约束

- `app_id` 必填且不可为空。
- `app_instance_id` 在客户端缺省时可由服务端分配。
- `mode_manifest` 必须按 proto 枚举值校验，不允许未知值透传。
- 无论 registry 或 manifest gate 是否通过，`RegisterApp` 和
  随后的 `OpenSession` 只建立 `BINDING_ONLY`。其 app id、manifest、session
  id/token 或 source-host metadata 不得产生 account、broker、AI、artifact、
  realtime、media、lifecycle 或 local-app launch 权限；完整矩阵由
  `K-PLOCAL-001` 与 `tables/protected-local-rpc-transport-matrix.yaml` 拥有。

## K-AUTHSVC-004 OpenSession / RefreshSession TTL 约束

- `ttl_seconds` 必须落在服务端配置区间 `[sessionTtlMinSeconds, sessionTtlMaxSeconds]` 内（默认 `[60, 86400]` 秒，可通过 `K-DAEMON-009` 配置）。
- 超出区间必须 fail-close（`INVALID_ARGUMENT`）。
- `RefreshSession` 仅对仍有效的 `session_id` 生效。
- 本节 TTL 仅适用于 non-privileged binding/external-principal session；
  续签不升级 origin role，也不创建 portable protected privilege。

## K-AUTHSVC-005 Revoke 幂等语义

- `RevokeSession` 与 `RevokeExternalPrincipalSession` 必须幂等。
- 重复撤销返回 `OK`，不得泄露“是否曾存在”细节。

## K-AUTHSVC-006 External Principal 注册与开会话

- `RegisterExternalPrincipal` 必须校验 `proof_type` 与 `signature_key_id` 的一致性。
- `OpenExternalPrincipalSession` 的 `proof` 验证失败统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。

## K-AUTHSVC-007 审计与追踪

所有方法必须写审计（成功/失败），最小字段遵循 `K-AUDIT-001`（最小字段），且保留 `app_id`、`session_id`、`external_principal_id`（若适用）。

## K-AUTHSVC-008 与 AuthN 契约耦合

`RuntimeAuthService` 生成或续签的 token 必须满足 `K-AUTHN-002`（必校验 claims）与 `K-AUTHN-003`（算法与 Header 约束）的可验证性约束。

## K-AUTHSVC-009 AppMode 校验矩阵

`AppMode` 不是授权源；它仅是未来 separately admitted non-binding session
的 static upper bound。所有 `BINDING_ONLY` registration/session 的 effective
domains 与 effective scopes 均为 empty，不受 `LITE`、`CORE_ONLY`、`FULL`、
manifest、project-local flag 或 grant row 影响。Mode/manifest
validation never upgrades protected origin、caller role、transport class、
account posture 或 token custody。
For `BINDING_ONLY`, effective domains and effective scopes are empty.

Ordinary `OpenSession` has no broker, AI, artifact, realtime, media, lifecycle,
or local-app launch authority. Local-app sessions are created only by
request-empty `OpenLocalAppSession` on a verified `local_app_bootstrap` connection
already bound to current lease/process/principal/record; success atomically
promotes that same connection to `local_app_host`. Its short-lived technical
session may be renewed only by request-empty `RenewLocalAppSession` on that
same verified `local_app_host` connection and current session. The following table
remains a ceiling, not blanket effective rights：

| AppMode | runtime.* ceiling | realm.* ceiling | 静态上限说明 |
|---|---|---|---|
| `LITE` | 否 | 是 | 最多允许 realm；仍需独立 session/origin/grant admission |
| `CORE_ONLY` | 是 | 否 | 最多允许 runtime；仍需独立 session/origin/grant admission |
| `FULL` | 是 | 是 | 最多允许两类 domain；不等于授予任何权限 |

只有在 non-binding session、protected origin 和具体 operation/grant 已由其
canonical owner 独立准入后，域 ceiling 违规才返回
`APP_MODE_DOMAIN_FORBIDDEN`，scope ceiling 违规才返回
`APP_MODE_SCOPE_FORBIDDEN`。

**评估顺序**：先判定 `BINDING_ONLY`（effective set 直接为空），再验证
protected origin 与 independently admitted session，之后才应用 AppMode ceiling，
最后按 authority class 应用 base-entitlement boundary，或 admitted public
permission 的 current owner decision/selector 与 operation-owner policy。任一前置不成立均 fail
closed，且不得借由后续 ceiling/grant 反向升级。

## K-AUTHSVC-010 Manifest 与 WorldRelation 组合规则

`AppModeManifest` 必须声明 `mode` 和 `world_relation`。`WorldRelation` 枚举：

| 值 | 含义 |
|---|---|
| `NONE` | 无世界关联 |
| `RENDER` | 渲染权限 |
| `EXTENSION` | 扩展权限 |

组合校验：非法组合返回 `APP_MODE_MANIFEST_INVALID`。`LITE` 模式不允许 `world_relation=EXTENSION`（需要 runtime 能力）。

## K-AUTHSVC-011 Session TTL 解析逻辑

- 默认 TTL：3600 秒（1 小时）。
- 客户端可通过 `ttl_seconds` 请求自定义 TTL，但必须落在服务端配置区间内（`K-AUTHSVC-004`）。
- TTL 下限由 `sessionTtlMinSeconds`（默认 60s）控制，上限由 `sessionTtlMaxSeconds`（默认 86400s）控制，两者均通过 `K-DAEMON-009` 配置文件或环境变量设置。
- 缺省 `ttl_seconds` 时使用默认值。

## K-AUTHSVC-012 Session 存储与重启行为（split rule）

本规则已 split 为两个独立 owner 域：

**App session / external-principal session（`RuntimeAuthService` 拥有）：**

An app session created by `OpenSession` is `BINDING_ONLY`; reconnect or
refresh recreates only that empty-effective-rights binding and cannot restore
broker/AI/artifact/realtime/media/lifecycle privilege. External-principal
sessions remain their separately proven external path and never become local
account or protected process origin.

- Phase 1 session 存储使用进程内内存 map，不跨重启持久化。
- daemon 重启后所有 app session / external-principal session 失效，客户端需重新调用 `OpenSession` 或 `OpenExternalPrincipalSession` 建立新会话。
- 客户端应实现 session 失效后的自动重连逻辑（检测到 `UNAUTHENTICATED` 后重新 `OpenSession`）。
- 未来版本可引入持久化存储（如文件或嵌入式 KV），但 Phase 1 明确不要求。

**Local machine account session（`RuntimeAccountService` 拥有，见 `account-session-contract.md` `K-ACCSVC-007`、`K-ACCSVC-011`）：**

- Account session 必须使用 secure Runtime custody（macOS keychain / Windows credential vault / Linux secret service），由 daemon 拥有；调用方 / Desktop / app 不得拥有 durable account token custody。
- daemon 重启时必须从 secure custody 尝试恢复 account session：恢复成功 → `authenticated`；不可用 → `unavailable`；过期 → `expired`；不一致 → `reauth_required`。
- account session 与所有 scoped app binding 在 daemon 重启时全部失效；消费方必须重新申请。
- `OpenSession` / `OpenExternalPrincipalSession` 路径不允许作为 local machine account truth 入口；调用方提供的 `subject_user_id` 不得用于 local first-party account / binding 派生。

**跨消费方恢复协议差异（K-AUTHSVC-012）**：

daemon 重启导致内存 session 全部失效，不同消费方受影响程度和恢复策略不同：

| 消费方 | 使用 OpenSession? | 重启影响 | 恢复策略 |
|---|---|---|---|
| **Desktop** | 否（token 来自 Realm Backend） | 需重新 RegisterApp（D-BOOT-004），Realm token 不受影响 | Desktop 检测到 `runtime.disconnected`（S-RUNTIME-028）后重新执行 bootstrap 序列 |
| **External Agent（SDK 消费者）** | 是（K-AUTHSVC-006） | session 失效，所有需认证的 RPC 返回 `UNAUTHENTICATED` | 应用层检测到 `UNAUTHENTICATED` 后重新 `RegisterExternalPrincipal` + `OpenExternalPrincipalSession`。SDK `runtime.disconnected` 事件可检测连接断开但**无法区分**"网络故障"和"daemon 重启导致 session 失效"——两者恢复策略相同（重建连接 + 重建 session） |
| **独立 SDK 消费者** | 是（K-AUTHSVC-002） | 同 External Agent | 同 External Agent |

**SDK 层推荐实现模式**：SDK 消费者应在 `runtime.disconnected` 事件处理器中无条件重新 `connect()` + `OpenSession()`（或 `OpenExternalPrincipalSession()`），不需要区分断开原因。失败时按 S-RUNTIME-045 退避重试。

## K-AUTHSVC-013 ExternalPrincipal proof_type 枚举

`RegisterExternalPrincipal` 和 `OpenExternalPrincipalSession` 中 `proof_type` 的支持值：

| proof_type | Phase | 验证协议 |
|---|---|---|
| `JWT` | Phase 1 | JWT 签名验证 + `exp` 过期检查 + `iss` 签发者匹配 |

Proto 枚举冻结约束：

- `ExternalProofType` 仅允许 `EXTERNAL_PROOF_TYPE_JWT` 作为可用值；
- 历史值槽位 `2` 必须保持 `reserved`，不得复用。

**JWT 验证约束**：

- `signature_key_id` 必须指向已注册的公钥（通过 `RegisterExternalPrincipal` 的 `signature_key_id` 关联）。
- 签名算法限制：与 `K-AUTHN-003` 一致，只接受 generated Realm JWKS
  contract 当前声明的 `RS256`。
- proof JWT 必须包含 `iat`，并参与时序校验。
- `nbf` 如存在，必须按 `K-AUTHN-005` 的 `±60s` skew 参与校验。
- proof JWT 最大生命周期固定为 `24h`，即 `exp - iat <= 24h`；超限必须 fail-close。
- `exp` 过期的 token 统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_EXPIRED`。
- `iss` 不匹配统一映射到 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`。
- 不支持的 `proof_type` 返回 `INVALID_ARGUMENT` + `AUTH_UNSUPPORTED_PROOF_TYPE`。

## K-AUTHSVC-014 Retired Developer Registration Boundary

The predecessor `RegisterAppRequest.developer_registration` gate is retired and
is physically absent from the public wire. Field number `7` and field name
`developer_registration` are both reserved and cannot be reused. No ignored
field, alias, compatibility decoder or alternate request intent may preserve
the predecessor shape. `RegisterApp` cannot create a local principal, project
authorization, account caller, grant, launch lease, or local-app session.

Local development enters only through Runtime-owned Developer Mode project
authorization, K-APP principal/record creation, K-PLOCAL protected launch, and
the common request-empty local-app session. `auth.developerRegistration`, its
environment/CLI/config projections, request intent, `RegisterApp`, app id,
manifest, ordinary app session, metadata, or a temporary bearer do not exist as
compatibility paths. Unknown predecessor config keys fail schema validation;
the service does not decode or special-case predecessor wire payloads.
