# RPC Surface Contract

> Owner Domain: `K-RPC-*`

## K-RPC-001 服务集合（Phase 1）

Runtime 对外服务面固定包含：

- `AIService`
- `ConnectorService`
- `RuntimeLocalRuntimeService`

## K-RPC-002 AIService 方法集合（权威）

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

不允许在 Runtime 对外规范层使用 `GenerateText`/`StreamGenerateText`/`SynthesizeSpeech` 作为 gRPC 方法名。

## K-RPC-003 ConnectorService 方法集合（权威）

`ConnectorService` 方法固定为：

1. `CreateConnector`
2. `GetConnector`
3. `ListConnectors`
4. `UpdateConnector`
5. `DeleteConnector`
6. `TestConnector`
7. `ListConnectorModels`

## K-RPC-004 LocalRuntime 边界

`RuntimeLocalRuntimeService` 仅承载本地模型生命周期/节点目录/本地审计，不承载 token-provider 风格的 remote 探测 API。

## K-RPC-005 命名映射规则

内部模块命名（如 `GenerateText`、`ListRemoteModels`、`TestRemoteEndpoint`）可以存在，但必须是实现层名称；对外契约只认 K-RPC-002/K-RPC-003 的 gRPC 方法名。
