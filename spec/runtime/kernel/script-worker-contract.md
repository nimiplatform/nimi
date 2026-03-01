# Script Worker Contract

> Owner Domain: `K-SCRIPT-*`

## K-SCRIPT-001 ScriptWorkerService 方法集合

`ScriptWorkerService` 方法固定为：

1. `Execute` — 在沙箱中执行脚本

## K-SCRIPT-002 Execute 语义

在隔离的 worker 子进程中执行脚本代码：

请求（`ExecuteRequest`）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | 是 | 关联的工作流任务 ID |
| `node_id` | string | 是 | 关联的节点 ID |
| `inputs` | map<string, Struct> | 否 | 输入数据映射 |
| `runtime` | string | 否 | 脚本运行时标识 |
| `code` | string | 是 | 脚本源码 |
| `timeout_ms` | int32 | 否 | 执行超时（毫秒） |
| `memory_limit_bytes` | int64 | 否 | 内存上限 |

响应（`ExecuteResponse`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `output` | Struct | 脚本输出 |
| `success` | bool | 执行是否成功 |
| `error_message` | string | 错误消息（失败时） |

## K-SCRIPT-003 沙箱约束

- 脚本在独立的 worker 子进程中执行（`K-DAEMON-004` worker 名称 `script`）。
- 通过 Unix Domain Socket 与 daemon 通信（IPC 路径：`~/.nimi/runtime/worker-script.sock`）。
- `timeout_ms` 超时后进程被强制终止。
- `memory_limit_bytes` 超限时进程被 OOM kill。
- 脚本无法访问 daemon 内存空间或文件系统（除 IPC socket）。

## K-SCRIPT-004 安全基线

ScriptWorker 的安全基线规则，实现必须在 Phase 2 启动时优先满足：

| 规则 | 约束 | 理由 |
|---|---|---|
| **网络策略** | 默认 **deny-all**：脚本进程不允许任何网络访问（DNS、TCP、UDP 出站均阻止）。如需网络访问，必须通过 `ExecuteRequest.options.network_policy` 显式声明，且仅允许白名单域名/IP。本地环回地址（127.0.0.0/8、::1）**始终阻止**（防止脚本访问 Runtime gRPC/HTTP 端点或其他本地服务） | 防止恶意脚本通过本地网络绕过安全边界 |
| **代码大小限制** | `code` 字段最大 **1 MB**（UTF-8 字节数）。超限返回 `INVALID_ARGUMENT` + `SCRIPT_CODE_TOO_LARGE` | 防止巨型代码块耗尽内存 |
| **并发执行上限** | 同时运行的 script worker 数量上限为 **4**（可通过 K-DAEMON-009 配置）。超限排队，排队超过 `timeout_ms` 则返回 `DEADLINE_EXCEEDED` | 防止脚本执行独占系统资源 |
| **输出大小限制** | `output` Struct 序列化后不得超过 **4 MB**。超限返回 `RESOURCE_EXHAUSTED` + `SCRIPT_OUTPUT_TOO_LARGE` | 防止脚本产出巨型输出 |

## K-SCRIPT-005 Deferred Decisions

以下决策在 Phase 2 Draft 阶段有意推迟，实现期允许修正：

| 决策 | 当前状态 | 推迟原因 |
|---|---|---|
| **支持的 runtime 类型** | `runtime` 字段定义但未枚举合法值 | 需评估 JavaScript（V8 isolate）、Lua、WASM 等方案后确定 Phase 1 默认 runtime |
| **网络白名单配置** | K-SCRIPT-004 定义了 deny-all 默认策略，白名单的具体配置格式（域名 vs IP、通配符、端口规则）待定义 | 需根据实际 mod 需求确定白名单粒度 |
