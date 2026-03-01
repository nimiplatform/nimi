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
4. **Ready**：状态从 `STARTING` 迁移到 `READY`，同步 gRPC health serving status。
5. **Probes**：启动资源采样（1s 周期，内存）与 AI Provider 健康探测（`K-PROV-003`）。

## K-DAEMON-003 优雅停机

收到 shutdown 信号后：

1. 状态迁移到 `STOPPING`，同步 gRPC health serving status。
2. 停止 worker supervisor。
3. 停止资源采样与 AI Provider 探测。
4. 带超时关闭 HTTP server（默认 10s，通过 `K-DAEMON-009` 配置）。
5. 带超时关闭 gRPC server（GracefulStop，同一超时后 ForceStop）。
6. 状态迁移到 `STOPPED`。

停机期间只读方法允许通过 lifecycle 拦截器（`K-DAEMON-005`）。

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

gRPC 请求经过 4 层有序拦截器，unary 与 stream 分别注册：

| 顺序 | 名称 | Unary | Stream | 职责 |
|---|---|---|---|---|
| 1 | lifecycle | 是 | 是 | 健康状态门控：`STOPPING`/`STOPPED` 时拒绝非只读请求（`UNAVAILABLE`） |
| 2 | protocol | 是 | 是（仅解析） | 信封解析、幂等性检查（unary only，`K-DAEMON-006`）、metadata 提取 |
| 3 | authz | 是 | 是（仅 ExportAuditEvents） | 保护能力校验：通过 grant service 验证 token 有效性 |
| 4 | audit | 是 | 是 | 审计记录：请求/响应写入审计日志，更新使用量指标 |

## K-DAEMON-006 幂等性契约

- **适用范围**：仅 unary RPC，流式 RPC 不做幂等性检查。
- **去重键**：`AppID + IdempotencyKey`（从 gRPC metadata 提取）。
- **TTL**：24 小时，过期后同一键可重新执行。
- **命中行为**：返回缓存的响应，不重新执行。
- **缺失 IdempotencyKey**：不做去重，正常执行。
- **存储介质**：进程内内存 map。不跨重启持久化（重启后相同 key 可重新执行）。
- **容量上限**：默认 10,000 条，超限时按 LRU 淘汰最久未访问的条目。

## K-DAEMON-007 调度器并发模型

AI 执行路径使用双层信号量控制并发：

- **全局并发上限**：默认 8（可配置）。
- **每 App 并发上限**：默认 2（可配置）。
- **获取顺序**：先获取全局信号量，再获取 per-app 信号量。释放顺序相反。
- **饥饿检测**：等待时间超过阈值（默认 30s）时，`AcquireResult.Starved=true`。
- **空 AppID 处理**：归入 `_default` 键。

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

遗留路径迁移：`~/.nimi/runtime/config.json` → `~/.nimi/config.json`，原子写入 + 删除旧文件。

Phase 1 配置文件 schema（`~/.nimi/config.json`）权威字段清单：

| Key | Type | Default | 说明 | 来源 |
|---|---|---|---|---|
| `schemaVersion` | int | `1` | 配置版本号 | K-DAEMON-009 |
| `grpcAddr` | string | `127.0.0.1:46371` | gRPC 监听地址 | K-DAEMON-009 |
| `httpAddr` | string | `127.0.0.1:46372` | HTTP 监听地址 | K-DAEMON-009 |
| `shutdownTimeoutSeconds` | int | `10` | 优雅停机超时（秒） | K-DAEMON-003 |
| `localRuntimeStatePath` | string | `~/.nimi/runtime/local-runtime-state.json` | 本地状态持久化路径 | K-LOCAL-016 |
| `workerMode` | bool | `false` | 是否启用 worker 模式 | K-DAEMON-004 |
| `aiHealthIntervalSeconds` | int | `8` | AI Provider 探活间隔（秒） | K-PROV-003 |
| `aiHttpTimeoutSeconds` | int | `30` | AI Provider HTTP 超时（秒） | K-PROV-003 |
| `globalConcurrencyLimit` | int | `8` | AI 全局并发上限 | K-DAEMON-007 |
| `perAppConcurrencyLimit` | int | `2` | AI 单 App 并发上限 | K-DAEMON-007 |
| `idempotencyCapacity` | int | `10000` | 幂等性存储容量上限 | K-DAEMON-006 |
| `maxDelegationDepth` | int | `3` | 委托链最大深度 | K-GRANT-005 |
| `auditRingBufferSize` | int | `20000` | 审计事件环形缓冲上限 | K-AUDIT-007 |
| `usageStatsBufferSize` | int | `50000` | 使用量样本环形缓冲上限 | K-AUDIT-008 |
| `localAuditCapacity` | int | `5000` | Local 审计事件存储上限 | K-LOCAL-016 |
| `sessionTtlMinSeconds` | int | `60` | Session TTL 下限（秒） | K-AUTHSVC-004 |
| `sessionTtlMaxSeconds` | int | `86400` | Session TTL 上限（秒） | K-AUTHSVC-004 |

未知字段在解析时忽略（向前兼容）。

> **设计决策**：Cloud provider 凭据（`K-PROV-002` 列出的 `NIMI_RUNTIME_*_API_KEY` / `NIMI_RUNTIME_*_BASE_URL` 环境变量）有意不纳入配置文件 schema。原因：凭据仅通过环境变量注入，避免明文持久化到磁盘（与 `K-LENG-009` 凭据安全策略一致）。实现者不应将此视为 schema 遗漏。

## K-DAEMON-010 HTTP 健康端点

Daemon 暴露以下 HTTP 端点：

| 路径 | 方法 | 语义 |
|---|---|---|
| `/livez` | GET | 进程存活：始终返回 200 |
| `/readyz` | GET | 就绪检查：`READY` 时 200，否则 503 |
| `/healthz` | GET | 综合健康：同 `/readyz` |
| `/v1/runtime/health` | GET | 完整健康快照（JSON，字段同 `GetRuntimeHealthResponse`） |
