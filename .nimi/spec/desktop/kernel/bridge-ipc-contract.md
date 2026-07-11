# Bridge IPC Contract

> Authority: Desktop Kernel

## Scope

Desktop Tauri IPC 桥接契约。定义 renderer 进程通过 `@tauri-apps/api/core` / `@tauri-apps/api/event` 的显式桥接与 Tauri backend 通信的命令集、类型解析、错误归一化。

## D-IPC-001 — Bootstrap / Runtime Shared Auth Broker Boundary

Desktop owns UX and orchestration but not protected-origin truth. Account
control and lifecycle commands travel on one Runtime-authenticated
`desktop_control` connection after `OpenDesktopSession`; the session id is
correlation-only and never crosses into renderer payloads as authority.
Renderer metadata, preload arguments, app-owned host stamps, and public gRPC
cannot replace the K-PLOCAL verified process context. Disconnect or Desktop
process exit/exec disables the bridge until a fresh full verification.

> **Authority Disposition**：
> `auth_session_load` / `auth_session_save` / `auth_session_clear` 不是最终
> shared auth，且不得注册为 active Tauri command、Kit renderer export 或
> standard shell product capability。Shared auth 由 `RuntimeAccountService`
> custody 拥有，并只经 exact typed protected carrier operations 投影。
> Generic renderer-selectable `runtime_bridge_unary` /
> `runtime_bridge_stream_open` cannot carry protected account authority.
> Desktop owns account UX, not token/session custody.

`runtime_defaults`, if retained, returns only non-security shell hints. It has no
`realm` object and must not carry Realm/JWKS/revocation endpoints, bearer,
account/subject, provider/model/connector route, local endpoint, credential ref,
Runtime listener, executable/service selector, trust path, or configuration
document. Chat/Runtime Config truth comes from exact Runtime-owned typed
projections after protected origin verification.

所有字段通过 `parseRuntimeDefaults` 防御性解析。

`auth_session_*` has no active command set. If non-app-facing cleanup code is
temporarily retained, it must be unreachable from Tauri invoke registration,
renderer exports, capability catalogs, SDK/app imports, and must have negative
tests proving denial.

Authenticated local consumer revalidation belongs to Runtime account-session
projection (`GetAccountSessionStatus`, `SubscribeAccountSessionEvents`),
Runtime-mediated Realm calls (`InvokeRealmUnary`), and scoped binding
validation. Desktop may render Runtime account projection and route user
intent, but it must not reintroduce app-local shared-session coherence or raw
token transport as a Desktop bridge surface.

## D-IPC-002 — Daemon 生命周期命令

Install, uninstall, update, repair, local adoption/removal, and `OpenApp`
commands require Runtime's `desktop_lifecycle_host` origin and K-PLOCAL-007
transactional operation admission with current target/generation
checks. A UI confirmation boolean is display
intent only. A.0 cannot claim positive Avatar/Zhiyu child launch until A.1
protected child-channel authority and implementation land; no nonce, metadata,
or portable bearer fallback is allowed.

The shared Kit protected-local host carrier exposes exactly three typed product
operations: `status`, `start`, and `restart`. The authoritative product surface
has no `runtime_bridge_stop`; product registration/export of that command must
be removed by the A.0 implementation cut. No operation accepts a binary path,
argv, endpoint, config path, service name, code-signing policy, or environment
override.

The common redacted result is `{ state, releaseId?, reasonCode?, retryable }`,
where state is exactly `stopped | start_pending | running | restart_pending |
unavailable`. It exposes no PID, gRPC/HTTP address, process path, service ACL,
code-signing detail, account material, or credential.

On Windows, `status` queries SCM for fixed service `NimiRuntime` and requires a
verified Runtime protected handshake before reporting `running`; `start` uses
only `SERVICE_QUERY_STATUS | SERVICE_START` on that fixed service; `restart`
asks verified Runtime to drain and self-exit, then reports `running` only after
SCM recovery starts a new PID/creation marker/boot epoch that passes mutual
verification. Desktop never receives `SERVICE_STOP`. A hung/unverified process
fails closed to repair by the signed installer/service updater or administrator.

Linux/macOS follow their OS service-manager profiles with the same typed
result/denials. Desktop quit leaves Runtime running.

Service `running` only means the process and protected handshake are verified;
it is not provider readiness. Provider health remains a separate Runtime-owned
typed SDK projection. Before the first authoritative sample the UI displays
`unknown/checking`, never green readiness, and service-control IPC must not
fabricate provider health.

## D-IPC-003 — Config 读写命令

Whole-document/path commands `runtime_bridge_config_get` and
`runtime_bridge_config_set` are not admitted production surfaces and must be
removed from product registration. Desktop may consume bounded typed, redacted
config status and submit an exact typed mutation only after that field and
operation are admitted by Runtime authority. Such messages carry no path,
unknown JSON, raw provider secret, Realm endpoint override, listener address,
service identity, executable selector, environment merge, or last-writer-wins
document semantics. A restart-required response may enable typed `restart`; it
does not grant direct stop or file access.

## D-IPC-004 — HTTP 代理命令

`http_request` is not an authenticated Runtime/Realm/provider transport. It
must reject renderer-supplied `Authorization`, cookies, bearer/JWT-shaped
values, provider credentials, Realm bases, and Runtime endpoints. Account and
connector acquisition/exchange terminate in typed Runtime-owned protected
operations; a Desktop HTTP proxy cannot become their fallback. Any retained
unauthenticated shell fetch requires its own exact public-origin allowlist and
response limit and confers no security authority.

- 每次调用生成唯一 `invokeId` 用于追踪。
- 日志记录 `requestUrl`、`requestMethod`、`requestBodyBytes`。

## D-IPC-005 — UI 命令

- `open_external_url`：在系统浏览器打开外部 URL。
- Private or governance-chain data publication must be implemented through a Runtime/Realm-owned workflow with an explicit product spec, not a Desktop-only native dialog.
- `confirm_dialog` / `start_window_drag` / `focus_main_window` 是 platform 标准
  shell-ui 能力（`P-KIT-041C` `shell-ui.confirmDialog` /
  `shell-ui.startWindowDrag` / `shell-ui.focusMainWindow`）的消费面。命令名与
  语义权威归 platform `tables/standard-shell-capabilities.yaml`；Desktop 不得
  注册同名 app-local Tauri command fork，只能通过 kit 提供的 host adapter
  hooks 注入 Desktop 策略（confirm 的原生对话框实现与 E2E override、focus 的
  目标窗口策略、drag 的 fullscreen 保护）。
- `menu_bar_sync_runtime_health`：renderer 向 Tauri backend 同步 menu bar 所需的 runtime/provider 健康摘要。
- `menu_bar_complete_quit`：renderer 在完成 shell cleanup 后确认执行 app quit。

## D-IPC-006 — OAuth 命令

- Product `oauth_token_exchange` in Desktop is forbidden: Runtime owns account
  and connector code exchange, PKCE verifier, client secret, tokens, and
  custody under its isolated service principal.
- A native shell may open the system browser and forward an exact callback
  observation to a typed protected Runtime login/connector attempt. Desktop and
  renderer never receive PKCE verifier, client secret, access/refresh token, or
  provider credential.

## D-IPC-008 — External Agent Runtime Boundary

External Agent gateway, token/session/grant ledger, action descriptor registry,
execution context verification, completion ledger, and audit are Runtime-owned
authority surfaces (`P-ALMI-002`, Runtime delegated gateway/auth/grant/audit).

Desktop MUST consume External Agent state and controls through SDK typed Runtime
projection. Desktop/Tauri MUST NOT own or persist a parallel gateway, token
ledger, action descriptor registry, verification path, completion waiter, or
audit store.

## D-IPC-009 — Invoke 基础设施

所有 IPC 调用通过 `invoke()` / `invokeChecked()` 统一入口：

- 前置检查 `hasTauriInvoke()`（`window.__TAURI__` 存在性）。
- 前置检查 `hasTauriInvoke()`（Tauri runtime presence；不得依赖 `withGlobalTauri`）。
- 生成 `invokeId`（`${command}-${timestamp}-${random}`）。
- 结构化日志：invoke-start、invoke-success、invoke-failed。
- 错误归一化：`toBridgeNimiError()` 将 Tauri/runtime 错误归一化为结构化 `NimiError`；用户可读文案只通过 `details.userMessage` 或显示层转换读取。

### IPC Infrastructure Commands

- `get_system_resource_snapshot`：采集系统资源快照（CPU/内存/GPU），供设备画像使用。
- `log_renderer_event`：renderer 侧结构化日志转发到 Tauri backend logger（D-TEL-006 桥接入口）。

## D-IPC-014 — Desktop Runtime Version Negotiation

版本协商引用 SDK `S-TRANSPORT-005`，并受 `self-update-contract.md` 约束：

Desktop and Runtime releases may be serviced independently, but production
compatibility is never inferred from semver. After mutual OS process/code-signing
verification, the protected handshake negotiates the exact
`protected_local_protocol_version`; unsupported versions block protected
control. Installer-owned activation and rollback policy remain release truth
and are not duplicated in peer-auth records. Typed `status` may return the verified
Runtime `releaseId`; it never executes a candidate binary to discover version.
Synthetic non-product fixtures use distinct trust roots and cannot relax the
production check.

## D-IPC-015 — Desktop Self-Update Surface

Desktop 自更新命令集：

- `desktop_release_info_get`
- `desktop_update_state_get`
- `desktop_update_check`
- `desktop_update_download`
- `desktop_update_install`
- `desktop_update_restart`
- `subscribeDesktopUpdateState`（desktop-only Tauri event listener；消费 `desktop-update://state`，不属于 `tables/ipc-commands.yaml` 的 invoke command 清单）

约束：

- `desktop_release_info_get` 仅在 release metadata 初始化成功时返回 `DesktopReleaseInfo`；初始化失败必须返回错误，不得合成 fallback 版本。
- `desktop_update_download` 必须仅执行下载、验签与缓存 update bytes，并在成功后停在 `downloaded` 状态，不得隐式进入安装。
- `desktop_update_install` must consume only cached, verified Desktop update
  bytes. It must not stop, stage, replace, or select Runtime. If the signed
  compatibility record requires a Runtime service release, the signed
  installer/service updater completes and activates that service release;
  Desktop installation remains unavailable until the updater reports a
  mutually compatible installed pair.
- `desktop_update_state_get` / desktop update 事件流必须共享同一个状态机语义：`idle -> checking -> available -> downloading -> downloaded -> installing -> readyToRestart -> error`。

## D-IPC-016 — Shared Tauri Bridge Authority

- `kit/shell/protected-local/**` (P-KIT-041) is the shared native protected
  carrier and typed OS service-control host surface for Tauri and Electron.
  Kit carries typed calls only; Runtime/OS remain endpoint, origin, service
  lifecycle, credential and security authorities.
- `kit/shell/tauri/**` remains the implementation owner for app-agnostic Tauri
  shell glue. It consumes the protected-local carrier and must not own a
  parallel daemon manager, executable resolver, config document, token store,
  or authenticated HTTP proxy.
- D-IPC-001 (non-security shell defaults only), D-IPC-002 (typed
  status/start/restart), D-IPC-005 (UI commands `open_external_url`,
  `confirm_dialog`, `start_window_drag`, `focus_main_window`), and D-IPC-009
  (invoke infrastructure, `log_renderer_event`) use shared Kit surfaces.
- Apps must not duplicate these shared command implementations in app-local Rust code.
- Apps must not use `#[path = "..."]` to compile another app's Rust source for shared bridge functionality.
- App-specific Tauri commands for desktop menu bar and desktop self-update remain app-local.
  D-IPC-008 External Agent is not app-local command authority; it must travel
  through SDK Runtime projection.

## D-IPC-012 — IPC 桥与 SDK 路径分界

Desktop 到 Runtime 存在两条数据路径。两者分界为设计意图，不是临时妥协：

**SDK typed Runtime path**（D-BOOT-004 → SDK Runtime client + native carrier）：
- Binding-only bootstrap includes only `RegisterApp` and `OpenSession`.
  AI, connector, scenario, account, lifecycle and every other protected
  operation require their own admitted transport/origin/policy; listing a
  generated method does not admit it.
- The entire public `RuntimeGrantService` protected-token family is deny-all
  pending A.3d physical removal. Desktop/SDK cannot issue, validate, revoke,
  delegate, enumerate, inject, or consume a portable protected credential.
- `RegisterApp` / `OpenSession` in this list are binding-only bootstrap and do
  not authorize any other listed capability. Each privileged capability must
  satisfy its own admitted transport/origin/operation authority.
- 本地资产控制面：`RuntimeLocalService` 负责 local asset inventory 的 list、import/install、health/readiness、intake、audit、transfer session 与 progress watch；`StartLocalAsset` / `StopLocalAsset` 保留为 runtime 维护能力，不是 Desktop 产品主路径
- agent presentation projection：runtime-owned persistent `AgentPresentationProfile` 通过 `runtime.agent.*` 暴露；Desktop avatar current-surface state 不得借道升格为 IPC canonical truth
- Phase 1 健康监控（GetRuntimeHealth、ListAIProviderHealth、SubscribeRuntimeHealthEvents、SubscribeAIProviderHealthEvents）— 见 S-TRANSPORT-007 Mode D Phase 1 投影
- Phase 2 服务（Workflow、Knowledge、Audit、AppMessage、Script）

**Runtime IPC payload 鉴权字段**：
- Binding-only public calls may use their separately governed public transport,
  but an `authorization` bearer never establishes protected origin.
- Protected Runtime calls travel through the shared native carrier on the
  mutually verified connection. Renderer IPC exposes neither a generic
  gRPC-over-IPC method selector nor `authorization`, Desktop session id, boot
  epoch, process tuple, lifecycle intent proof, account material, or token.
- SDK transport code cannot inject or upgrade protected authority from a
  bearer, metadata.extra, app id, caller enum, or renderer payload.

**IPC 桥路径**（Tauri backend → daemon）：
- OS/Runtime service control: typed `status/start/restart` only (D-IPC-002)
- Runtime configuration: bounded typed redacted operations only after
  independent field/operation admission (D-IPC-003)
- unauthenticated shell network helper only; no Runtime/Realm/provider auth
  proxy (D-IPC-004)
- native browser/callback observation only; Runtime owns OAuth exchange and
  custody (D-IPC-006)
- External Agent 管理（D-IPC-008: SDK-projected Runtime gateway/token/action
  state only）
- shell-native / host helper 能力（D-IPC-011：picker、reveal、notification、以及仍未下沉到 runtime 的 host-local helper）

**分界原则**：
- SDK 路径承载**应用逻辑 RPC**——调用语义与平台无关，独立 SDK 消费者可复用。
- SDK 路径同时承载 local model 控制面真源；desktop 不得以 Tauri host state 取代 `RuntimeLocalService`。
- avatar persistent presentation profile 属于 SDK/runtime path；avatar transient interaction state 属于 renderer surface-local truth，不得发明第二套 Tauri command owner。
- IPC bridge carries shell-native UI and the Kit protected-local typed carrier;
  it does not own Runtime process management or configuration truth.
- Independent SDK consumers do not inherit an equivalent public CLI path for
  protected service/config operations. They require an independently admitted
  native protected carrier; absent one, they fail closed.

补充约束：

- passive asset（`vae` / `ae` / `clip` / `controlnet` / `lora` / `auxiliary`）列表、verified catalog、安装、导入、移除、intake、transfer/progress 与 lifecycle 全部以 `RuntimeLocalService` 为真源；Tauri 命令若仍存在，只能作为 host helper，不得构成第二条产品执行路径。
- local image workflow 的 `engineConfig`、`components`、`profile_overrides` 必须沿 `desktop -> sdk/runtime -> runtime` 原样透传；Desktop 不得改写为绝对路径。

cloud 路径必须固定经由 Runtime connector APIs；Desktop 不得恢复 legacy adapter factory、直接 `listModels()` 或 `healthCheck()` 调用以绕开 Runtime。

Service status and Runtime health are intentionally distinct. D-IPC-002 reports
OS service plus protected-handshake state; SDK health streams report
Runtime-owned health only after a verified carrier is active. Neither may
fabricate the other.

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

## D-IPC-010 — 懒加载桥接模块

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- local runtime bridge loader — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

## D-IPC-011 — Local Runtime 命令

Local Runtime 桥接通过 `loadLocalRuntimeBridge()` 懒加载（`D-IPC-010`）。Desktop app-local `runtime_local_*` 命令只保留 manifest picker helper；通用 file/directory picker 与 reveal 必须走 Kit standard shell `file-dialog.open` / `file-reveal.reveal`：

Local-runtime Tauri 命令使用 `runtime_local_assets_*` 前缀。旧 `runtime_local_models_*` / `runtime_local_artifacts_*` CRUD/lifecycle/catalog 命令不再注册，也不得作为 shipped helper 保留。catalog search、catalog variants、install-plan 与 install execution 必须走 SDK `RuntimeLocalService` typed API：

- `runtime_local_pick_asset_manifest_path`：统一选取 `resolved/<local-asset-id>/asset.manifest.json`。
- asset file/bundle directory pickers：renderer wrapper 调用 Kit standard `file-dialog.open`，不得注册 `runtime_local_pick_asset_file` / `runtime_local_pick_asset_directory`。
- asset reveal/root reveal：renderer wrapper 调用 Kit standard `file-reveal.reveal`，不得注册 `runtime_local_assets_reveal_in_folder` / `runtime_local_assets_reveal_root_folder`。
- recommendation page 必须经 SDK `RuntimeLocalService.GetRecommendationFeed` 读取 capability-scoped candidate feed；Tauri 不得保留 recommendation feed / model-index / host-fit helper surface。

产品约束：

- local asset inventory 的 list、verified list、install、import、remove、health/readiness、intake、transfer session 与 progress 必须固定走 `RuntimeLocalService` typed APIs。
- `Active Downloads` / `Active Imports` 必须来自 runtime-owned transfer plane（`ListLocalTransfers` + `WatchLocalTransfers`），不得再以 Desktop/Tauri local transfer state 为真源。
- Tauri `runtime_local_*` 命令若仍存在于 shipped app，只能作为 shell-native/helper IPC；不得暴露或暗示 Desktop/Tauri local runtime state 是本地模型真源。
- ordinary-user local speech product flow 必须表现为单一 `Local Speech` bundle projection；helper IPC 不得把 env/bootstrap、host readiness 或 capability materialization 暗示成 Desktop/Tauri-owned install truth。
- ordinary-user local speech 的 env/bootstrap、host init、capability materialization 只能在显式 `Download` 用户确认后启动；capability 选择、route 尝试、被动刷新或 recommendation helper 不得静默触发后台下载/初始化。
- helper IPC 若返回 speech 相关状态，只能被 renderer 投影为 runtime-owned bundle state；不得据此创建独立 Desktop persisted speech bundle owner。
- Desktop Local Model Center 不得再暴露手动 start/stop toggle；本地模型 readiness 必须直接反映 runtime 状态。
- 自动纳管只适用于 go-runtime 已有结构化 local model record 的模型，以及 verified/catalog/manual-download 已携带显式 declaration 的 intake 来源。
- 用户直接 copy 到 `~/.nimi/models` 的裸文件必须统一进入 RuntimeLocalService `ScanUnregisteredAssets` intake：
  - 根目录或未知目录文件不得静默纳管；
  - 识别到 typed folder（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `ae` / `clip` / `controlnet` / `lora` / `auxiliary`）时，可视为 high-confidence declaration；
  - high-confidence 且 declaration 完整的项允许自动导入；
  - low-confidence 项只允许预填 review UI，不得静默注册。
- recommendation feed 的 request-driven resolve、model-index cache 与 host-fit 排序属于 RuntimeLocalService；Desktop 不得用 Tauri audit/event payload 暗示本地 recommendation owner。

执行命令：

- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`

## D-IPC-017 — Desktop-Local Avatar Carrier IPC Decommission Boundary

After desktop-local avatar carrier decommission, desktop no longer ships desktop-local avatar import,
registry, binding, or asset-read IPC commands as an admitted carrier path.

Decommissioned command family:

- `desktop_agent_avatar_resource_pick_vrm`
- `desktop_agent_avatar_resource_pick_live2d`
- `desktop_agent_avatar_resource_import_vrm`
- `desktop_agent_avatar_resource_import_live2d`
- `desktop_agent_avatar_resource_list`
- `desktop_agent_avatar_resource_delete`
- `desktop_agent_avatar_resource_read_asset`
- `desktop_agent_avatar_resource_read_relative_asset`
- `desktop_agent_avatar_binding_get`
- `desktop_agent_avatar_binding_set`
- `desktop_agent_avatar_binding_clear`

Fixed rules:

- these commands must not be registered in the shipped desktop Tauri invoke
  surface after Pack 4 closes
- desktop renderer code must fail closed if stale code paths still reference
  this retired command family; it must not recreate local carrier execution or
  silently proxy the behavior through another helper
- `desktop_avatar_launch_handoff` remains the admitted write-side desktop avatar
  command on the canonical bridge path
- `desktop_avatar_close_handoff` is admitted as a bounded desktop write-side
  avatar instance operation; it may only request closure of a specific live
  `avatar_instance_id` and must fail closed when the target instance is absent
  or stale
- `desktop_avatar_instance_registry_list` is admitted as a read-only desktop
  avatar inventory command; it may only read avatar-published live instance
  projection state and must not mutate, persist, or fabricate inventory truth
- retained desktop shell-owned cosmetic surfaces such as backdrop storage remain
  separate non-carrier authority and must not be conflated with avatar carrier
  import/binding truth

## D-IPC-018 - Running Desktop Open Intent Bridge

Desktop owns the running-process bridge that accepts host-stamped
`DesktopOpenEnvelope` requests from Kit standard shell hosts. The bridge is a
running-only focus/navigation intake. It must not start Desktop, register a
single-instance launch queue, or admit OS custom-scheme production transport.

Bridge requirements:

- presence descriptor path is
  `~/.nimi/run/desktop/open-intent/presence.v1.json`, under the stable
  `resolve_nimi_dir()` host-control root and not under product `nimi_data`
- descriptor writes use owner-only permissions where supported, atomic
  temp-file plus rename/replace, symlink refusal, startup stale cleanup, and
  token/Authorization redaction
- exact-loopback bridge accepts only `POST /v1/open-intent` with bearer token,
  rejects GET/OPTIONS/browser preflight shapes, exposes no CORS surface, and
  validates the full envelope before focusing Desktop
- `desktop_open_intent_set_ready` marks the bridge ready only after the
  renderer listener is mounted and its heartbeat is fresh; PageLoad Started,
  renderer reload, listener cleanup, window destroyed, ExitRequested, and
  stale renderer heartbeat reset readiness to not-ready
- not-ready requests return `desktop-open-desktop-not-ready` immediately and
  must not be queued or replayed
- accepted requests focus/show Desktop and emit a dedicated Desktop Open Intent
  renderer event; they must not reuse external `menu-bar://open-tab`

Desktop Open target catalog ownership is recorded in
`tables/desktop-open-targets.yaml`. Platform may reference this table from
`P-DOPEN-*`, but Platform must not duplicate Desktop IA values.

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
- `tables/desktop-open-targets.yaml` — Desktop-owned target catalog consumed by the running Desktop Open Intent bridge
- `tables/runtime-config-open-actions.yaml` — Desktop-owned Runtime Config action targets for Desktop Open Intent
