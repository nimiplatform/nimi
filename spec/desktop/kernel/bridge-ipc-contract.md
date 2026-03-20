# Bridge IPC Contract

> Authority: Desktop Kernel

## Scope

Desktop Tauri IPC 桥接契约。定义 renderer 进程通过 `window.__TAURI__.core.invoke` 与 Tauri backend 通信的命令集、类型解析、错误归一化。

## D-IPC-001 — Runtime Defaults 命令

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、jwtIssuer、jwtAudience）
- `runtime: RuntimeExecutionDefaults`（provider、model 与可透传的 runtime execution 字段）

所有字段通过 `parseRuntimeDefaults` 防御性解析。

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

canonical 配置路径固定为 `.nimi/config.json`；Desktop 不得保留 `.nimi/runtime/config.json` fallback。

## D-IPC-004 — HTTP 代理命令

`http_request` 命令：renderer 通过 Tauri backend 代理所有 HTTP 请求，绕过浏览器 CORS 限制。

- 每次调用生成唯一 `invokeId` 用于追踪。
- 日志记录 `requestUrl`、`requestMethod`、`requestBodyBytes`。

## D-IPC-005 — UI 命令

- `open_external_url`：在系统浏览器打开外部 URL。
- `confirm_private_sync`：确认私有数据同步。
- `start_window_drag`：原生窗口拖拽。
- `menu_bar_sync_runtime_health`：renderer 向 Tauri backend 同步 menu bar 所需的 runtime/provider 健康摘要。
- `menu_bar_complete_quit`：renderer 在完成 shell cleanup 后确认执行 app quit。

## D-IPC-006 — OAuth 命令

- `oauth_token_exchange`：交换 OAuth authorization code。
- `oauth_listen_for_code`：监听 redirect URI 回调。

支持 PKCE（codeVerifier）和 clientSecret 两种模式。

## D-IPC-007 — Mod 本地命令

Mod 本地持久化与审计命令集（`runtime_mod::commands`）：

- `runtime_mod_list_local_manifests`：列出 runtime mods 目录中的本地 mod 清单摘要。
- `runtime_mod_list_installed`：列出已安装 mod 清单。
- `runtime_mod_install` / `runtime_mod_update` / `runtime_mod_uninstall`：mod 安装生命周期命令。`runtime_mod_uninstall` 只卸载 package，不删除 `{nimi_data_dir}/mod-data/{mod_id}`。
- `runtime_mod_read_manifest`：读取已安装 mod manifest。
- `runtime_mod_install_progress`：查询安装进度事件。
- `runtime_mod_read_local_entry`：读取 mod 入口源码。
- `runtime_mod_read_local_asset`：读取 manifest 声明的本地 mod 图标资源，返回 `mimeType + base64`。
- `runtime_mod_append_audit` / `runtime_mod_query_audit` / `runtime_mod_delete_audit`：mod 审计记录 CRUD。
- `runtime_mod_get_action_idempotency` / `runtime_mod_put_action_idempotency` / `runtime_mod_purge_action_idempotency`：action 幂等性记录。
- `runtime_mod_get_action_verify_ticket` / `runtime_mod_put_action_verify_ticket` / `runtime_mod_delete_action_verify_ticket` / `runtime_mod_purge_action_verify_tickets`：action 验证票据。
- `runtime_mod_put_action_execution_ledger` / `runtime_mod_query_action_execution_ledger` / `runtime_mod_purge_action_execution_ledger`：action 执行账本。
- `runtime_mod_media_cache_put` / `runtime_mod_media_cache_gc`：mod 媒体缓存写入与垃圾回收。
- `runtime_mod_storage_file_read` / `runtime_mod_storage_file_write` / `runtime_mod_storage_file_delete` / `runtime_mod_storage_file_list` / `runtime_mod_storage_file_stat`：host-managed mod files 子树访问。
- `runtime_mod_storage_sqlite_query` / `runtime_mod_storage_sqlite_execute` / `runtime_mod_storage_sqlite_transaction`：host-managed per-mod sqlite 访问。
- `runtime_mod_storage_data_purge`：显式删除 `{nimi_data_dir}/mod-data/{mod_id}`，供 Mod Hub / Settings 发起数据清理动作。

存储边界固定如下：

- installed mod package 继续位于 `{nimi_data_dir}/mods`。
- mod 持久化数据固定位于 `{nimi_data_dir}/mod-data/{mod_id}`。
- `files` 仅允许访问 `files/` 子树，拒绝绝对路径、空路径、`..` 与符号链接越界。
- `sqlite` 仅允许访问 `sqlite/main.db`，并拒绝 `ATTACH`、`DETACH`、`VACUUM INTO`、`load_extension`。

## D-IPC-008 — External Agent 命令

- `external_agent_issue_token`：签发 agent token。
- `external_agent_revoke_token`：吊销 agent token。
- `external_agent_list_tokens`：列出 agent tokens。
- `external_agent_sync_action_descriptors`：同步 action descriptors。
- `external_agent_complete_execution`：完成 action 执行。
- `external_agent_gateway_status`：获取 gateway 状态。
- `external_agent_verify_execution_context`：在 action dispatch 前校验 external agent 执行上下文。

## D-IPC-009 — Invoke 基础设施

所有 IPC 调用通过 `invoke()` / `invokeChecked()` 统一入口：

- 前置检查 `hasTauriInvoke()`（`window.__TAURI__` 存在性）。
- 生成 `invokeId`（`${command}-${timestamp}-${random}`）。
- 结构化日志：invoke-start、invoke-success、invoke-failed。
- 错误归一化：`toBridgeUserError()` 将 Tauri 错误转为用户可读消息。

### IPC Infrastructure Commands (D-IPC-009)

- `get_system_resource_snapshot`：采集系统资源快照（CPU/内存/GPU），供设备画像使用。
- `log_renderer_event`：renderer 侧结构化日志转发到 Tauri backend logger（D-TEL-006 桥接入口）。

**版本协商**（引用 SDK `S-TRANSPORT-005`，并受 `self-update-contract.md` 约束）：

Desktop 编译发布与 Runtime daemon 独立更新，版本偏差是真实场景。版本兼容行为：

- **packaged desktop / release 模式**：Desktop 启动时必须要求 runtime exact match。missing / unparseable / mismatch 全部是 blocking error，不允许任何 drift。
- **source development / runtime 模式**：可继续沿用 major fail-close、minor/patch warn 的受控兼容行为。
- **版本信息获取**：通过 `runtime_bridge_status` 返回的 `version` 字段（D-IPC-002 `RuntimeBridgeDaemonStatus`）获取。release 模式下该值必须是 runtime 自报真值；runtime/source 模式下可按开发态语义提供。
- **降级行为**：功能不可用的场景在 UI 中展示明确提示，不隐藏功能入口。
- **与 SDK S-TRANSPORT-005 的关系**：S-TRANSPORT-005 定义的"metadata 交换"版本协商是通用 SDK 契约。Desktop 通过 `version` IPC 字段实现等效功能（Tauri IPC 传输无需 gRPC metadata），满足 S-TRANSPORT-005 的语义要求。

### Desktop Self-Update Surface (D-IPC-002, D-IPC-009)

Desktop 自更新命令集：

- `desktop_release_info_get`
- `desktop_update_state_get`
- `desktop_update_check`
- `desktop_update_download`
- `desktop_update_install`
- `desktop_update_restart`

约束：

- `desktop_release_info_get` 仅在 release metadata 初始化成功时返回 `DesktopReleaseInfo`；初始化失败必须返回错误，不得合成 fallback 版本。
- `desktop_update_download` 必须仅执行下载、验签与缓存 update bytes，并在成功后停在 `downloaded` 状态，不得隐式进入安装。
- `desktop_update_install` 必须仅消费已缓存的 update bytes。调用前必须先停止 managed runtime、失效 channel pool、再进入 updater 安装阶段；未下载时必须 fail-close。
- `desktop_update_state_get` / desktop update 事件流必须共享同一个状态机语义：`idle -> checking -> available -> downloading -> downloaded -> installing -> readyToRestart -> error`。

## D-IPC-012 — IPC 桥与 SDK 路径分界

Desktop 到 Runtime 存在两条数据路径。两者分界为设计意图，不是临时妥协：

**SDK gRPC 路径**（D-BOOT-004 → SDK Runtime client）：
- 应用层 Runtime 能力：AI 推理（ExecuteScenario、StreamScenario）、Connector 管理（CreateConnector、ListConnectors 等）、Auth/Grant（RegisterApp、OpenSession 等）、场景任务（SubmitScenarioJob 等）
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
- 本地 AI 模型资产管理（D-IPC-011: install/start/stop/remove/import/audit）
- HTTP 代理（D-IPC-004: proxy fetch）
- OAuth 流（D-IPC-006: token exchange）
- Mod 清单管理（D-IPC-007: list/read local manifests）
- Mod 图标资源读取（D-IPC-007: read local asset）
- External Agent 管理（D-IPC-008: token/action/gateway）

**分界原则**：
- SDK 路径承载**应用逻辑 RPC**——调用语义与平台无关，独立 SDK 消费者可复用。
- IPC 桥路径承载**平台管理操作**——依赖 Tauri backend 进程管理能力，与 Desktop 生命周期耦合。
- 独立 SDK 消费者（无 Tauri 环境）需通过 `nimi` CLI 或外部工具完成 IPC 桥路径的等效操作（如 `nimi daemon start`、`nimi config set`、`nimi local install`）。

补充约束：

- companion artifact（`vae` / `ae` / `llm` / `clip` / `controlnet` / `lora` / `auxiliary`）列表、verified catalog、安装、导入、移除与 intake/scaffold 管理统一落在 Tauri `runtime_local_artifacts_*` 或 `runtime_local_assets_*` command surface；不得再经 runtime SDK `RuntimeLocalService` 绕行第二条执行路径。
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

- `runtime_local_models_list` / `runtime_local_models_verified_list`：列出本地/验证模型。
- `runtime_local_models_catalog_search` / `runtime_local_models_catalog_list_variants`：目录搜索与变体列举。
- `runtime_local_models_catalog_resolve_install_plan`：解析安装计划。
- `runtime_local_recommendation_feed_get`：读取 capability-scoped recommendation feed；由 Desktop/Tauri 负责 model-index 拉取、本地缓存、设备适配计算与排序。
- `runtime_local_models_install` / `runtime_local_models_install_verified` / `runtime_local_models_import`：创建安装会话并入队 / 导入模型。
- `runtime_local_models_import_file`：导入模型文件（copy + hash + manifest 生成）。
- `runtime_local_models_adopt`：将 go-runtime 已存在的结构化 local model record 纳管到 Desktop/Tauri state，不触发下载或类型选择。
- `runtime_local_downloads_list` / `runtime_local_downloads_pause` / `runtime_local_downloads_resume` / `runtime_local_downloads_cancel`：下载会话查询与控制。
- `runtime_local_models_start` / `runtime_local_models_stop` / `runtime_local_models_remove`：模型生命周期管理。
- `runtime_local_models_health`：模型健康检查。
- `runtime_local_models_reveal_in_folder`：在系统文件管理器中打开模型目录。
- `runtime_local_models_reveal_root_folder`：在系统文件管理器中打开 runtime models 根目录。
- `runtime_local_models_scan_orphans` / `runtime_local_models_scaffold_orphan`：保留底层 main-model orphan detect/scaffold surface；统一 desktop intake UI 默认应优先使用 `runtime_local_assets_scan_unregistered`，但 specialized main-model flow 仍可复用该命令面。
- `runtime_local_artifacts_list` / `runtime_local_artifacts_verified_list`：列出已安装 / verified companion artifacts。
- `runtime_local_artifacts_install_verified` / `runtime_local_artifacts_import` / `runtime_local_artifacts_remove`：companion artifact 安装、导入、移除。
- `runtime_local_artifacts_scan_orphans`：保留底层 companion orphan detect surface；统一 desktop intake UI 默认应优先使用 `runtime_local_assets_scan_unregistered`。
- `runtime_local_artifacts_scaffold_orphan`：将 companion file scaffold 为 canonical `artifact.manifest.json`，随后再经 `runtime_local_artifacts_import` 纳管。
- `runtime_local_artifacts_adopt`：将 go-runtime 已存在的结构化 companion artifact record 纳管到 Desktop/Tauri state，不触发下载或导入。
- `runtime_local_assets_scan_unregistered`：扫描 `~/.nimi/models/` 根目录与一级子目录下未被 state 纳管的裸文件，返回统一 asset declaration suggestion、confidence 与 review state。
- `runtime_local_pick_asset_manifest_path`：统一选取 `resolved/<logical-model-id>/manifest.json` 或 `artifacts/<artifact-id>/artifact.manifest.json`。
- `runtime_local_audits_list` / `runtime_local_append_inference_audit` / `runtime_local_append_runtime_audit`：推理与运行时审计。
- `runtime_local_pick_manifest_path`：选取 `~/.nimi/models/**/resolved/**/manifest.json` 或兼容的当前 resolved manifest 路径。
- `runtime_local_pick_artifact_manifest_path`：选取 `~/.nimi/models/**/artifact.manifest.json`。
- `runtime_local_pick_model_file`：选取任意待导入的主模型文件。
- `runtime_local_services_list` / `runtime_local_services_install` / `runtime_local_services_start` / `runtime_local_services_stop` / `runtime_local_services_health` / `runtime_local_services_remove`：本地服务管理。
- `runtime_local_nodes_catalog_list`：列出活跃服务的能力节点。
- `runtime_local_profiles_resolve` / `runtime_local_profiles_apply`：profile-centric mod install flow 的一等 Tauri 命令，负责解析并执行 `manifest.ai.profiles` 中的 runtime entries。
- `runtime_local_device_profile_collect`：设备能力采集（CPU/GPU/NPU/disk/ports）。
- `runtime_local_models_catalog_search` / `runtime_local_models_catalog_list_variants` / `runtime_local_models_catalog_resolve_install_plan` 返回面允许附带统一 `recommendation` payload。
- recommendation page 允许新增只读的 `runtime_local_recommendation_feed_get` surface，用于 capability-scoped candidate feed；install 仍必须复用现有 `resolve_install_plan` / install-plan payload，不得新增私有安装协议。
- `runtime_local_device_profile_collect` 返回的设备画像必须包含 `total_ram_bytes`、`available_ram_bytes`，以及 GPU `total_vram_bytes?`、`available_vram_bytes?`、`memory_model`。
- `local-runtime://download-progress`：下载进度事件通道，事件字段包含 `state`（`queued|running|paused|failed|completed|cancelled`）、`reasonCode?`、`retryable?`。

companion artifact 补充：

- artifact list / verified list / install / import / remove 是一等 `runtime_local_artifacts_*` Tauri commands，数据真相由 Desktop/Tauri local runtime state 维护。
- companion acquisition 支持 verified artifact install、`artifact.manifest.json` import，以及统一 local asset intake 下的 artifact review/scaffold；不得要求用户手写 manifest。
- `runtime_local_artifacts_scaffold_orphan` 固定生成 canonical local artifact manifest，随后再经 `runtime_local_artifacts_import` 纳管。
- verified companion install 的失败恢复通过 desktop `Artifact Tasks` 行内 `Retry` 完成；artifact task 不是 download session。
- `runtime_local_pick_asset_manifest_path` 是 runtime models root 下唯一允许暴露给统一 import menu 的 manifest picker；内部仍必须区分 model manifest 与 artifact manifest 的校验与导入路径。
- Desktop 启动时必须先执行 Desktop/Tauri 已知模型 -> go-runtime 的 reconcile，再将 go-runtime-only 模型通过 `runtime_local_models_adopt` 自动纳管到 Tauri state。
- 自动纳管只适用于 go-runtime 已有结构化 local model record 的模型，以及 verified/catalog/manual-download 已携带显式 declaration 的 intake 来源。
- 用户直接 copy 到 `~/.nimi/models` 的裸文件必须统一进入 `runtime_local_assets_scan_unregistered` intake：
  - 根目录或未知目录文件不得静默纳管；
  - 识别到 typed folder（`chat` / `embedding` / `image` / `video` / `tts` / `stt` / `music` / `vae` / `ae` / `clip` / `controlnet` / `lora` / `llm` / `auxiliary`）时，可视为 high-confidence declaration；
  - high-confidence 且 declaration 完整的项允许自动导入；
  - low-confidence 项只允许预填 review UI，不得静默注册。
- recommendation 审计仅覆盖 request-driven resolve 面，不覆盖 installed list 之类的被动刷新：
  - `runtime_local_models_catalog_search`
  - `runtime_local_models_catalog_list_variants`
  - `runtime_local_models_catalog_resolve_install_plan`
  - `runtime_local_assets_scan_unregistered`
  - `runtime_local_recommendation_feed_get`
- 上述入口的 recommendation 解析沿现有 local runtime audit 面记录：
  - `recommendation_resolve_invoked`
  - `recommendation_resolve_completed`
  - `recommendation_resolve_failed`
- `runtime_local_recommendation_feed_get` 的 completed event 允许采用 feed-scoped 聚合 payload：
  - `itemId = recommend-feed:<capability>`
  - `modelId = null`
  - `source = model-index-feed`
  - 可追加 `itemCount` 与 `cacheState`

执行命令：

- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`

## D-IPC-013 — Mod Developer Host 命令面

Desktop 作为 mod developer host 时，开发态 source 管理与 reload 能力必须通过受管 IPC surface 暴露，而不是要求用户改启动参数：

- source registry：`runtime_mod_sources_list`、`runtime_mod_sources_upsert`、`runtime_mod_sources_remove` — 列出、添加/更新、移除 mod source directories。
- storage dirs：`runtime_mod_storage_dirs_get`、`runtime_mod_data_dir_set` — 读取当前 `nimi_dir` / `nimi_data_dir` / installed mods 路径，并更新 `nimi_data_dir`。
- developer mode：`runtime_mod_dev_mode_get`、`runtime_mod_dev_mode_set` — 读取和切换 App 内的 Developer Mode 状态。
- reload controls：`runtime_mod_reload`、`runtime_mod_reload_all` — 对 `dev` source 中的单个 mod 或全部 mod 执行 reload。
- diagnostics：`runtime_mod_diagnostics_list` — 列出 source 扫描结果、重复 `mod id` 冲突、最近 reload 结果。

这些命令属于平台管理操作，不属于 mod 业务 API，不得要求第三方作者直接操作环境变量或文件系统约定来替代。

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
