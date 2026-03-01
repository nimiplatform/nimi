# Workflow Contract

> Owner Domain: `K-WF-*`

## K-WF-001 WorkflowDefinition 结构

工作流定义为有向无环图（DAG）：

- `workflow_type`：工作流类型标识。
- `nodes`：节点列表（`repeated WorkflowNode`）。
- `edges`：边列表（`repeated WorkflowEdge`），定义节点间数据流。

`WorkflowEdge` 字段：`from_node_id`、`from_output`、`to_node_id`、`to_input`。

节点通过 `depends_on`（repeated string）声明前置依赖，执行引擎据此进行拓扑排序。

## K-WF-002 WorkflowNode 类型（事实源：`tables/workflow-node-types.yaml`）

节点类型固定 13 种，分三类：

**AI 节点（执行 AI 推理）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `AI_GENERATE` | 1 | `AiGenerateNodeConfig` | model_id, modal, system_prompt, tools, temperature, top_p, max_tokens, route_policy, fallback, timeout_ms, prompt |
| `AI_STREAM` | 2 | `AiStreamNodeConfig` | 同 AI_GENERATE |
| `AI_EMBED` | 3 | `AiEmbedNodeConfig` | model_id, route_policy, fallback, timeout_ms, inputs |
| `AI_IMAGE` | 4 | `AiImageNodeConfig` | model_id, route_policy, fallback, timeout_ms, prompt |
| `AI_VIDEO` | 5 | `AiVideoNodeConfig` | model_id, route_policy, fallback, timeout_ms, prompt |
| `AI_TTS` | 6 | `AiTtsNodeConfig` | model_id, route_policy, fallback, timeout_ms, text |
| `AI_STT` | 7 | `AiSttNodeConfig` | model_id, mime_type, route_policy, fallback, timeout_ms, audio_bytes |

**Transform 节点（数据变换）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `TRANSFORM_EXTRACT` | 20 | `ExtractNodeConfig` | json_path, source_input |
| `TRANSFORM_TEMPLATE` | 21 | `TemplateNodeConfig` | template, output_mime_type |
| `TRANSFORM_SCRIPT` | 22 | `ScriptNodeConfig` | runtime, code, timeout_ms, memory_limit_bytes |

**Control 节点（流程控制）：**

| 类型 | 枚举值 | Config | 关键字段 |
|---|---|---|---|
| `CONTROL_BRANCH` | 40 | `BranchNodeConfig` | condition, true_target, false_target |
| `CONTROL_MERGE` | 41 | `MergeNodeConfig` | strategy, min_completed |
| `CONTROL_NOOP` | 42 | `NoopNodeConfig` | （空） |

节点类型通过 `oneof type_config` 承载，运行时必须校验 `node_type` 与 `type_config` 分支的一致性。

## K-WF-003 Workflow 状态机（事实源：`tables/workflow-states.yaml`）

| 状态 | 值 | 含义 |
|---|---|---|
| `ACCEPTED` | 1 | 已接受 |
| `QUEUED` | 2 | 排队中 |
| `RUNNING` | 3 | 执行中 |
| `COMPLETED` | 4 | 成功完成 |
| `FAILED` | 5 | 失败 |
| `CANCELED` | 6 | 已取消 |
| `SKIPPED` | 7 | 已跳过 |

终态：`COMPLETED`、`FAILED`、`CANCELED`、`SKIPPED`。

## K-WF-004 事件流协议

`SubscribeWorkflowEvents` 返回 `stream WorkflowEvent`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `event_type` | WorkflowEventType | 事件类型 |
| `sequence` | uint64 | 单调递增序号 |
| `task_id` | string | 工作流任务 ID |
| `trace_id` | string | 追踪 ID |
| `timestamp` | Timestamp | 事件时间 |
| `node_id` | string | 节点 ID（节点级事件） |
| `progress_percent` | int32 | 进度百分比（0-100） |
| `reason_code` | ReasonCode | 结果码（失败/完成事件） |
| `payload` | Struct | 扩展数据 |

WorkflowEventType 枚举（12 种）：

1. `STARTED` — 工作流启动
2. `NODE_STARTED` — 节点开始执行
3. `NODE_PROGRESS` — 节点进度更新
4. `NODE_COMPLETED` — 节点完成
5. `NODE_SKIPPED` — 节点跳过
6. `COMPLETED` — 工作流完成
7. `FAILED` — 工作流失败
8. `CANCELED` — 工作流取消
9. `NODE_EXTERNAL_SUBMITTED` — 外部节点已提交
10. `NODE_EXTERNAL_RUNNING` — 外部节点执行中
11. `NODE_EXTERNAL_COMPLETED` — 外部节点完成
12. `NODE_EXTERNAL_FAILED` — 外部节点失败

终态事件后 server 正常关闭流。

## K-WF-005 执行模式

| 模式 | 值 | 含义 |
|---|---|---|
| `INLINE` | 1 | 节点在 workflow 进程内同步执行 |
| `EXTERNAL_ASYNC` | 2 | 节点委托给外部系统异步执行，通过 `callback_ref` 回调。`callback_ref` 协议（URL 格式、认证、重试、幂等性）在 Phase 2 后期定义，初始实现仅需支持 `INLINE` 模式 |

## K-WF-006 节点级状态追踪

`WorkflowNodeStatus` 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `node_id` | string | 节点 ID |
| `status` | WorkflowStatus | 节点状态（复用 workflow 状态枚举） |
| `attempt` | int32 | 当前尝试次数 |
| `reason` | string | 状态原因 |
| `provider_job_id` | string | 外部 Provider 作业 ID |
| `next_poll_at` | Timestamp | 下次轮询时间（外部异步） |
| `retry_count` | int32 | 已重试次数 |
| `last_error` | string | 最近错误 |

## K-WF-007 取消语义

`CancelWorkflow` 为异步请求：

- 请求成功返回 `Ack{ok=true}` 仅表示取消请求已接受。
- 实际取消在执行引擎下一个检查点生效。
- 已进入终态的节点不可取消。
- 取消完成后触发 `CANCELED` 事件。

## K-WF-008 重试配置

节点级重试通过 `WorkflowNode` 字段配置：

- `retry_max_attempts`：最大重试次数（0 = 不重试）。
- `retry_backoff`：退避策略字符串（如 `2s`、`exponential`）。

## K-WF-009 MergeStrategy

`MergeNodeConfig.strategy` 控制汇聚行为：

| 策略 | 含义 |
|---|---|
| `ALL` | 所有上游节点完成后触发 |
| `ANY` | 任一上游节点完成即触发 |
| `N_OF_M` | `min_completed` 个上游完成即触发 |

## K-WF-010 SubmitWorkflow 约束

- `app_id` 必填。
- `definition` 必须包含至少一个节点。
- 节点 DAG 不得有环。
- `timeout_ms` 为整个工作流的总超时。
- 返回 `task_id`（ULID）和 `accepted` 标记。

## K-WF-011 ResumeStrategy

节点恢复策略（外部异步模式适用）：

| 策略 | 含义 |
|---|---|
| `AUTO` | 外部完成后自动继续后续节点 |
| `MANUAL` | 外部完成后等待手动触发继续 |
