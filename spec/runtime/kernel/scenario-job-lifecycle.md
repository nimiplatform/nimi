# ScenarioJob Lifecycle Contract

> Owner Domain: `K-JOB-*`

## K-JOB-001 适用 RPC

- 创建/执行：`SubmitScenarioJob`
- 查询/控制：`GetScenarioJob` `CancelScenarioJob` `SubscribeScenarioJobEvents` `GetScenarioArtifacts`

查询/控制 RPC 不走 connector 路径，走 job 元数据路径。

## K-JOB-002 终态集合

ScenarioJob 终态固定为：

- `COMPLETED`
- `FAILED`
- `CANCELED`
- `TIMEOUT`

事件流在任一终态后可正常关闭。

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
