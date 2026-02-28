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
