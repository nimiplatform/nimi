# Runtime Connector Contract

> Owner Domain: `K-CONN-*`

## K-CONN-001 Custodian Not Distributor

AI provider 凭据的唯一托管者是 Runtime ConnectorService。调用方通过 `connector_id` 引用凭据，不直接分发原始密钥。

## K-CONN-002 Create Contract

CreateConnector 必须校验必填字段、注入默认 endpoint/label，并写入初始状态。

## K-CONN-003 Update Contract

UpdateConnector 必须校验可变字段集合；凭据或 endpoint 变化必须触发缓存失效。

## K-CONN-004 Delete Compensation

DeleteConnector 必须执行级联清理与可恢复补偿流程。

## K-CONN-005 Model Cache Policy

远端模型缓存必须具备 TTL、按 connector 隔离、显式强制刷新入口。

## K-CONN-006 Probe Preconditions

远端探测前必须通过 owner/status/credential 前置校验。

## K-CONN-007 List Models Boundaries

缓存命中路径不得触发出站探测；缓存未命中路径必须记录可观测信息。

## K-CONN-008 Provider Canonical Domain

Connector provider 值域由 `provider-catalog.yaml` 管理，禁止非 canonical provider。

## K-CONN-009 Ownership Enforcement

Connector 的读写与探测必须遵循 owner 隔离与授权边界。

## K-CONN-010 Audit Requirements

Connector 的创建、更新、删除、探测行为必须写入审计轨迹。

## K-CONN-011 Startup Recovery

进程启动时必须具备 delete-pending 等中间态恢复能力。

## K-CONN-012 Concurrency Safety

并发更新/删除必须有一致性保护，避免凭据与缓存状态撕裂。

## K-CONN-013 UpdateMask + optional Patch 语义

`UpdateConnectorRequest` 的 patch 语义必须满足：

- `update_mask.paths` 允许值固定为：`label`、`endpoint`、`api_key`、`status`。
- 当 `update_mask` 为空时，服务端必须从请求中显式出现的 optional 字段（`label`/`endpoint`/`api_key`）与 `status!=UNSPECIFIED` 推导有效更新路径。
- 推导后仍无有效路径时必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- `update_mask` 出现未知路径，或路径被声明但对应 optional 字段未显式出现时，必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- 不在有效更新路径中的字段必须保持不变（patch 语义，禁止隐式全量覆盖）。

## K-CONN-014 Connector 分页字段契约

Connector 列表 RPC 的分页字段必须成对出现并遵循统一边界：

- `ListConnectorsRequest` 与 `ListConnectorModelsRequest` 必须携带 `page_size/page_token`。
- `ListConnectorsResponse` 与 `ListConnectorModelsResponse` 必须返回 `next_page_token`（空字符串表示末页）。
- 默认分页值 `page_size=50`，最大值 `200`；超上限必须裁剪到上限，禁止回退为默认值。
- `page_token` 为空或缺失表示首页；非法 token 必须返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。

## K-CONN-015 Connector owner 字段冻结

Connector 相关请求中的 `owner_id` 已冻结为 `reserved`，调用方不得通过请求体声明 owner。服务端 owner 归属必须由认证身份推导，并执行 `K-CONN-009` 的隔离规则。
