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
