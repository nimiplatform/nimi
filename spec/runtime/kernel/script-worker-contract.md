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

## K-SCRIPT-004 Deferred Decisions

以下决策在 Phase 2 Draft 阶段有意推迟，实现期允许修正：

| 决策 | 当前状态 | 推迟原因 |
|---|---|---|
| **支持的 runtime 类型** | `runtime` 字段定义但未枚举合法值 | 需评估 JavaScript（V8 isolate）、Lua、WASM 等方案后确定 Phase 1 默认 runtime |
| **网络策略** | 未定义 | 需确定脚本是否允许网络访问（DNS、HTTP 出站）及白名单策略 |
| **代码大小限制** | 未定义 | `code` 字段无最大长度约束，需定义上限防止资源滥用 |
| **并发执行上限** | 未定义 | 需确定同时运行的 script worker 数量上限及排队策略 |
| **输出大小限制** | 未定义 | `output` Struct 无最大大小约束 |
