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

## K-APP-011..K-APP-016 Deferred Ordinary App Lifecycle

Ordinary install, import, update, uninstall, repair, lifecycle-job and
lifecycle-event behavior is deferred. The current Runtime wire, handlers,
generated clients, SDK surface, host projections, scripts and tests contain no
callable seam or typed-unavailable placeholder for those operations. A future
ordinary package lifecycle requires new canonical authority and a new wire
design; current local-development records cannot be promoted into that truth.

The active lifecycle is only the Runtime-owned local-development flow in
K-APP-027. Revocation and run-once completion tombstone the current development
principal and remove its record; no compatibility alias, reinstall path or
package-manager fallback is admitted.
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

## K-APP-026 Removed Ordinary Lifecycle-intent Protocol

The former ordinary package lifecycle-intent protocol is retired and physically
absent. Runtime exposes no prepare/status RPC, intent ledger, intent reason
codes, config projection, SDK helper or host bridge for it. Current
local-development approval and launch use their own Runtime-owned protected
operations and do not reserve an ordinary install/update/repair intent seam.
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

当前 `RuntimeAppService` 只有以下方法：

1. `SendAppMessage`
2. `SubscribeAppMessages`
3. `GetAppStorage`
4. `ReadLocalAppStorageJson`
5. `WriteLocalAppStorageJson`
6. `RemoveLocalAppStorageJson`
7. `PrepareLocalAppLaunch`
8. `BindLocalAppProcess`

消息、storage 与 local-development launch 各自遵守最近 owner contract。
ordinary install/update/uninstall/repair、package readiness、account inventory、
lifecycle intent、job 与 event RPC 均已物理移除，而不是 typed-unavailable
占位面。
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

Current Runtime projection authority covers principal-scoped storage and the
active local-development record/session surfaces only. Ordinary app health,
response-state, support next-action, package-readiness and account-inventory
projections are deferred and physically absent from Proto, Runtime, generated
clients, SDK, Kit and Desktop.

## K-APP-019..K-APP-021 Removed Ordinary Support Projections

The former `AppHealth`, `AppResponseState` and closed support next-action
tables are retired. Their types, enums, mapping tables, generators, fixtures and
consumer surfaces are not reserved as current contracts. Reintroducing any of
them requires new canonical authority and an independently admitted owner
surface.
## K-APP-022 App Storage Truth Projection

`MUST`：app-private storage is Runtime-owned principal-scoped truth. A
local-app session resolves its opaque principal internally; the request does
not accept `app_id` or a principal override. Runtime derives the following
roots:

- `<nimi_data>/apps/<local-app-principal-id>/data`
- `<nimi_data>/apps/<local-app-principal-id>/cache`
- `<nimi_data>/apps/<local-app-principal-id>/tmp`

`MUST`：an active development principal may receive data/cache/tmp roots.
Same-app-id principals remain isolated. Tombstoned data
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

## K-APP-023 Deferred App Package Readiness

Package readiness is deferred. `GetAppPackageReadiness`, its request/response
messages, enums, Runtime handler, generated clients, SDK facade, Kit/Desktop
projection, fixtures and configuration inputs are physically absent. Current
code never scans package directories, active pointers, install evidence or file
existence as package truth.

## K-APP-024 Deferred Account App Inventory

Account app inventory and ordinary visibility-versus-materialization projection
are deferred. `GetAccountAppInventory`, its records/rows/enums, Runtime store
and handler, generated clients, SDK decoder/facade, Kit/Desktop projection,
fixtures and configuration inputs are physically absent. A local-development
record creates neither account entitlement nor verified distribution truth.
## K-APP-025 Retired Local Adoption Boundary

The predecessor local-adoption family is retired and must be removed from
Proto, generated clients, Runtime handlers/stores, SDK/Kit exports, Desktop UX,
tests, and inventory states in the atomic public wire epoch. It has no active
success behavior and no alias.

Mutable source enters through K-APP-027 Developer Mode and creates a fresh
isolated development principal/record only after Runtime presence and approval.
Ordinary package lifecycle has no current seam. Package-manager roots,
workspace/source scanning, app-local manifests, app id, file presence or
process liveness cannot create runnable truth.

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

## K-APP-029 Stable Local-development Security Principal

Runtime allocates a random, non-reused opaque `local_app_principal_id` for
each local-development authorization instance. The identifier, rather than
`app_id` or project path, is the security subject for app-private storage,
app-scoped audience/access, grants, sessions and audit.

A development principal carries only its Runtime-owned
`development_authorization_id`, canonical project-root file identity and
declared `app_id`. Revocation or run-once completion tombstones it permanently.
Any later authorization creates a new principal and inherits no permission
decision, storage, audience, session or audit identity. Retained tombstoned data
is delete-only after fresh presence; rebind and migration are not admitted.

## K-APP-030 Local-development Record

`LocalAppRecord` currently binds one development principal to its canonical
project identity, project generation, active capability fingerprint, opaque
execution profile and host/payload digests, and lifecycle state. Its only trust
class is `local_development`.

The record contains no immutable lineage, package/install/update/repair state,
grant boolean, permission result, account owner, session proof or operation
policy decision. Ordinary package records require new canonical authority and
cannot be inferred from registry metadata, release descriptors, files,
fixtures or a matching `app_id`.
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
