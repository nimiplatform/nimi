# Bridge IPC Contract

> Authority: Desktop Kernel

## Scope

Desktop Tauri IPC 桥接契约。定义 renderer 进程通过 `@tauri-apps/api/core` / `@tauri-apps/api/event` 的显式桥接与 Tauri backend 通信的命令集、类型解析、错误归一化。

## D-IPC-001 — Bootstrap / Auth Session 命令

> **Authority Disposition**：
> 共享 auth session 命令（`auth_session_load` / `auth_session_save` / `auth_session_clear`）作为 local first-party account truth surface 已 superseded。Replacement authority 为 `RuntimeAccountService`（`K-ACCSVC-*`）；`auth_session_*` IPC 路径必须删除或 hard-block，不允许保留 dual-read。`runtime_defaults` 中 `realm.accessToken` / `realm.jwksUrl` / `realm.revocationUrl` 不得继续作为 local first-party account truth source（仅允许 explicit Web/cloud adapter 模式或 dev-only override 使用，且必须 fenced）。local first-party Desktop data clients 若需要 Realm access token，必须通过 Runtime `GetAccessToken` 或等价 provider 获取短期 token。

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、revocationUrl、jwtIssuer、jwtAudience）
- `runtime: RuntimeExecutionDefaults`（targetType、targetAccountId、agentId、worldId、userConfirmedUpload 等非路由 bootstrap hints）

`runtime_defaults` 不得继续承载 provider、model、connector、local provider endpoint、OpenAI-compatible endpoint 或 credential ref truth。Chat / Runtime Config 的 route selection、readiness 与 connector binding 只能来自 Runtime/SDK route projection 或 connector projection。

所有字段通过 `parseRuntimeDefaults` 防御性解析。

共享 auth session 命令集（**superseded for local first-party account truth**）：

- `auth_session_load`
- `auth_session_save`
- `auth_session_clear`

These command names may remain registered only as disabled Kit/Tauri scaffold
stubs. Each command MUST fail closed and MUST NOT read, decrypt, write, clear,
or validate `~/.nimi/auth/session.v1.json` for local first-party Desktop
account truth. Renderer code, Desktop bootstrap, Avatar, Tester, and Web
adapters MUST NOT consume these commands for revalidation, token handoff,
logout, or user-switch detection.

Authenticated local consumer revalidation belongs to Runtime account-session
projection (`GetAccountSessionStatus`, `SubscribeAccountSessionEvents`,
`GetAccessToken`) and scoped binding validation. Desktop may render Runtime
account projection and route user intent, but it must not reintroduce
shared-session coherence as a Desktop bridge surface.

## D-IPC-002 — Daemon 生命周期命令

Daemon 管理命令集：`runtime_bridge_status`、`runtime_bridge_start`、`runtime_bridge_stop`、`runtime_bridge_restart`。

返回 `RuntimeBridgeDaemonStatus`：
- `running: boolean`
- `managed: boolean`
- `launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID'`
- `grpcAddr: string`
- `version?: string`（release 模式下必须来自 bundled runtime 执行 `nimi version --json` 的自报版本，不得取自 manifest 猜测值）

**Runtime 健康状态 UI 映射**（对应 Runtime K-DAEMON-001 五态）：

| Runtime 状态 | UI 指示器 | 可用操作 | 超时预期 |
|---|---|---|---|
| `STOPPED` | 灰色/离线标记 | start | — |
| `STARTING` | 加载动画/启动中 | — (等待) | 120s 启动超时（对齐 K-LENG-004 SUPERVISED 最差情形） |
| `READY` | 绿色/就绪标记 | stop, restart | — |
| `DEGRADED` | 黄色/降级警告 | stop, restart | —（Phase 1 通过 `running=true` 统一覆盖 READY/DEGRADED，DEGRADED 独立检测需 daemon 暴露结构化健康状态，Phase 2 增强） |
| `STOPPING` | 加载动画/停止中 | — (等待) | 10s 停机超时（K-DAEMON-003） |

Desktop 通过 `runtime_bridge_status` 轮询获取 `running` 状态。`running=true` 对应 `READY` 或 `DEGRADED`，`running=false` 对应 `STOPPED`。`STARTING`/`STOPPING` 过渡态通过命令执行期间的 UI 加载状态表示。

**Provider 健康探测窗口**：Daemon 到达 READY 后启动 provider 健康探测（K-PROV-003），首次探测立即执行但结果需 0~8s 到达。在此窗口内，所有 provider 状态为 `unknown`。Desktop UI 行为：

- READY 后、首次探测结果到达前：provider 列表展示"检测中"状态（非"就绪"），不阻塞用户操作但不显示绿色健康标记。
- 首次探测结果到达后：按 healthy/unhealthy 更新 UI 指示器。
- Phase 1 简化：`running=true` 统一覆盖 READY/DEGRADED，provider 健康细粒度展示为 Phase 2。Phase 1 不展示 provider 级健康指示器，仅展示 daemon 级 running 状态。

## D-IPC-003 — Config 读写命令

`runtime_bridge_config_get` / `runtime_bridge_config_set` 命令。

- `ConfigGetResult`：`{ path, config }`
- `ConfigSetResult`：`{ path, reasonCode?, actionHint?, config }`

**配置可见性规则**：

- **UI 暴露子集**：Phase 1 Desktop UI 仅暴露安全且用户可理解的配置项。完整字段清单由 K-DAEMON-009 定义，Desktop UI 暴露子集为实现定义。
- **热重载 vs 重启**：`config_set` 通过 `reasonCode` 指示后续行为：`CONFIG_APPLIED`（无需重启）或 `CONFIG_RESTART_REQUIRED`（需重启 daemon 生效）。Desktop 收到 `CONFIG_RESTART_REQUIRED` 时执行 `D-BOOT-001` 中 Runtime JWT Config Sync 定义的重启分支。
- **环境变量覆盖不可见性**：环境变量优先级高于配置文件（K-DAEMON-009 三层优先级）。Desktop UI 展示配置文件中的值，不反映环境变量覆盖。此为已知限制，Phase 1 不解决。
- **向前兼容**：Runtime 新增配置字段在 Desktop 未更新时不可见。`config_get` 返回完整 JSON（含未识别字段），`config_set` 透传未识别字段（不丢弃）。

canonical 配置路径固定为 `~/.nimi/runtime/config.json`（K-CFG-001）；Desktop 不得保留 root-level `~/.nimi/config.json` fallback，该旧路径仅可作为显式迁移输入。

## D-IPC-004 — HTTP 代理命令

`http_request` is a fail-closed Desktop shell network helper, not a general HTTP
proxy and not platform truth. It may dispatch only:

- configured Runtime / Realm origins from `runtime_defaults` / E2E runtime
  defaults; or
- exact SDK connector-auth acquisition profile endpoints generated from
  `.nimi/spec/sdks/kernel/tables/connector-auth-acquisition-profiles.yaml`.

Renderer-supplied `Authorization` is admitted only for configured Runtime /
Realm origins. Provider acquisition endpoints must be selected by
`connectorAuthProfileId` + `connectorAuthPurpose` and must not receive a
renderer-supplied Authorization header through this command.

- 每次调用生成唯一 `invokeId` 用于追踪。
- 日志记录 `requestUrl`、`requestMethod`、`requestBodyBytes`。

## D-IPC-005 — UI 命令

- `open_external_url`：在系统浏览器打开外部 URL。
- Private or governance-chain data publication must be implemented through a Runtime/Realm-owned workflow with an explicit product spec, not a Desktop-only native dialog.
- `start_window_drag`：原生窗口拖拽。
- `menu_bar_sync_runtime_health`：renderer 向 Tauri backend 同步 menu bar 所需的 runtime/provider 健康摘要。
- `menu_bar_complete_quit`：renderer 在完成 shell cleanup 后确认执行 app quit。

## D-IPC-006 — OAuth 命令

- `oauth_token_exchange`：交换 OAuth authorization code。
- `oauth_listen_for_code`：监听 redirect URI 回调。

支持 PKCE（codeVerifier）和 clientSecret 两种模式。

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

Desktop 编译发布与 Runtime daemon 独立更新，版本偏差是真实场景。版本兼容行为：

- **packaged desktop / release 模式**：Desktop 启动时必须要求 runtime exact match。missing / unparseable / mismatch 全部是 blocking error，不允许任何 drift。
- **source development / runtime 模式**：可继续沿用 major fail-close、minor/patch warn 的受控兼容行为。
- **版本信息获取**：通过 `runtime_bridge_status` 返回的 `version` 字段（D-IPC-002 `RuntimeBridgeDaemonStatus`）获取。release 模式下该值必须是 runtime 自报真值；runtime/source 模式下可按开发态语义提供。
- **降级行为**：功能不可用的场景在 UI 中展示明确提示，不隐藏功能入口。
- **与 SDK S-TRANSPORT-005 的关系**：S-TRANSPORT-005 定义的"metadata 交换"版本协商是通用 SDK 契约。Desktop 通过 `version` IPC 字段实现等效功能（Tauri IPC 传输无需 gRPC metadata），满足 S-TRANSPORT-005 的语义要求。

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
- `desktop_update_install` 必须仅消费已缓存的 update bytes。调用前必须先停止 managed runtime、失效 channel pool、再进入 updater 安装阶段；未下载时必须 fail-close。
- `desktop_update_state_get` / desktop update 事件流必须共享同一个状态机语义：`idle -> checking -> available -> downloading -> downloaded -> installing -> readyToRestart -> error`。

## D-IPC-016 — Shared Tauri Bridge Authority

- `kit/shell/tauri/**` (P-KIT-041) is the single shared implementation authority for app-agnostic Tauri host glue.
- D-IPC-001 (auth session), D-IPC-002 (daemon lifecycle), D-IPC-004 (HTTP proxy), D-IPC-005 (UI commands `open_external_url`), D-IPC-006 (OAuth), D-IPC-009 (invoke infrastructure, `log_renderer_event`) shared implementations live in `kit/shell/tauri/**`.
- Apps must not duplicate these shared command implementations in app-local Rust code.
- Apps must not use `#[path = "..."]` to compile another app's Rust source for shared bridge functionality.
- App-specific Tauri commands for desktop menu bar and desktop self-update remain app-local.
  D-IPC-008 External Agent is not app-local command authority; it must travel
  through SDK Runtime projection.

## D-IPC-012 — IPC 桥与 SDK 路径分界

Desktop 到 Runtime 存在两条数据路径。两者分界为设计意图，不是临时妥协：

**SDK gRPC 路径**（D-BOOT-004 → SDK Runtime client）：
- 应用层 Runtime 能力：AI 推理（ExecuteScenario、StreamScenario）、Connector 管理（CreateConnector、ListConnectors 等）、Auth/Grant（RegisterApp、OpenSession 等）、场景任务（SubmitScenarioJob 等）
- 本地资产控制面：`RuntimeLocalService` 负责 local asset inventory 的 list、import/install、health/readiness、intake、audit、transfer session 与 progress watch；`StartLocalAsset` / `StopLocalAsset` 保留为 runtime 维护能力，不是 Desktop 产品主路径
- agent presentation projection：runtime-owned persistent `AgentPresentationProfile` 通过 `runtime.agent.*` 暴露；Desktop avatar current-surface state 不得借道升格为 IPC canonical truth
- Phase 1 健康监控（GetRuntimeHealth、ListAIProviderHealth、SubscribeRuntimeHealthEvents、SubscribeAIProviderHealthEvents）— 见 S-TRANSPORT-007 Mode D Phase 1 投影
- Phase 2 服务（Workflow、Knowledge、Audit、AppMessage、Script）

**Runtime IPC payload 鉴权字段**：
- `runtime_bridge_unary` / `runtime_bridge_stream_open` / `runtime_bridge_stream_close` 构成完整的 gRPC-over-IPC 传输面。payload 必须支持顶层可选字段 `authorization`。
- 该字段由 SDK Runtime transport 自动注入，不从 `metadata.extra` 透传。
- Renderer 业务层不得手工构造此字段。
- 注：此为 Tauri IPC transport 对 SDK `S-TRANSPORT-010`（传输内部实现细节）的等价实现。`authorization` 字段虽在 IPC payload 中作为顶层字段对 renderer 架构可见，但其语义与 S-TRANSPORT-010 一致——由 transport 层自动管理，业务层不得 bypass。

**IPC 桥路径**（Tauri backend → daemon）：
- 平台层 Runtime 管理：daemon 生命周期（D-IPC-002: start/stop/restart/status）
- 配置管理（D-IPC-003: config_get/config_set + hot-reload 提示）
- HTTP 代理（D-IPC-004: proxy fetch）
- OAuth 流（D-IPC-006: token exchange）
- External Agent 管理（D-IPC-008: SDK-projected Runtime gateway/token/action
  state only）
- shell-native / host helper 能力（D-IPC-011：picker、reveal、notification、以及仍未下沉到 runtime 的 host-local helper）

**分界原则**：
- SDK 路径承载**应用逻辑 RPC**——调用语义与平台无关，独立 SDK 消费者可复用。
- SDK 路径同时承载 local model 控制面真源；desktop 不得以 Tauri host state 取代 `RuntimeLocalService`。
- avatar persistent presentation profile 属于 SDK/runtime path；avatar transient interaction state 属于 renderer surface-local truth，不得发明第二套 Tauri command owner。
- IPC 桥路径承载**平台管理操作与原生壳能力**——依赖 Tauri backend 进程管理/文件选择/系统集成能力，与 Desktop 生命周期耦合。
- 独立 SDK 消费者（无 Tauri 环境）需通过 `nimi` CLI 或外部工具完成 IPC 桥路径的等效操作（如 `nimi daemon start`、`nimi config set`、`nimi local install`）。

补充约束：

- passive asset（`vae` / `ae` / `clip` / `controlnet` / `lora` / `auxiliary`）列表、verified catalog、安装、导入、移除、intake、transfer/progress 与 lifecycle 全部以 `RuntimeLocalService` 为真源；Tauri 命令若仍存在，只能作为 host helper，不得构成第二条产品执行路径。
- local image workflow 的 `engineConfig`、`components`、`profile_overrides` 必须沿 `desktop -> sdk/runtime -> runtime` 原样透传；Desktop 不得改写为绝对路径。

cloud 路径必须固定经由 Runtime connector APIs；Desktop 不得恢复 legacy adapter factory、直接 `listModels()` 或 `healthCheck()` 调用以绕开 Runtime。

**健康监控双路径等价性**：D-IPC-002 通过 `runtime_bridge_status` 轮询获取 daemon 健康状态，SDK 通过 `SubscribeRuntimeHealthEvents` gRPC 流获取等效数据。两条路径语义等价，Desktop 选择 IPC 路径是因为 Tauri backend 已维护 daemon 连接状态。

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

## D-IPC-010 — 懒加载桥接模块

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- local runtime bridge loader — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

## D-IPC-011 — Local Runtime 命令

Local Runtime 桥接通过 `loadLocalRuntimeBridge()` 懒加载（`D-IPC-010`），命令集统一使用 `runtime_local_*` 前缀（`local_runtime::commands`）：

Local-runtime Tauri 命令使用 `runtime_local_assets_*` 前缀。旧 `runtime_local_models_*` / `runtime_local_artifacts_*` CRUD/lifecycle/catalog 命令不再注册，也不得作为 shipped helper 保留。catalog search、catalog variants、install-plan 与 install execution 必须走 SDK `RuntimeLocalService` typed API：

- `runtime_local_assets_reveal_in_folder` / `runtime_local_assets_reveal_root_folder`：在系统文件管理器中打开目录。
- `runtime_local_pick_asset_manifest_path`：统一选取 `resolved/<local-asset-id>/asset.manifest.json`。
- `runtime_local_pick_asset_directory`：选取 bundle 目录，供 SDK `RuntimeLocalService` bundle import 使用。
- `runtime_local_pick_asset_file`：选取任意待导入的 asset 文件。
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

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
