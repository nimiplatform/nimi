# RPC Surface Contract

> Owner Domain: `K-RPC-*`

## K-RPC-001 服务范围

Runtime kernel 的 RPC 覆盖范围为全量 proto 服务：

**Phase 1（AI 执行平面 + Auth Core）：**

- `AIService`（design 名称，映射到 proto `RuntimeAiService`）
- `ConnectorService`（design-first，proto 仍在迁移）
- `RuntimeLocalService`
- `RuntimeAuthService`
- `RuntimeGrantService`

**Phase 2（完整 Runtime 服务）：**

- `RuntimeWorkflowService`（`K-WF-*`）
- `RuntimeAuditService`（`K-AUDIT-*`）
- `RuntimeModelService`（`K-MODEL-*`）
- `RuntimeKnowledgeService`（`K-KNOW-*`）
- `RuntimeAppService`（`K-APP-*`）

## K-RPC-002 AIService 方法集合（design 权威）

`AIService` 方法固定为：

1. `ExecuteScenario`
2. `StreamScenario`
3. `SubmitScenarioJob`
4. `GetScenarioJob`
5. `CancelScenarioJob`
6. `SubscribeScenarioJobEvents`
7. `GetScenarioArtifacts`
8. `ListScenarioProfiles`
9. `GetVoiceAsset`
10. `ListVoiceAssets`
11. `DeleteVoiceAsset`
12. `ListPresetVoices`
13. `UploadArtifact`

说明：

- text/image/video/audio 等多模态输入能力属于现有 scenario 的输入扩展，不新增顶层 `multimodal.generate` RPC
- `TEXT_GENERATE` 的多模态 uplift 继续复用 `ExecuteScenario` / `StreamScenario`
- 大媒体 upload-first ingress 通过 `UploadArtifact` 暴露，供 `artifact_ref.artifact_id` 在 `TEXT_GENERATE` 与 realtime 中复用
- duplex realtime session 不属于 `AIService`，统一走独立 `RuntimeAiRealtimeService`

## RuntimeAiRealtimeService 方法集合

`RuntimeAiRealtimeService` 方法固定为：

1. `OpenRealtimeSession`
2. `AppendRealtimeInput`
3. `ReadRealtimeEvents`
4. `CloseRealtimeSession`

说明：

- v1 realtime session 只为 text/audio 双向会话预留 contract，不承担 `video + audio -> video + audio`
- `ReadRealtimeEvents` 为 server-stream；duplex 语义通过 `Open + Append + Read + Close` 组合实现
- v1 provider-backed 实现范围固定为 llama text+audio session；其他 provider 未实现时必须 fail-close，不得伪装成 `AIService` 普通 scenario

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
12. `ListCatalogProviderModels`
13. `GetCatalogModelDetail`
14. `UpsertCatalogModelOverlay`
15. `DeleteCatalogModelOverlay`

ConnectorService 当前与 proto `RuntimeConnectorService` 对齐（见 `tables/rpc-migration-map.yaml` 中 `mapping_status=aligned`）。

## K-RPC-004 RuntimeLocalService 方法集合

`RuntimeLocalService` 方法按三层分级：

**Tier 1 — 核心生命周期：**

1. `ListLocalModels`
2. `ListLocalArtifacts`
3. `InstallLocalModel`
4. `InstallVerifiedModel`
5. `InstallVerifiedArtifact`
6. `ImportLocalModel`
7. `ImportLocalArtifact`
8. `RemoveLocalModel`
9. `RemoveLocalArtifact`
10. `StartLocalModel`
11. `StopLocalModel`
12. `CheckLocalModelHealth`
13. `WarmLocalModel`

**Tier 2 — 目录、伴随资产与计划：**

14. `ListVerifiedModels`
15. `ListVerifiedArtifacts`
16. `SearchCatalogModels`
17. `ResolveModelInstallPlan`
18. `CollectDeviceProfile`

**Tier 3 — 服务/节点/依赖/审计：**

19. `ListLocalServices`
20. `InstallLocalService`
21. `StartLocalService`
22. `StopLocalService`
23. `CheckLocalServiceHealth`
24. `RemoveLocalService`
25. `ListNodeCatalog`
26. `ResolveProfile`
27. `ApplyProfile`
28. `ListLocalAudits`
29. _(reserved for stable RPC numbering)_
30. _(reserved for stable RPC numbering)_
31. `AppendInferenceAudit`
32. `AppendRuntimeAudit`

**Tier 4 — 引擎进程管理（K-LENG-004）：**

33. `ListEngines`
34. `EnsureEngine`
35. `StartEngine`
36. `StopEngine`
37. `GetEngineStatus`

`WarmLocalModel` 的语义限定为“就绪/预热”读路径：允许解析已安装 local model / local service、触发一次最小执行以加载模型，但不得改变安装态、配置态或 desktop 独占的生命周期写权限（`K-LOCAL-028`）。

## K-RPC-005 Design 名称与 Proto 名称映射

`tables/rpc-migration-map.yaml` 是 design/proto 命名映射的唯一事实源。
本轮 AI 入口与 proto 对齐为场景协议命名（`ExecuteScenario` / `SubmitScenarioJob` 等），不再维护 Voice 独立服务映射。

## K-RPC-006 对外契约禁用名

以下名称只允许出现在实现层或迁移映射表，不允许作为对外契约名：

- `GenerateText`
- `StreamGenerateText`
- `SynthesizeSpeech`
- `ListTokenProviderModels`
- `CheckTokenProviderHealth`
- `SubmitMediaJob`
- `GetMediaJob`
- `CancelMediaJob`
- `SubscribeMediaJobEvents`
- `GetMediaResult`
- `SubmitVoiceJob`
- `GetVoiceJob`
- `CancelVoiceJob`
- `SubscribeVoiceJobEvents`
- `StreamGenerate`
- `SynthesizeSpeechStream`

## K-RPC-007 CreateConnector 字段契约

`CreateConnector` 必须满足：

- 请求体不暴露 `kind`；`CreateConnector` 成功创建的结果 `Connector.kind` 固定为 `REMOTE_MANAGED`
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

## K-RPC-009 DeleteConnector 补偿契约

`DeleteConnector` 必须满足：

- 级联删除 credential
- 执行 `DELETE_PENDING` 补偿流程（可重试、可启动恢复）

## K-RPC-010 Remote 探测/发现前置校验契约

- `TestConnector(remote)` 出站前必须通过 owner/status/credential 校验
- `ListConnectorModels(remote)` 必须只读 active catalog snapshot，不得出站，也不得承担 endpoint 探测

## K-RPC-011 Connector 状态机锚点

`tables/state-transitions.yaml` 中 connector 相关状态机（`connector_status` 与 `remote_connector_delete_flow`）必须以本 Rule ID 作为来源锚点。

## K-RPC-012 Connector Model Catalog Read Semantics

`ListConnectorModels` 的 remote 读路径固定为：

- 数据来源：active catalog snapshot
- `force_refresh=true`：允许但必须是 no-op
- 返回结果：不得因为 provider live `/models` 差异而改变
- `TestConnector(remote)`：是唯一保留的非 scenario 出站探测入口，但其结果不得回填 `ListConnectorModels`

## K-RPC-012a Catalog Provider Model Browsing Surface

`ListCatalogProviderModels` and `GetCatalogModelDetail` MUST expose runtime model catalog truth after overlay merge, scoped to the caller subject user when identity is present.

- `ListCatalogProviderModels(provider, page_size, page_token)` returns provider metadata plus effective model summaries for one provider
- `GetCatalogModelDetail(provider, model_id)` returns one effective model detail projection from the resolved provider catalog
- provider metadata returned to desktop MAY include overlay presence, overlay timestamps, effective YAML, default endpoint facts, runtime plane facts, and source classification
- model metadata MUST classify each model row as `builtin`, `custom`, or `overridden`

## K-RPC-012b Catalog Overlay Mutation Surface

`UpsertCatalogModelOverlay` and `DeleteCatalogModelOverlay` are the stable structured mutation RPCs for personal catalog models.

- `UpsertCatalogModelOverlay(provider, model, voices?, voice_workflow_models?, model_workflow_binding?)` MUST validate against the runtime model catalog schema before activation
- capability-conditional validation remains fail-close at mutation time, including TTS `voice_set_id` and video `video_generation`
- overlay mutations are user-private unless the runtime is explicitly operating on a shared non-subject custom root
- `DeleteCatalogModelOverlay(provider, model_id)` MUST delete only the targeted overlay entry and restore the built-in effective model when one exists

## K-RPC-012c Advanced YAML Editing Scope

`ListModelCatalogProviders`, `UpsertModelCatalogProvider`, and `DeleteModelCatalogProvider` remain valid as advanced YAML operations.
When used by desktop catalog UX, these RPCs MUST target provider overlay fragments rather than full effective provider snapshots.

## K-RPC-013 ListPresetVoices 字段契约

`ListPresetVoices` 返回 provider 预置声音列表。

**请求字段**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 鉴权主体用户 ID |
| `model_id` | string | 是 | 待查询模型（例如 `local/qwen3-tts-local`） |
| `target_model_id` | string | 否 | 目标声音资产绑定模型（克隆/设计场景可选） |
| `connector_id` | string | 否 | key-source 托管 connector（`managed` 路径） |

**响应字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `voices` | repeated PresetVoice | 预置声音列表 |
| `model_resolved` | string | 路由后模型 ID |
| `trace_id` | string | 请求追踪 ID |

**PresetVoice 字段**：

| 字段 | 类型 | 说明 |
|---|---|---|
| `preset_voice_id` | string | 预置声音唯一标识 |
| `name` | string | 声音显示名称 |
| `lang` | string | 默认语言标签 |
| `supported_langs` | repeated string | 支持语言列表 |

**约束**：

- 结果为有界小集合，不分页（无 `page_size`/`page_token`）。
- 请求必须经过 key-source 解析（`K-KEYSRC-*`），`connector_id` 语义与其他 AI RPC 一致。
- 声音来源遵循 catalog 主路径，不允许无命名空间自由透传参数绕过。
- Voice 资产（用户克隆/设计声音）不由本接口返回；由 `GetVoiceAsset` / `ListVoiceAssets` 管理。

## K-RPC-014 Voice Asset 管理方法集合

Voice 相关资产生命周期收敛到 `AIService`：

1. `GetVoiceAsset`
2. `ListVoiceAssets`
3. `DeleteVoiceAsset`
4. `ListPresetVoices`
