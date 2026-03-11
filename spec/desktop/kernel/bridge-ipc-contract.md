# Bridge IPC Contract

> Authority: Desktop Kernel

## Scope

Desktop Tauri IPC 桥接契约。定义 renderer 进程通过 `window.__TAURI__.core.invoke` 与 Tauri backend 通信的命令集、类型解析、错误归一化。

## D-IPC-001 — Runtime Defaults 命令

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken、jwksUrl、jwtIssuer、jwtAudience）
- `runtime: RuntimeExecutionDefaults`（provider、model、agent 绑定参数）

所有字段通过 `parseRuntimeDefaults` 防御性解析。

## D-IPC-002 — Daemon 生命周期命令

Daemon 管理命令集：`runtime_bridge_status`、`runtime_bridge_start`、`runtime_bridge_stop`、`runtime_bridge_restart`。

返回 `RuntimeBridgeDaemonStatus`：
- `running: boolean`
- `managed: boolean`
- `launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID'`
- `grpcAddr: string`
- `daemonVersion: string`（daemon 版本号，用于 D-IPC-009 版本协商）

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
- `runtime_mod_install` / `runtime_mod_update` / `runtime_mod_uninstall`：mod 安装生命周期命令。
- `runtime_mod_read_manifest`：读取已安装 mod manifest。
- `runtime_mod_install_progress`：查询安装进度事件。
- `runtime_mod_read_local_entry`：读取 mod 入口源码。
- `runtime_mod_append_audit` / `runtime_mod_query_audit` / `runtime_mod_delete_audit`：mod 审计记录 CRUD。
- `runtime_mod_get_action_idempotency` / `runtime_mod_put_action_idempotency` / `runtime_mod_purge_action_idempotency`：action 幂等性记录。
- `runtime_mod_get_action_verify_ticket` / `runtime_mod_put_action_verify_ticket` / `runtime_mod_delete_action_verify_ticket` / `runtime_mod_purge_action_verify_tickets`：action 验证票据。
- `runtime_mod_put_action_execution_ledger` / `runtime_mod_query_action_execution_ledger` / `runtime_mod_purge_action_execution_ledger`：action 执行账本。
- `runtime_mod_media_cache_put` / `runtime_mod_media_cache_gc`：mod 媒体缓存写入与垃圾回收。

## D-IPC-008 — External Agent 命令

- `external_agent_issue_token`：签发 agent token。
- `external_agent_revoke_token`：吊销 agent token。
- `external_agent_list_tokens`：列出 agent tokens。
- `external_agent_sync_action_descriptors`：同步 action descriptors。
- `external_agent_complete_execution`：完成 action 执行。
- `external_agent_gateway_status`：获取 gateway 状态。

## D-IPC-009 — Invoke 基础设施

所有 IPC 调用通过 `invoke()` / `invokeChecked()` 统一入口：

- 前置检查 `hasTauriInvoke()`（`window.__TAURI__` 存在性）。
- 生成 `invokeId`（`${command}-${timestamp}-${random}`）。
- 结构化日志：invoke-start、invoke-success、invoke-failed。
- 错误归一化：`toBridgeUserError()` 将 Tauri 错误转为用户可读消息。

**版本协商**（引用 SDK `S-TRANSPORT-005`）：

Desktop 编译发布与 Runtime daemon 独立更新，版本偏差是真实场景。版本兼容行为：

- **major 不兼容**：Desktop 启动时检测到 Runtime major 版本断裂，必须 fail-close 并向用户展示升级提示，不允许静默降级为"部分可用"。
- **minor/patch 差异**：允许通过方法可用性检查做受控降级。不可用的 Phase 2 方法在 UI 中标记为"需要更新运行时"。
- **版本信息获取**：通过 `runtime_bridge_status` 返回的 `daemonVersion` 字段（D-IPC-002 `RuntimeBridgeDaemonStatus`）获取。解析为 semver，与 Desktop 编译时嵌入的兼容版本范围比对。
- **降级行为**：功能不可用的场景在 UI 中展示明确提示，不隐藏功能入口。
- **与 SDK S-TRANSPORT-005 的关系**：S-TRANSPORT-005 定义的"metadata 交换"版本协商是通用 SDK 契约。Desktop 通过 `daemonVersion` IPC 字段实现等效功能（Tauri IPC 传输无需 gRPC metadata），满足 S-TRANSPORT-005 的语义要求。

## D-IPC-012 — IPC 桥与 SDK 路径分界

Desktop 到 Runtime 存在两条数据路径。两者分界为设计意图，不是临时妥协：

**SDK gRPC 路径**（D-BOOT-004 → SDK Runtime client）：
- 应用层 Runtime 能力：AI 推理（ExecuteScenario、StreamScenario）、Connector 管理（CreateConnector、ListConnectors 等）、Auth/Grant（RegisterApp、OpenSession 等）、场景任务（SubmitScenarioJob 等）
- Phase 1 健康监控（GetRuntimeHealth、ListAIProviderHealth、SubscribeRuntimeHealthEvents、SubscribeAIProviderHealthEvents）— 见 S-TRANSPORT-007 Mode D Phase 1 投影
- Phase 2 服务（Workflow、Knowledge、Audit、AppMessage、Script）

**Runtime IPC payload 鉴权字段**：
- `runtime_bridge_unary` / `runtime_bridge_stream_open` payload 必须支持顶层可选字段 `authorization`。
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
- External Agent 管理（D-IPC-008: token/action/gateway）

**分界原则**：
- SDK 路径承载**应用逻辑 RPC**——调用语义与平台无关，独立 SDK 消费者可复用。
- IPC 桥路径承载**平台管理操作**——依赖 Tauri backend 进程管理能力，与 Desktop 生命周期耦合。
- 独立 SDK 消费者（无 Tauri 环境）需通过 `nimi` CLI 或外部工具完成 IPC 桥路径的等效操作（如 `nimi daemon start`、`nimi config set`、`nimi local-ai install`）。

补充约束：

- companion artifact（`vae` / `llm` / `controlnet` / `lora`）列表与安装状态通过 runtime local facade 暴露，不新增平行 Tauri artifact 命令字面量。
- LocalAI 动态图片工作流的 `engineConfig`、`components`、`profile_overrides` 必须沿 `desktop -> sdk/runtime -> runtime` 原样透传；Desktop 不得改写为绝对路径。

cloud 路径必须固定经由 Runtime connector APIs；Desktop 不得恢复 legacy adapter factory、直接 `listModels()` 或 `healthCheck()` 调用以绕开 Runtime。

**健康监控双路径等价性**：D-IPC-002 通过 `runtime_bridge_status` 轮询获取 daemon 健康状态，SDK 通过 `SubscribeRuntimeHealthEvents` gRPC 流获取等效数据。两条路径语义等价，Desktop 选择 IPC 路径是因为 Tauri backend 已维护 daemon 连接状态。

执行命令：

- `pnpm check:desktop-cloud-runtime-only`

## D-IPC-010 — 懒加载桥接模块

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- `loadLocalAiBridge()` — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

## D-IPC-011 — Local Runtime 命令

Local Runtime 桥接通过 `loadLocalRuntimeBridge()` 懒加载（`D-IPC-010`），命令集统一使用 `runtime_local_*` 前缀（`local_runtime::commands`）：

- `runtime_local_models_list` / `runtime_local_models_verified_list`：列出本地/验证模型。
- `runtime_local_models_catalog_search` / `runtime_local_models_catalog_list_variants`：目录搜索与变体列举。
- `runtime_local_models_catalog_resolve_install_plan`：解析安装计划。
- `runtime_local_models_install` / `runtime_local_models_install_verified` / `runtime_local_models_import`：创建安装会话并入队 / 导入模型。
- `runtime_local_models_import_file`：导入模型文件（copy + hash + manifest 生成）。
- `runtime_local_models_adopt`：将 go-runtime 已存在的结构化 `LocalAiModelRecord` 纳管到 Desktop/Tauri state，不触发下载或类型选择。
- `runtime_local_downloads_list` / `runtime_local_downloads_pause` / `runtime_local_downloads_resume` / `runtime_local_downloads_cancel`：下载会话查询与控制。
- `runtime_local_models_start` / `runtime_local_models_stop` / `runtime_local_models_remove`：模型生命周期管理。
- `runtime_local_models_health`：模型健康检查。
- `runtime_local_models_reveal_in_folder`：在系统文件管理器中打开模型目录。
- `runtime_local_models_scan_orphans` / `runtime_local_models_scaffold_orphan`：孤立模型文件扫描与脚手架导入。
- `runtime_local_artifacts_scan_orphans` / `runtime_local_artifacts_scaffold_orphan`：孤立 companion 文件扫描与脚手架导入。
- `runtime_local_audits_list` / `runtime_local_append_inference_audit` / `runtime_local_append_runtime_audit`：推理与运行时审计。
- `runtime_local_pick_manifest_path`：选取 `~/.nimi/models/**/model.manifest.json`。
- `runtime_local_pick_artifact_manifest_path`：选取 `~/.nimi/models/**/artifact.manifest.json`。
- `runtime_local_pick_model_file`：选取任意待导入的主模型文件。
- `runtime_local_services_list` / `runtime_local_services_install` / `runtime_local_services_start` / `runtime_local_services_stop` / `runtime_local_services_health` / `runtime_local_services_remove`：本地服务管理。
- `runtime_local_nodes_catalog_list`：列出活跃服务的能力节点。
- `runtime_local_dependencies_resolve` / `runtime_local_dependencies_apply`：依赖解析与应用。
- `runtime_local_device_profile_collect`：设备能力采集（CPU/GPU/NPU/disk/ports）。
- `local-runtime://download-progress`：下载进度事件通道，事件字段包含 `state`（`queued|running|paused|failed|completed|cancelled`）、`reasonCode?`、`retryable?`。

companion artifact 补充：

- artifact list / verified list / install / import / remove 通过受管 Local Runtime bridge facade 暴露，但其数据面来自 runtime SDK `RuntimeLocalService`，不是新增 Tauri lifecycle command。
- companion acquisition 支持 verified artifact install、`artifact.manifest.json` import，以及独立的 orphan detect/scaffold lane；不得复用主模型 capability selector 或 scaffold command。
- `runtime_local_artifacts_scaffold_orphan` 固定生成 `engine=localai` 的 `artifact.manifest.json`，随后再经 runtime local facade 执行 `importLocalArtifact`。
- verified companion install 的失败恢复通过 desktop `Artifact Tasks` 行内 `Retry` 完成；artifact task 不是 download session。
- `artifact.manifest.json` picker 与 `model.manifest.json` picker 必须物理拆分，且都只允许 runtime models root 下的路径。
- Desktop 启动时必须先执行 Desktop/Tauri 已知模型 -> go-runtime 的 reconcile，再将 go-runtime-only 模型通过 `runtime_local_models_adopt` 自动纳管到 Tauri state。
- 自动纳管只适用于 go-runtime 已有结构化 `LocalAiModelRecord` 的模型；用户直接 copy 到 `~/.nimi/models` 的裸文件通过 `runtime_local_models_scan_orphans` / `runtime_local_models_scaffold_orphan` 路径，由用户选择能力后导入。
- companion orphan lane 允许与主模型 orphan lane 同时暴露同一裸文件；文件最终分类由用户选择的导入入口决定，导入成功后两条 lane 都必须在刷新后移除该文件。

执行命令：

- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`

## D-IPC-013 — Mod Developer Host 命令面

Desktop 作为 mod developer host 时，开发态 source 管理与 reload 能力必须通过受管 IPC surface 暴露，而不是要求用户改启动参数：

- source registry：列出、添加、移除、启用、禁用 mod source directories。
- storage dirs：读取当前 `nimi_dir` / `nimi_data_dir` / installed mods 路径，并更新 `nimi_data_dir`。
- developer mode：读取和切换 App 内的 Developer Mode 状态。
- reload controls：对 `dev` source 中的单个 mod 或全部 mod 执行 reload。
- diagnostics：列出 source 扫描结果、重复 `mod id` 冲突、最近 reload 结果。

这些命令属于平台管理操作，不属于 mod 业务 API，不得要求第三方作者直接操作环境变量或文件系统约定来替代。

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
