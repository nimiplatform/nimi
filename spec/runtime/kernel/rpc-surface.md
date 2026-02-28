# RPC Surface Contract

> Owner Domain: `K-RPC-*`

## K-RPC-001 服务范围（当前）

本轮 kernel 的 RPC 覆盖范围是 `runtime-ai-plane + auth-core`：

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalRuntimeService`（Phase 1 子集）
- `RuntimeAuthService`
- `RuntimeGrantService`

deferred（不在当前 kernel 全量契约范围）：

- `RuntimeWorkflowService`
- `RuntimeModelService`
- `RuntimeKnowledgeService`
- `RuntimeAppService`
- `RuntimeAuditService`（仅 `K-AUDIT-*` 最小字段被覆盖）

## K-RPC-002 AIService 方法集合（design 权威）

`AIService` 方法固定为：

1. `Generate`
2. `StreamGenerate`
3. `Embed`
4. `SubmitMediaJob`
5. `GetMediaJob`
6. `CancelMediaJob`
7. `SubscribeMediaJobEvents`
8. `GetMediaResult`
9. `SynthesizeSpeechStream`

## K-RPC-003 ConnectorService 方法集合（design 权威）

`ConnectorService` 方法固定为：

1. `CreateConnector`
2. `GetConnector`
3. `ListConnectors`
4. `UpdateConnector`
5. `DeleteConnector`
6. `TestConnector`
7. `ListConnectorModels`

## K-RPC-004 RuntimeLocalRuntimeService（Phase 1 保留集合）

当前对外规范层仅保留以下 6 个方法：

1. `ListLocalModels`
2. `InstallLocalModel`
3. `RemoveLocalModel`
4. `StartLocalModel`
5. `StopLocalModel`
6. `CheckLocalModelHealth`

`RuntimeLocalRuntimeService` 在 proto 中存在更多方法；其余方法统一归类为 deferred，不在当前 Phase 1 对外契约范围（详见 `tables/rpc-migration-map.yaml` 的 `excluded_proto_methods`）。

## K-RPC-005 Design 名称与 Proto 名称映射

`tables/rpc-migration-map.yaml` 是 design/proto 命名映射的唯一事实源：

- design 层（kernel/domain）使用 `AIService` 与 `GetMediaResult`/`SynthesizeSpeechStream` 等 design 名称
- proto 层保留 `RuntimeAiService` 与 `GetMediaArtifacts`/`StreamSpeechSynthesis` 等实际名称
- 对接层必须通过映射表进行显式转换，不允许隐式双口径

## K-RPC-006 对外契约禁用名

以下名称只允许出现在实现层或迁移映射表，不允许作为对外契约名：

- `GenerateText`
- `StreamGenerateText`
- `SynthesizeSpeech`
- `ListTokenProviderModels`
- `CheckTokenProviderHealth`

## K-RPC-007 CreateConnector 字段契约

`CreateConnector` 必须满足：

- `kind` 必须为 `REMOTE_MANAGED`
- `api_key` 必填且非空
- `endpoint` 为空时按 provider 默认值注入
- `label` 为空时使用默认 label
- 成功写入时 `status=ACTIVE`，`created_at=updated_at=now`

## K-RPC-008 UpdateConnector 字段契约

`UpdateConnector` 必须满足：

- 至少一个可变字段（`endpoint/label/api_key/status`）
- `status=UNSPECIFIED` 非法
- `api_key` 与 `label` 显式空串非法
- 合法请求一律刷新 `updated_at`
- `api_key/endpoint` 变化时必须失效 remote model cache

## K-RPC-009 DeleteConnector 补偿契约

`DeleteConnector` 必须满足：

- 级联删除 credential
- 清理 remote model cache
- 执行 `delete_pending` 补偿流程（可重试、可启动恢复）

## K-RPC-010 Remote 探测/发现前置校验契约

- `TestConnector(remote)` 出站前必须通过 owner/status/credential 校验
- `ListConnectorModels(remote)` 缓存命中路径不得出站，也不得做 endpoint 校验

## K-RPC-011 Connector 状态机锚点

`tables/state-transitions.yaml` 中 connector 相关状态机（`connector_status` 与 `remote_connector_delete_flow`）必须以本 Rule ID 作为来源锚点。
