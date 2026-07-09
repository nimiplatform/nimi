# Runtime App Lifecycle Contract

> Owner Domain: `K-APP-*`

Runtime-owned Nimi App install, uninstall, update, health repair, open, and file-API non-admission authority.

This file is a semantic split from `app-messaging-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

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
  （`admission_status=admitted`），并按 descriptor `admission_track`
  执行 visibility gate：`ordinary-release-proof` 必须来自 catalog
  ordinary-visible row；`admission-sandbox-ci` 只能来自 admitted
  developer-only sandbox row 和显式 CI/test harness launch context，不能计入
  ordinary Apps discovery 或 product-readiness proof；
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

`MUST`：`OpenAppResponse.projection` is the Runtime-owned launch-resolution contract for installed Nimi Apps. The first third-party launch cut extends `OpenApp`; it MUST NOT add a parallel launch-resolution RPC unless a later Runtime authority rule amends the `K-APP-001` method set.

`MUST`: for `APP_OPEN_STATE_LAUNCHED`, the projection MUST carry Runtime-attested launch-resolution fields: `app_id`, active version, release descriptor ref, descriptor class, `admission_track`, source kind, ordinary visibility, digest verification state, descriptor `runtime.entry_ref`, verified active release root or opaque launch URI rooted in the installed digest-verified release, app data/cache/tmp roots or opaque storage handles, standard shell capability-set ref for installed Nimi Apps, installed-app caller mode `desktop-launched-nimi-app`, and one-time launch nonce bound to the Desktop-created app host.

`MUST`: an `admission-sandbox-ci` launch projection is non-product plumbing evidence. It MUST carry `ordinary_visibility: developer-only`, `source.kind: admission-sandbox-https-artifact`, and `product_readiness_claim_allowed: false`; Desktop/SDK may consume it only for CI/developer sandbox install-open-host probes. It MUST NOT satisfy ordinary catalog discovery, ordinary third-party release readiness, user-visible community listing proof, or the manual ordinary release gate.

`MUST NOT`：Desktop, SDK, Kit, or apps must not derive descriptor refs, release roots, entry refs, storage roots, caller posture, or launch success from filesystem guesses, process liveness, local adoption, or renderer self-report.

`MUST NOT`: local adoption, account-only inventory, tester developer registration, or Desktop shell caller identity may emit or satisfy the installed third-party launch-resolution fields admitted by `P-NAPP-034`, including `desktop-launched-nimi-app`, the one-time launch nonce, descriptor catalog proof, or product-readiness proof.

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
