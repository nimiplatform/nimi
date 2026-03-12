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
2. **Servers**：并行启动 gRPC server 与 HTTP server。
3. **Engines**：若引擎 SUPERVISED 模式启用（`K-LENG-004`），创建 engine.Manager 并按配置启动 enabled 的引擎。引擎就绪后注入 endpoint 环境变量。启动失败不阻塞 daemon，标记 `DEGRADED`，并写入引擎 bootstrap 失败审计与 provider 不健康原因上下文。
4. **Ready**：状态从 `STARTING` 迁移到 `READY`，同步 gRPC health serving status。
5. **Probes**：启动资源采样（1s 周期，内存）与 AI Provider 健康探测（`K-PROV-003`）。

## K-DAEMON-003 优雅停机

收到 shutdown 信号后：

1. 状态迁移到 `STOPPING`，同步 gRPC health serving status。
2. 停止 supervised 引擎（`engineMgr.StopAll()`，`K-LENG-004`）。
3. 停止资源采样与 AI Provider 探测。
4. 带超时关闭 HTTP server（默认 10s，通过 `K-DAEMON-009` 配置）。
5. 带超时关闭 gRPC server（GracefulStop，同一超时后 ForceStop）。
6. 状态迁移到 `STOPPED`。

停机期间只读方法允许通过 lifecycle 拦截器（`K-DAEMON-005`）。

**跨状态机联动（K-DAEMON-003）**：daemon 进入 `STOPPING` 时对 in-flight 任务的影响：

| 子系统状态机 | STOPPING 行为 | 引用 |
|---|---|---|
| 活跃 ScenarioJob（K-JOB-001） | lifecycle 拦截器拒绝新请求（`UNAVAILABLE`）；已提交的 in-flight job 继续执行直到 gRPC GracefulStop 超时后强制终止 | K-DAEMON-003 step 4 |
| 活跃 Workflow（K-WF-003） | 同 ScenarioJob：新请求拒绝，in-flight workflow 在 GracefulStop 期内继续，超时后强制终止。客户端收到流断开 | K-DAEMON-003 step 4 |
| 活跃 StreamScenario | GracefulStop 等待活跃流完成或超时后 ForceStop 中断。客户端收到 gRPC status 中断 | K-DAEMON-003 step 4 |
| 长生命周期订阅流（K-STREAM-010） | server 以 `CANCELLED` 关闭所有活跃订阅流 | K-STREAM-010 |
| Supervised 引擎（K-LENG-004） | 向所有引擎进程发送 SIGTERM，超时后 SIGKILL。引擎停止在 gRPC/HTTP 关闭前执行 | K-DAEMON-003 step 2 |
| Provider 探测（K-PROV-003） | 停止探测 | K-DAEMON-003 step 3 |
| Session 内存 map（K-AUTHSVC-012） | 进程退出后丢失，所有 session 失效 | K-AUTHSVC-012 |

**设计决策**：Phase 1 不实现 in-flight 任务的优雅排空（drain）——GracefulStop 超时到期后直接 ForceStop。此决策基于：桌面端 daemon 重启预期为低频事件，AI 推理任务可由客户端重试恢复。若未来引入服务端持久化队列，可在此基础上添加排空协议。

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

> **参数选取依据**：全局并发上限 8 ≈ 典型桌面端 CPU 核数（4-8 核），避免 AI 推理独占全部计算资源。Per-app 上限 2 保证至少 4 个 app 可同时发起推理（8 / 2 = 4），防止单个 app 独占全部 slot。饥饿检测 30s 对应 StreamScenario 的首包超时 10s + 总超时 120s 之间的中间值，确保在流式请求超时前有机会检测到调度饥饿。

## K-DAEMON-008 AI 超时层次

各 AI 操作的默认超时值（事实源：`tables/ai-timeout-defaults.yaml`）：

| 操作 | 默认超时 |
|---|---|
| ExecuteScenario(TEXT_GENERATE) | 30s |
| StreamScenario（首包） | 10s |
| StreamScenario（总） | 120s |
| ExecuteScenario(TEXT_EMBED) | 20s |
| SubmitScenarioJob(image) | 120s |
| SubmitScenarioJob(video) | 300s |
| StreamScenario(SPEECH_SYNTHESIZE) | 45s |
| SubmitScenarioJob(stt) | 90s |

超时可通过请求级 `timeout_ms` 覆盖（但不得超过服务端上限）。

## K-DAEMON-009 配置解析

配置通过多源合并，优先级从高到低：

1. **环境变量**（`NIMI_RUNTIME_*`）
2. **配置文件**（`~/.nimi/config.json`，JSON 格式，`schemaVersion=1`）
3. **硬编码默认值**

关键配置项的权威字段清单见 `tables/config-schema.yaml`（K-CFG-017）。

校验规则：
- 地址必须为合法 `host:port` 格式。
- `ShutdownTimeout > 0`。

仅支持 canonical 配置路径：`~/.nimi/config.json`。Runtime 不读取、不迁移 legacy 路径 `~/.nimi/runtime/config.json`。

Phase 1 配置文件 schema 权威字段清单见 `tables/config-schema.yaml`（`K-CFG-017`）。

未知字段在解析时忽略（向前兼容）。

**`config set` 响应 reasonCode**：

- `CONFIG_RESTART_REQUIRED`：至少一个 `restart` 列字段发生了变更。
- `CONFIG_APPLIED`：仅 `hot` 列字段发生变更，或无实质变更。

消费端（Desktop）仅在收到 `CONFIG_RESTART_REQUIRED` 时提示用户重启 runtime。

`providers.*`、`engines.localai.*`、`engines.nexa.*` 变更属于 restart 范畴，必须返回 `CONFIG_RESTART_REQUIRED`。

## K-DAEMON-010 HTTP 健康端点

Daemon 暴露以下 HTTP 端点：

| 路径 | 方法 | 语义 |
|---|---|---|
| `/livez` | GET | 进程存活：始终返回 200 |
| `/readyz` | GET | 就绪检查：`READY` 时 200，否则 503 |
| `/healthz` | GET | 综合健康：同 `/readyz` |
| `/v1/runtime/health` | GET | 完整健康快照（JSON，字段同 `GetRuntimeHealthResponse`） |

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
