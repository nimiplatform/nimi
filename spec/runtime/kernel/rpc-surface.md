# RPC Surface Contract

> Owner Domain: `K-RPC-*`

## K-RPC-001 服务范围

Runtime kernel 的 RPC 覆盖范围为全量 proto 服务：

**Phase 1（AI 执行平面 + Auth Core）：**

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalRuntimeService`
- `RuntimeAuthService`
- `RuntimeGrantService`

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `VoiceService`（design 名称，映射到 proto `RuntimeVoiceService`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeKnowledgeService`（`K-KNOW-*`）
- `RuntimeAppService`（`K-APP-*`）
- `ScriptWorkerService`（`K-SCRIPT-*`，内部服务）

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
9. `GetSpeechVoices`
10. `SynthesizeSpeechStream`

## K-RPC-003 ConnectorService 方法集合（design 权威）

`ConnectorService` 方法固定为：

1. `CreateConnector`
2. `GetConnector`
3. `ListConnectors`
4. `UpdateConnector`
5. `DeleteConnector`
6. `TestConnector`
7. `ListConnectorModels`
8. `ListProviderCatalog`
9. `ListModelCatalogProviders`
10. `UpsertModelCatalogProvider`
11. `DeleteModelCatalogProvider`

ConnectorService 当前与 proto `RuntimeConnectorService` 对齐（见 `tables/rpc-migration-map.yaml` 中 `mapping_status=aligned`）。

## K-RPC-004 RuntimeLocalRuntimeService 方法集合

`RuntimeLocalRuntimeService` 方法按三层分级：

**Tier 1 — 核心生命周期：**

1. `ListLocalModels`
2. `InstallLocalModel`
3. `RemoveLocalModel`
4. `StartLocalModel`
5. `StopLocalModel`
6. `CheckLocalModelHealth`

**Tier 2 — 目录与计划：**

7. `ListVerifiedModels`
8. `SearchCatalogModels`
9. `ResolveModelInstallPlan`
10. `InstallVerifiedModel`
11. `ImportLocalModel`
12. `CollectDeviceProfile`

**Tier 3 — 服务/节点/依赖/审计：**

13. `ListLocalServices`
14. `InstallLocalService`
15. `StartLocalService`
16. `StopLocalService`
17. `CheckLocalServiceHealth`
18. `RemoveLocalService`
19. `ListNodeCatalog`
20. `ResolveDependencies`
21. `ApplyDependencies`
22. `ListLocalAudits`
23. `AppendInferenceAudit`
24. `AppendRuntimeAudit`

**Tier 4 — 引擎进程管理（K-LENG-004e）：**

25. `ListEngines`
26. `EnsureEngine`
27. `StartEngine`
28. `StopEngine`
29. `GetEngineStatus`

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
- 执行 `DELETE_PENDING` 补偿流程（可重试、可启动恢复）

## K-RPC-010 Remote 探测/发现前置校验契约

- `TestConnector(remote)` 出站前必须通过 owner/status/credential 校验
- `ListConnectorModels(remote)` 缓存命中路径不得出站，也不得做 endpoint 校验

## K-RPC-011 Connector 状态机锚点

`tables/state-transitions.yaml` 中 connector 相关状态机（`connector_status` 与 `remote_connector_delete_flow`）必须以本 Rule ID 作为来源锚点。

## K-RPC-012 Remote Model Cache 策略

`ListConnectorModels` 的 remote model 缓存规则：

- **缓存 TTL**：5 分钟。
- **隔离粒度**：按 `connector_id` 隔离，不同 connector 独立缓存。
- **立即失效触发**：`UpdateConnector` 中 `api_key` 或 `endpoint` 变化时、`DeleteConnector` 执行时。
- **强制刷新**：调用方可通过 `ListConnectorModels(force_refresh=true)` 绕过缓存，强制出站查询。
- **缓存未命中**：正常出站查询并回填缓存。

## K-RPC-013 GetSpeechVoices 字段契约

`GetSpeechVoices` 返回可用的语音合成声音列表。

**请求字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 鉴权主体用户 ID |
| `model_id` | string | 是 | 待查询模型（例如 `cloud/qwen3-tts-instruct-flash-2026-01-26`） |
| `route_policy` | enum | 是 | 路由策略（`local-runtime`/`token-api`） |
| `fallback` | enum | 是 | fallback 策略 |
| `connector_id` | string | 否 | key-source 托管 connector（`managed` 路径） |

**响应字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `voices` | repeated SpeechVoiceDescriptor | 可用声音列表 |
| `model_resolved` | string | 路由后模型 ID |
| `trace_id` | string | 请求追踪 ID |

**SpeechVoiceDescriptor 字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `voice_id` | string | 声音唯一标识 |
| `name` | string | 声音显示名称 |
| `lang` | string | 默认语言标签 |
| `supported_langs` | repeated string | 支持语言列表 |

**约束**：

- 结果为有界小集合，不分页（无 `page_size`/`page_token`）。
- 请求必须经过 key-source 解析（`K-KEYSRC-*`），`connector_id` 语义与其他 AI RPC 一致。
- DashScope TTS voice 来源遵循 `K-MCAT-*` catalog 主路径；兼容模式 voice endpoint 探测不作为主路径。
- `catalog_source` 属于运行时诊断语义：必须在 runtime 诊断日志与错误 metadata（如 `voice_catalog_source`）可观测；Phase 1 不要求 proto 字段变更。

## K-RPC-014 VoiceService 方法集合（design 权威）

`VoiceService` 方法固定为：

1. `SubmitVoiceJob`
2. `GetVoiceJob`
3. `CancelVoiceJob`
4. `SubscribeVoiceJobEvents`
5. `GetVoiceAsset`
6. `ListVoiceAssets`
7. `DeleteVoiceAsset`
8. `ListPresetVoices`
