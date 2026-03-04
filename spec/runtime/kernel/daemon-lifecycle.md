# Daemon Lifecycle Contract

> Owner Domain: `K-DAEMON-*`

## K-DAEMON-001 Runtime 健康状态机

Runtime daemon 维护全局健康状态，枚举固定为：

| 状态 | 值 | 含义 |
|---|---|---|
| `STOPPED` | 1 | 未启动或已停止 |
| `STARTING` | 2 | 启动中 |
| `READY` | 3 | 就绪，可接受请求 |
| `DEGRADED` | 4 | 降级，部分功能不可用 |
| `STOPPING` | 5 | 停机中 |

迁移规则见 `tables/daemon-health-states.yaml`。

初始状态为 `STOPPED`。

## K-DAEMON-002 启动序列

Daemon 启动固定为以下阶段：

1. **Config**：加载配置（`K-DAEMON-009`），校验地址与超时。
2. **Workers**：若 worker 模式启用，启动 worker supervisor（`K-DAEMON-004`）。失败则状态置 `STOPPED`，写审计（`runtime.lifecycle` / `startup.failed`），返回错误。
3. **Servers**：并行启动 gRPC server 与 HTTP server。
4. **Engines**：若引擎 SUPERVISED 模式启用（`K-LENG-004d`），创建 engine.Manager 并按配置启动 enabled 的引擎。引擎就绪后注入 endpoint 环境变量。启动失败不阻塞 daemon，标记 `DEGRADED`。
5. **Ready**：状态从 `STARTING` 迁移到 `READY`，同步 gRPC health serving status。
6. **Probes**：启动资源采样（1s 周期，内存）与 AI Provider 健康探测（`K-PROV-003`）。

## K-DAEMON-003 优雅停机

收到 shutdown 信号后：

1. 状态迁移到 `STOPPING`，同步 gRPC health serving status。
2. 停止 supervised 引擎（`engineMgr.StopAll()`，`K-LENG-004b`）。
3. 停止 worker supervisor。
4. 停止资源采样与 AI Provider 探测。
5. 带超时关闭 HTTP server（默认 10s，通过 `K-DAEMON-009` 配置）。
6. 带超时关闭 gRPC server（GracefulStop，同一超时后 ForceStop）。
7. 状态迁移到 `STOPPED`。

停机期间只读方法允许通过 lifecycle 拦截器（`K-DAEMON-005`）。

**跨状态机联动（K-DAEMON-003a）**：daemon 进入 `STOPPING` 时对 in-flight 任务的影响：

| 子系统状态机 | STOPPING 行为 | 引用 |
|---|---|---|
| 活跃 MediaJob（K-JOB-001） | lifecycle 拦截器拒绝新请求（`UNAVAILABLE`）；已提交的 in-flight job 继续执行直到 gRPC GracefulStop 超时后强制终止 | K-DAEMON-003 step 5 |
| 活跃 Workflow（K-WF-003） | 同 MediaJob：新请求拒绝，in-flight workflow 在 GracefulStop 期内继续，超时后强制终止。客户端收到流断开 | K-DAEMON-003 step 5 |
| 活跃 StreamGenerate/SynthesizeSpeechStream | GracefulStop 等待活跃流完成或超时后 ForceStop 中断。客户端收到 gRPC status 中断 | K-DAEMON-003 step 5 |
| 长生命周期订阅流（K-STREAM-010） | server 以 `CANCELLED` 关闭所有活跃订阅流 | K-STREAM-010 |
| Supervised 引擎（K-LENG-004b） | 向所有引擎进程发送 SIGTERM，超时后 SIGKILL。引擎停止在 worker/gRPC 关闭前执行 | K-DAEMON-003 step 2 |
| Provider 探测（K-PROV-003） | 停止探测 | K-DAEMON-003 step 4 |
| Session 内存 map（K-AUTHSVC-012） | 进程退出后丢失，所有 session 失效 | K-AUTHSVC-012 |

**设计决策**：Phase 1 不实现 in-flight 任务的优雅排空（drain）——GracefulStop 超时到期后直接 ForceStop。此决策基于：桌面端 daemon 重启预期为低频事件，AI 推理任务可由客户端重试恢复。若未来引入服务端持久化队列，可在此基础上添加排空协议。

## K-DAEMON-004 Worker 监管

Worker 模式启用时（`NIMI_RUNTIME_WORKER_MODE=true`），daemon 以 supervisor 角色管理子进程：

- **Worker 名称枚举**：`ai`、`model`、`workflow`、`script`、`localruntime`。仅此 5 个有效名称，其他忽略。
- **Worker → Service 映射**：

  | Worker 名称 | 对应 gRPC Service | 说明 |
  |---|---|---|
  | `ai` | `RuntimeAiService` | AI 推理执行（Generate/Stream/Embed/MediaJob） |
  | `model` | `RuntimeModelService` | 模型注册与管理 |
  | `workflow` | `RuntimeWorkflowService` | 工作流 DAG 执行 |
  | `script` | `ScriptWorkerService` | 脚本沙箱执行 |
  | `localruntime` | `RuntimeLocalRuntimeService` | 本地模型生命周期管理 |
- **启动**：为每个 worker 启动独立 goroutine 执行重启循环。
- **重启策略**：2s base backoff + uniform jitter [0, 500ms]，context 取消时退出循环。
- **环境注入**：`NIMI_RUNTIME_WORKER_ROLE=<name>`，`NIMI_RUNTIME_WORKER_SOCKET=<socket_path>`。
- **Socket 路径**：`~/.nimi/runtime/worker-<name>.sock`（Unix Domain Socket）。
- **存活检测**：supervisor 通过 `os.Process.Wait()` 检测 worker 进程退出。每个 worker 在独立 goroutine 中执行 `Wait()`，进程退出时立即触发状态回调与重启循环。
- **状态回调**：worker 停止时触发 `onStateChange(name, running=false, err)`：
  - 若 daemon 非 `STOPPING`/`STOPPED`，健康状态降级为 `DEGRADED`（reason: `worker:<name> unavailable`）。
  - 所有 worker 恢复运行后，若当前为 worker 原因的 `DEGRADED`，恢复为 `READY`。

## K-DAEMON-005 gRPC 拦截器链

gRPC 请求经过 6 层有序拦截器，unary 与 stream 分别注册：

| 顺序 | 名称 | Unary | Stream | 职责 |
|---|---|---|---|---|
| 1 | version | 是 | 是 | 版本协商：向 response header 注入 `x-nimi-runtime-version` |
| 2 | lifecycle | 是 | 是 | 健康状态门控：`STOPPING`/`STOPPED` 时拒绝非只读请求（`UNAVAILABLE`） |
| 3 | protocol | 是 | 是（仅解析） | 信封解析、幂等性检查（unary only，`K-DAEMON-006`）、metadata 提取 |
| 4 | authn | 是 | 是 | 认证校验：解析并校验 metadata `authorization`，投影调用方身份 |
| 5 | authz | 是 | 是（仅 ExportAuditEvents） | 保护能力校验：通过 grant service 验证 token 有效性 |
| 6 | audit | 是 | 是 | 审计记录：请求/响应写入审计日志，更新使用量指标 |

## K-DAEMON-006 幂等性契约

- **适用范围**：仅 unary RPC，流式 RPC 不做幂等性检查。
- **去重键**：`AppID + IdempotencyKey`（从 gRPC metadata 提取）。
- **TTL**：24 小时，过期后同一键可重新执行。
- **命中行为**：返回缓存的响应，不重新执行。
- **缺失 IdempotencyKey**：不做去重，正常执行。
- **存储介质**：进程内内存 map。不跨重启持久化（重启后相同 key 可重新执行）。
- **容量上限**：默认 10,000 条，超限时按 LRU 淘汰最久未访问的条目。

> **参数选取依据**：24h TTL 覆盖跨时区用户的同一操作重试窗口（最远场景：用户跨日期线后重试前一天的操作）。10,000 条容量覆盖单日高频用户的全部 unary RPC 调用量（估算：每次 AI 请求 ~3 个 unary RPC，单用户日均 AI 请求 < 1,000 次，10k 留 3x 余量）。每条记录约 200 bytes（request hash + response snapshot），总计 ~2 MB，在桌面端可忽略。

## K-DAEMON-007 调度器并发模型

AI 执行路径使用双层信号量控制并发：

- **全局并发上限**：默认 8（可配置）。
- **每 App 并发上限**：默认 2（可配置）。
- **获取顺序**：先获取全局信号量，再获取 per-app 信号量。释放顺序相反。
- **饥饿检测**：等待时间超过阈值（默认 30s）时，`AcquireResult.Starved=true`。
- **空 AppID 处理**：归入 `_default` 键。

> **参数选取依据**：全局并发上限 8 ≈ 典型桌面端 CPU 核数（4-8 核），避免 AI 推理独占全部计算资源。Per-app 上限 2 保证至少 4 个 app 可同时发起推理（8 / 2 = 4），防止单个 app 独占全部 slot。饥饿检测 30s 对应 StreamGenerate 的首包超时 10s + 总超时 120s 之间的中间值，确保在流式请求超时前有机会检测到调度饥饿。

## K-DAEMON-008 AI 超时层次

各 AI 操作的默认超时值（事实源：`tables/ai-timeout-defaults.yaml`）：

| 操作 | 默认超时 |
|---|---|
| Generate | 30s |
| StreamGenerate（首包） | 10s |
| StreamGenerate（总） | 120s |
| Embed | 20s |
| SubmitMediaJob(image) | 120s |
| SubmitMediaJob(video) | 300s |
| SynthesizeSpeechStream | 45s |
| SubmitMediaJob(stt) | 90s |

超时可通过请求级 `timeout_ms` 覆盖（但不得超过服务端上限）。

## K-DAEMON-009 配置解析

配置通过多源合并，优先级从高到低：

1. **环境变量**（`NIMI_RUNTIME_*`）
2. **配置文件**（`~/.nimi/config.json`，JSON 格式，`schemaVersion=1`）
3. **硬编码默认值**

关键配置项：

| 配置 | 环境变量 | 默认值 |
|---|---|---|
| gRPC 地址 | `NIMI_RUNTIME_GRPC_ADDR` | `127.0.0.1:46371` |
| HTTP 地址 | `NIMI_RUNTIME_HTTP_ADDR` | `127.0.0.1:46372` |
| 停机超时 | `NIMI_RUNTIME_SHUTDOWN_TIMEOUT` | `10s` |
| Local state 路径 | `NIMI_RUNTIME_LOCAL_RUNTIME_STATE_PATH` | `~/.nimi/runtime/local-runtime-state.json` |
| 配置文件路径 | `NIMI_RUNTIME_CONFIG_PATH` | `~/.nimi/config.json` |

校验规则：
- 地址必须为合法 `host:port` 格式。
- `ShutdownTimeout > 0`。

仅支持 canonical 配置路径：`~/.nimi/config.json`。Runtime 不读取、不迁移 legacy 路径 `~/.nimi/runtime/config.json`。

Phase 1 配置文件 schema（`~/.nimi/config.json`）权威字段清单：

| Key | Type | Default | Reload | 说明 | 来源 |
|---|---|---|---|---|---|
| `schemaVersion` | int | `1` | — | 配置版本号 | K-DAEMON-009 |
| `grpcAddr` | string | `127.0.0.1:46371` | restart | gRPC 监听地址 | K-DAEMON-009 |
| `httpAddr` | string | `127.0.0.1:46372` | restart | HTTP 监听地址 | K-DAEMON-009 |
| `shutdownTimeoutSeconds` | int | `10` | restart | 优雅停机超时（秒） | K-DAEMON-003 |
| `localRuntimeStatePath` | string | `~/.nimi/runtime/local-runtime-state.json` | restart | 本地状态持久化路径 | K-LOCAL-016 |
| `workerMode` | bool | `false` | restart | 是否启用 worker 模式 | K-DAEMON-004 |
| `aiHealthIntervalSeconds` | int | `8` | hot | AI Provider 探活间隔（秒） | K-PROV-003 |
| `aiHttpTimeoutSeconds` | int | `30` | hot | AI Provider HTTP 超时（秒） | K-PROV-003 |
| `globalConcurrencyLimit` | int | `8` | hot | AI 全局并发上限 | K-DAEMON-007 |
| `perAppConcurrencyLimit` | int | `2` | hot | AI 单 App 并发上限 | K-DAEMON-007 |
| `idempotencyCapacity` | int | `10000` | hot | 幂等性存储容量上限 | K-DAEMON-006 |
| `maxDelegationDepth` | int | `3` | hot | 委托链最大深度 | K-GRANT-005 |
| `auditRingBufferSize` | int | `20000` | hot | 审计事件环形缓冲上限 | K-AUDIT-007 |
| `usageStatsBufferSize` | int | `50000` | hot | 使用量样本环形缓冲上限 | K-AUDIT-008 |
| `localAuditCapacity` | int | `5000` | hot | Local 审计事件存储上限 | K-LOCAL-016 |
| `sessionTtlMinSeconds` | int | `60` | hot | Session TTL 下限（秒） | K-AUTHSVC-004 |
| `sessionTtlMaxSeconds` | int | `86400` | hot | Session TTL 上限（秒） | K-AUTHSVC-004 |
| `providers` | map | `{}` | hot | AI Provider 路由表（key=provider name） | K-DAEMON-009 |
| `engines.localai.enabled` | bool | `false` | restart | 启用 LocalAI 引擎 SUPERVISED 模式 | K-LENG-004d |
| `engines.localai.version` | string | `3.12.1` | restart | LocalAI 二进制版本 | K-LENG-004d |
| `engines.localai.port` | int | `1234` | restart | LocalAI 监听端口 | K-LENG-004d |
| `engines.nexa.enabled` | bool | `false` | restart | 启用 Nexa 引擎 SUPERVISED 模式 | K-LENG-004d |
| `engines.nexa.version` | string | `` | restart | Nexa 版本（空=系统安装） | K-LENG-004d |
| `engines.nexa.port` | int | `8000` | restart | Nexa 监听端口 | K-LENG-004d |

`providers` 值结构：`{ baseUrl: string, apiKeyEnv: string }`。`apiKey` 明文字段被禁止（写入校验拒绝，`CONFIG_SECRET_POLICY_VIOLATION`），仅允许 `apiKeyEnv` 引用环境变量名。

未知字段在解析时忽略（向前兼容）。

**Reload 列语义**：

- `restart`：变更后需要 daemon 重启才生效（涉及网络绑定、进程模型等启动时固化的资源）。
- `hot`：变更后无需重启，下次使用时即刻生效。
- `—`：不可变更（`schemaVersion`）。

**`config set` 响应 reasonCode**：

- `CONFIG_RESTART_REQUIRED`：至少一个 `restart` 列字段发生了变更。
- `CONFIG_APPLIED`：仅 `hot` 列字段发生变更，或无实质变更。

消费端（Desktop）仅在收到 `CONFIG_RESTART_REQUIRED` 时提示用户重启 runtime。

## K-DAEMON-011 版本 Metadata 交换协议

Runtime daemon 必须通过 gRPC server metadata 暴露版本信息，供 SDK 进行版本兼容判定（`S-TRANSPORT-005`）。

**协议**：

- gRPC server 在每个 RPC 的 response header metadata 中携带 `x-nimi-runtime-version`，值为 semver 格式（如 `0.1.0`）。
- 版本值在 daemon 启动时确定，整个进程生命周期内不变。
- SDK 从首次成功 RPC 的 response metadata 中提取版本，缓存后用于后续兼容判定。
- 若 metadata 缺失（旧版 Runtime 或非 gRPC 传输），SDK 按 `S-TRANSPORT-005` 的 best-effort 策略处理。

**与 Desktop 的关系**：

- Desktop 通过 `runtime_bridge_status` 返回的 `daemonVersion` 字段获取版本（`D-IPC-002`/`D-IPC-009`），不依赖本规则。
- 本规则面向 `node-grpc` 传输的独立 SDK 消费者。两条路径语义等价，传输手段不同。

## K-DAEMON-010 HTTP 健康端点

Daemon 暴露以下 HTTP 端点：

| 路径 | 方法 | 语义 |
|---|---|---|
| `/livez` | GET | 进程存活：始终返回 200 |
| `/readyz` | GET | 就绪检查：`READY` 时 200，否则 503 |
| `/healthz` | GET | 综合健康：同 `/readyz` |
| `/v1/runtime/health` | GET | 完整健康快照（JSON，字段同 `GetRuntimeHealthResponse`） |
