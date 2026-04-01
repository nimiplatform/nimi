# Error Model Contract

> Owner Domain: `K-ERR-*`

## K-ERR-001 双层错误模型

错误由两层组成：

- gRPC Code：表示失败阶段
- ReasonCode：表示业务原因

两者正交，不要求一一映射。

## K-ERR-002 ReasonCode 事实源

ReasonCode 的唯一事实源是 `tables/reason-codes.yaml`。
文档中的枚举表必须由该 YAML 生成，不允许手工维护多个版本。

## K-ERR-003 传递机制

- Unary：`Status.details` 的 `google.rpc.ErrorInfo` 携带 ReasonCode
- 生成流式：建流前同 Unary；建流后优先终帧 `reason_code`
- 状态事件流：不使用终帧语义，致命错误走 gRPC status

## K-ERR-004 关键映射约束

- owner 不匹配 / 无 JWT 访问 remote：`NOT_FOUND` + `AI_CONNECTOR_NOT_FOUND`
- connector disabled：`FAILED_PRECONDITION` + `AI_CONNECTOR_DISABLED`
- credential 缺失：
  - consume / list-models：`FAILED_PRECONDITION` + `AI_CONNECTOR_CREDENTIAL_MISSING`
  - test-connector：`OK + ok=false + AI_CONNECTOR_CREDENTIAL_MISSING`

## K-ERR-005 ListConnectorModels(remote) 特殊映射

Provider 上游失败（401/429/5xx/timeout）统一映射：`UNAVAILABLE` + `AI_PROVIDER_UNAVAILABLE`。

## K-ERR-006 映射矩阵事实源

`tables/error-mapping-matrix.yaml` 是错误映射矩阵唯一事实源，必须覆盖：

- consume / connector / media 三类入口
- 每个 `ReasonCode` 至少一个约束场景
- 场景对应的 gRPC code 与出口语义（error status 或 `ok=false`）

## K-ERR-007 Media 幂等冲突

`AI_MEDIA_IDEMPOTENCY_CONFLICT` 必须有显式出口语义：

- `SubmitScenarioJob` 幂等键冲突：`ALREADY_EXISTS` + `AI_MEDIA_IDEMPOTENCY_CONFLICT`
- 不允许将该冲突静默降级为普通 provider 错误或未知内部错误

幂等键由客户端通过 gRPC metadata `x-nimi-idempotency-key` 传递（`K-DAEMON-006`），缺失时不做去重。

## K-ERR-008 管理 RPC 的 NOT_FOUND 语义

本地模型管理 RPC（`StartLocalAsset`、`StopLocalAsset`、`RemoveLocalAsset` 等）在目标 `local_model_id` 不存在时返回 `NOT_FOUND`（无特定 reason code）。`AI_LOCAL_*` 系列 reason code 专用于 consume 路径和 probe 路径场景（见 error-mapping-matrix.yaml）。

## K-ERR-009 结构化错误字段稳定性

Runtime 对用户可触达失败（grant / connector / ai）必须输出可机器消费的结构化字段，不允许仅返回自由文本：

- `reasonCode`（主判定码）
- `actionHint`
- `traceId`
- `retryable`

传输要求：

- gRPC `ErrorInfo.Reason` 必须携带稳定 `reasonCode`
- `ErrorInfo.Metadata` 至少包含 `action_hint`，并在可用时包含 `trace_id` 与 `retryable`
- 对 bridge/sdk 兼容路径，status message 可携带 JSON 结构化体，但不得替代 `ErrorInfo` 语义

## K-ERR-010 内部细节泄漏约束

grant / connector / ai 关键路径禁止将内部实现错误（provider SDK 文本、存储层原始报错）直接暴露为用户判定依据。

- 对外返回必须映射到稳定 `reasonCode`
- 内部细节仅写入服务端日志（可用 `traceId` 关联）
- 不允许以自由文本 message 作为唯一判据驱动客户端分支
