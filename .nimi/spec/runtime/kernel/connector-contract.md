# Runtime Connector Contract

> Owner Domain: `K-CONN-*`

## K-CONN-001 Custodian Not Distributor

AI provider 凭据的唯一托管者是 Runtime ConnectorService。调用方通过 `connector_id` 引用凭据，不直接分发原始密钥。

## K-CONN-002 Create Contract

CreateConnector 必须校验必填字段、注入默认 endpoint/label，并写入初始状态。

- authenticated caller 创建 user-owned remote managed connector（`owner_type=REALM_USER`, `owner_id=sub`）。
- anonymous caller 创建 machine-global remote managed connector（`owner_type=SYSTEM`, `owner_id="machine"`）。
- `owner_id="system"` 保留给 runtime config / env 注入的系统 connector，不允许通过 RPC 请求体声明。

## K-CONN-003 Update Contract

UpdateConnector 必须校验可变字段集合；凭据或 endpoint 变化必须触发缓存失效。

- `owner_id="system"` 的 system-managed remote connector 保持 immutable。
- `owner_id="machine"` 的 machine-global remote connector 允许 anonymous 与 authenticated 调用方更新。

## K-CONN-004 Delete Compensation

DeleteConnector 必须执行级联清理与可恢复补偿流程。

- `owner_id="system"` 的 system-managed remote connector 不可删除。
- `owner_id="machine"` 的 machine-global remote connector 允许 anonymous 与 authenticated 调用方删除。

## K-CONN-005 YAML-First Model Listing

`ListConnectorModels` 必须是 catalog read：

- 远端 connector 的模型列表只能来自 active catalog snapshot
- `force_refresh` 字段保留但语义为 no-op
- 非 scenario 路径不得把 provider `/models` 探测结果当作模型清单真相

## K-CONN-006 Probe Preconditions

远端探测前必须通过 owner/status/credential 前置校验。

## K-CONN-007 List Models Boundaries

`TestConnector(remote)` 可以出站做连通性 / 凭据有效性探测，但不得承担模型发现、voice discovery 或 catalog 预热职责。

## K-CONN-008 Provider Canonical Domain

Connector provider 值域由 `provider-catalog.yaml` 管理，禁止非 canonical provider。

## K-CONN-009 Ownership Enforcement

Connector 的读写与探测必须遵循 owner 隔离与授权边界。

- user-owned remote connector 继续按 `sub` 隔离。
- machine-global remote connector 对当前 Runtime 实例上的所有调用方可见。
- system-managed remote connector 仅表示 runtime config / env 注入来源，保持只读。

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

## K-CONN-016 World Generate Connector Custody

当远端 provider admitted `world.generate` 时，connector custody 规则不变化：

- 调用方继续只提交 `connector_id`，不得提交原始 provider secret。
- world-generation provider 调用中的 upload / generate / poll / fetch-world
  凭据注入必须继续由 Runtime ConnectorService 托管。
- provider 返回 world asset URL 或 viewer URL 不得被解释为新的 credential
  ownership path。
