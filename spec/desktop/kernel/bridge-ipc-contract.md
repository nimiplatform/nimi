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
| `STARTING` | 加载动画/启动中 | — (等待) | 30s 启动超时 |
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

## D-IPC-006 — OAuth 命令

- `oauth_token_exchange`：交换 OAuth authorization code。
- `oauth_listen_for_code`：监听 redirect URI 回调。

支持 PKCE（codeVerifier）和 clientSecret 两种模式。

## D-IPC-007 — Mod 本地命令

- `runtime_mod_list_local_manifests`：列出本地 mod 清单。
- `runtime_mod_read_local_entry`：读取 mod 入口源码。

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

token-api 路径必须固定经由 Runtime connector APIs；Desktop 不得恢复 legacy adapter factory、直接 `listModels()` 或 `healthCheck()` 调用以绕开 Runtime。

**健康监控双路径等价性**：D-IPC-002 通过 `runtime_bridge_status` 轮询获取 daemon 健康状态，SDK 通过 `SubscribeRuntimeHealthEvents` gRPC 流获取等效数据。两条路径语义等价，Desktop 选择 IPC 路径是因为 Tauri backend 已维护 daemon 连接状态。

执行命令：

- `pnpm check:desktop-token-api-runtime-only`

## D-IPC-010 — 懒加载桥接模块

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- `loadLocalAiBridge()` — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

## D-IPC-011 — Local AI 命令

Local AI 桥接通过 `loadLocalAiBridge()` 懒加载（`D-IPC-010`），命令集：

- `local_ai_models_list` / `local_ai_models_verified_list`：列出本地/验证模型。
- `local_ai_models_install` / `local_ai_models_install_verified` / `local_ai_models_import`：创建安装会话并入队 / 导入模型。
- `local_ai_downloads_list` / `local_ai_downloads_pause` / `local_ai_downloads_resume` / `local_ai_downloads_cancel`：下载会话查询与控制。
- `local_ai_models_start` / `local_ai_models_stop` / `local_ai_models_remove`：模型生命周期管理。
- `local_ai_models_health`：模型健康检查。
- `local_ai_audits_list` / `local_ai_append_inference_audit`：推理审计。
- `local_ai_pick_manifest_path`：选取模型清单文件。
- `local-ai://download-progress`：下载进度事件通道，事件字段包含 `state`（`queued|running|paused|failed|completed|cancelled`）、`reasonCode?`、`retryable?`。

renderer 与 tauri backend 不得直接回流 legacy 私有 `local_ai_*` 命令字面量；调用方必须经由受管 bridge API 和 runtime facade 装配路径进入。

执行命令：

- `pnpm check:no-local-ai-private-calls`
- `pnpm check:no-local-ai-tauri-commands`

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
