# ScenarioJob Lifecycle Contract

> Owner Domain: `K-JOB-*`

## K-JOB-001 适用 RPC

- 创建/执行：`SubmitScenarioJob`
- 查询/控制：`GetScenarioJob` `CancelScenarioJob` `SubscribeScenarioJobEvents` `GetScenarioArtifacts`

查询/控制 RPC 不走 connector 路径，走 job 元数据路径。

## K-JOB-002 ScenarioJob 状态机

ScenarioJob 状态枚举固定为 7 态（事实源：`tables/job-states.yaml`）：

| 状态 | terminal | 含义 |
|---|---|---|
| `SUBMITTED` | false | 已提交，等待调度 |
| `QUEUED` | false | 已入队，等待执行资源 |
| `RUNNING` | false | 执行中 |
| `COMPLETED` | true | 执行成功 |
| `FAILED` | true | 执行失败 |
| `CANCELED` | true | 被取消 |
| `TIMEOUT` | true | 执行超时 |

事件流在任一终态（`terminal=true`）后可正常关闭。

## K-JOB-003 凭据快照

`SubmitScenarioJob` 必须快照：

- `provider_type`
- `endpoint`
- `credential`

这三个字段对应 `K-KEYSRC-004` step 6 执行上下文三元组（`provider_type`/`endpoint`/`credential`）。快照在 job 创建时从执行上下文复制，后续轮询/取消/结果获取使用 job 快照，不依赖 connector 当前状态。

## K-JOB-004 凭据快照清理

job 到达终态后必须清理快照凭据（best-effort 内存清零 + 持久化删除）。

## K-JOB-005 connector 删除兼容

`DeleteConnector` 不得影响已提交 job 的可观测性与可控性；job 查询/取消/取结果能力以 job 元数据为准。

## K-JOB-006 快照凭据失效映射

- 若快照凭据被 provider 撤销：
  - `GetScenarioJob`：job 状态可标记为 `FAILED`，`reason_code=AI_PROVIDER_AUTH_FAILED`
  - `GetScenarioArtifacts`：返回 `FAILED_PRECONDITION` + `AI_PROVIDER_AUTH_FAILED`

## K-JOB-007 终态失败细节投影

`ScenarioJob` 终态失败信息必须分为两层：

- `reason_code` / `reason_detail`：稳定的短摘要，供通用轮询与 UI 列表展示
- `reason_metadata`：安全的结构化失败细节，供 SDK / Desktop / mods 继续投影到 `NimiError.details`

约束：

- `reason_metadata` 只允许包含 transport-safe、machine-readable 键值，不得泄漏凭据、header、token 或 provider 原始敏感 payload
- 当失败来源于已批准的 provider / local-runtime 启动类错误时，可包含 `provider_message`
- `CANCELED` / `COMPLETED` 终态不得保留历史失败元数据
- `SubscribeScenarioJobEvents` 与 `GetScenarioJob` 看到的 job 快照必须一致地携带该字段

## K-JOB-008 运行中进度投影

`ScenarioJob` 可在不改变状态机的前提下投影运行中进度：

- `progress_percent`：`0..100` 的运行进度百分比；未知时保持缺省/零值，不得伪造估算值
- `progress_current_step` / `progress_total_steps`：当 backend 能提供离散 step 进度时一并投影

约束：

- 进度字段只属于 job 快照，不引入新的 `ScenarioJobStatus`
- `SubscribeScenarioJobEvents` 可在 job 仍为 `RUNNING` 时重复发送 `RUNNING` 事件；消费者必须以最新 job 快照覆盖旧快照
- `GetScenarioJob` 与 `SubscribeScenarioJobEvents` 在同一时刻看到的进度字段必须一致
- 若 backend 无法提供可信进度，runtime 只返回状态，不得基于耗时或 UI 侧估算生成伪进度
