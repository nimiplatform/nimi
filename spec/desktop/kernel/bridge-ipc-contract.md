# Bridge IPC Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop Tauri IPC 桥接契约。定义 renderer 进程通过 `window.__TAURI__.core.invoke` 与 Tauri backend 通信的命令集、类型解析、错误归一化。

## D-IPC-001 — Runtime Defaults 命令

`runtime_defaults` 命令返回 `RuntimeDefaults`，包含：
- `realm: RealmDefaults`（realmBaseUrl、realtimeUrl、accessToken）
- `runtime: RuntimeExecutionDefaults`（provider、model、agent 绑定参数）

所有字段通过 `parseRuntimeDefaults` 防御性解析。

## D-IPC-002 — Daemon 生命周期命令

Daemon 管理命令集：`runtime_bridge_status`、`runtime_bridge_start`、`runtime_bridge_stop`、`runtime_bridge_restart`。

返回 `RuntimeBridgeDaemonStatus`：
- `running: boolean`
- `managed: boolean`
- `launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID'`
- `grpcAddr: string`

**Runtime 健康状态 UI 映射**（对应 Runtime K-DAEMON-001 五态）：

| Runtime 状态 | UI 指示器 | 可用操作 | 超时预期 |
|---|---|---|---|
| `STOPPED` | 灰色/离线标记 | start | — |
| `STARTING` | 加载动画/启动中 | — (等待) | 30s 启动超时 |
| `READY` | 绿色/就绪标记 | stop, restart | — |
| `DEGRADED` | 黄色/降级警告 | stop, restart | — |
| `STOPPING` | 加载动画/停止中 | — (等待) | 10s 停机超时（K-DAEMON-003） |

Desktop 通过 `runtime_bridge_status` 轮询获取 `running` 状态。`running=true` 对应 `READY` 或 `DEGRADED`，`running=false` 对应 `STOPPED`。`STARTING`/`STOPPING` 过渡态通过命令执行期间的 UI 加载状态表示。

## D-IPC-003 — Config 读写命令

`runtime_bridge_config_get` / `runtime_bridge_config_set` 命令。

- `ConfigGetResult`：`{ path, config }`
- `ConfigSetResult`：`{ path, reasonCode?, actionHint?, config }`

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
- **版本信息获取**：通过 `runtime_bridge_status` 返回的 daemon 版本信息判定。
- **降级行为**：功能不可用的场景在 UI 中展示明确提示，不隐藏功能入口。

## D-IPC-010 — 懒加载桥接模块

高容量模块（`local-ai`、`external-agent`）使用动态 `import()` 懒加载：

- `loadLocalAiBridge()` — 缓存 Promise，首次调用触发加载。
- `loadExternalAgentBridge()` — 同上。

## D-IPC-011 — Local AI 命令

Local AI 桥接通过 `loadLocalAiBridge()` 懒加载（`D-IPC-010`），命令集：

- `local_ai_list_models` / `local_ai_list_verified_models`：列出本地/验证模型。
- `local_ai_install_model` / `local_ai_install_verified_model` / `local_ai_import_model`：安装/导入模型。
- `local_ai_start_model` / `local_ai_stop_model` / `local_ai_remove_model`：模型生命周期管理。
- `local_ai_health_models`：模型健康检查。
- `local_ai_list_audits` / `local_ai_append_inference_audit`：推理审计。
- `local_ai_pick_manifest_path`：选取模型清单文件。
- `local_ai_subscribe_download_progress`：订阅下载进度。

## Fact Sources

- `tables/ipc-commands.yaml` — IPC 命令清单
- `tables/error-codes.yaml` — Bridge 错误码映射
