# Runtime App Lifecycle Contract

> Owner Domain: `K-APP-*`

Runtime-owned Nimi App install, uninstall, update, health repair, open, and file-API non-admission authority.

This file is a semantic split from `app-messaging-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

All lifecycle mutations (`InstallApp`, `UninstallApp`, `UpdateApp`,
`HealthRepairApp`, `AdoptLocalApp`, `RemoveLocalAppAdoption`, and `OpenApp`)
require the `desktop_control` / `desktop_lifecycle_host` row in
`tables/protected-local-rpc-transport-matrix.yaml`. Public TCP, app session,
app id, caller enum, source host, renderer metadata, and portable bearer are
denied before lifecycle parsing. Mutations require the K-PLOCAL-007 lifecycle
challenge and anchored durable intent; loss of protected transport, ledger, or
process verification fails closed without fallback.

## K-APP-011 InstallApp Lifecycle

Before download or filesystem side effects, Runtime validates the
`desktop_lifecycle_host` protected origin and consumes a matching lifecycle
challenge into an anchored durable intent.

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

Before any irreversible removal, Runtime consumes the K-PLOCAL-007
challenge/intent transaction. A request-body confirmation is product intent,
not origin or authorization.

`MUST`：`UninstallApp` 默认移除 `<nimi_data>/apps/<app-id>/releases` 下的
release payload，保留 `<nimi_data>/apps/<app-id>/data` 下的 durable data
（Platform `P-NAPP-015`）。只有当 caller 显式确认 destructive delete 时才
额外移除 durable data。

`MUST NOT`：uninstall 不得隐式删除 shared models、Runtime dependencies、
account data、或其他 app 的数据。

## K-APP-015 UpdateApp Atomic Update Lifecycle

Protected Desktop lifecycle-origin validation and anchored challenge/intent
creation precede download, swap, or active-release mutation.

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

Every repair mutation requires the protected Desktop lifecycle origin and a
single-use anchored lifecycle challenge; health reads do not manufacture that
write authority.

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

Before package or launch-resolution work, the current `desktop_control`
connection must carry Runtime-derived `desktop_lifecycle_host` origin and a
matching current account/release/adoption generation. A.1 admits the Windows
installed child channel under K-PLOCAL-008; unadmitted platforms remain
fail-closed without a temporary fallback.

In A.0, `OpenApp` is admitted only as a protected Desktop lifecycle mutation
with transactional idempotency and exact target/generation checks. It does not
require a prepare challenge. Because the installed child
transport/session and launch projection are not admitted, it must not create a
process/window or return `APP_OPEN_STATE_LAUNCHED`. It fails closed with the
typed protected-transport-unavailable reason after operation validation and before
child side effects.

A.1 defines the process-bound Windows launch record and installed session in
K-PLOCAL-008. `OpenApp` may expose only the non-authorizing launch correlation
id in its renderer-safe projection; verified child-process binding is host-only.
Filesystem guesses, process liveness alone, local adoption, account inventory,
tester registration, Desktop identity, app metadata,
ordinary gRPC and prior implementation cannot approximate launch success.

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

`RuntimeAppService` 的 admitted method set is exactly the 18 methods listed in
`K-APP-001`. The two K-APP-026 lifecycle-intent methods remain non-callable and
fail closed until the A.0 proto/`rpc-methods.yaml`/Runtime/SDK/Kit projection
lands atomically; absence is not permission to emulate them. No
Runtime-mediated file-API RPC is admitted on this service surface.

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

## K-APP-026 Protected Desktop Lifecycle Operation Protocol

`tables/protected-local-lifecycle-intent-protocol.yaml` is the sole action,
operation-admission, renderer-projection, idempotency, replay, and
reconciliation authority. `PrepareAppLifecycleIntent` is a transitional UX
projection, not security authority; `GetAppLifecycleIntentStatus` reconciles a
non-authorizing operation identifier.

When used, `PrepareAppLifecycleIntent` is available only on the live
`desktop_lifecycle_host` connection. Runtime resolves current release,
artifact/adoption generation, account generation, destructive options, and
impact flags before returning a typed canonical impact. `intent_id`, impact
digest, and any job id are correlation-only and non-authorizing.
Renderer may receive only the table's safe projection; it never receives a
portable proof, process tuple, boot epoch, durable anchor, account generation
material, or credential.

Every lifecycle mutation revalidates the same protected Desktop
session/process/account/boot epoch and exact target generation, consumes a
non-secret idempotency key, and creates its durable operation record in one
service-owned database transaction. No external side effect starts before that
transaction commits. Caller `confirmed=true`, an intent id, or a displayed
digest never authorizes. Conflicting idempotency reuse, wrong target/release,
wrong process/account/epoch, revoked session, or stale generation fails closed.
Lost responses reconcile through the typed status RPC; status never authorizes
a new mutation.

## K-APP-027 Local-Development Admission Lifecycle

Runtime owns the distinct `local-development-installed-admission` lifecycle.
`AdoptLocalApp` continues to establish only validated local inventory and an
adoption generation; adoption alone cannot create a development authorization,
launch, host session, or protected operation posture.

The protected `RuntimeDevelopmentService` owns request/list/revoke of user
development authorizations and prepare/bind/open/status of technical launches.
Authorization mutations and launch preparation are accepted only from the live
`desktop_lifecycle_host` origin. The development host may call only the empty
bootstrap/session-open surface on its verified `development_bootstrap`
connection and the exact operations admitted for `development_host`. Public
TCP, installed host, renderer, app metadata, and app-tools cannot invoke the
Desktop-owned methods or select a trust class.

Authorization creation consumes the current submitted manifest under the
canonical selected project root, independently validates its closed permission
declarations, computes the canonical manifest capability fingerprint, binds the
authenticated account, and records the user choice supplied by the trusted
Desktop confirmation flow. One-command development does not require a prior
`AdoptLocalApp` record and does not synthesize one: local adoption remains an
independent inventory lifecycle whose presence or absence cannot authorize a
development host. Evaluation fails closed on wrong app/root/fingerprint/account/
shell, capability expansion, revoked approval, or an unsupported platform.
Listing and revoke projections expose no session, ticket, process, epoch,
credential, or endpoint material.

Launch preparation is distinct from `OpenApp` production release resolution.
It uses K-PLOCAL-009 and returns only a non-authorizing correlation to Desktop;
the host receives no portable launch value. Host bind, session creation,
rotation, process/supervisor exit, Runtime restart, account change, and revoke
are transactional Runtime truth. A remembered authorization may authorize a
new supervised command run without a repeated prompt, but every run and every
host restart creates new process-bound technical state.
