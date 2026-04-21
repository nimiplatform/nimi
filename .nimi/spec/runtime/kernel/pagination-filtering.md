# Pagination & Filtering Contract

> Owner Domain: `K-PAGE-*`

## K-PAGE-001 page_size

`ListConnectors` / `ListConnectorModels` 的分页默认值：

- 默认 `50`
- 最大 `200`
- 超上限按最大值裁剪

以上值与 K-PAGE-005 通用默认值一致。Connector 相关 List RPC 的排序与过滤规则详见 K-PAGE-003 / K-PAGE-004。

## K-PAGE-002 page_token 语义

- 不透明游标
- 至少包含“排序断点 + 过滤摘要”
- 非法 token（格式错误/签名校验失败/过滤不匹配）返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`

> **实现指引**：推荐编码 `base64url(JSON({cursor, filterDigest: sha256(filterJSON)}))`。"签名校验" 指结构校验（JSON 解析失败 = 无效），非加密签名。

## K-PAGE-003 排序稳定性

`ListConnectors` 固定排序：

1. kind：`LOCAL_MODEL` 在前，`REMOTE_MANAGED` 在后
2. local：`local_category` 升序，同 category 按 `connector_id ASC`
3. remote：`created_at DESC`，同值 `connector_id ASC`

`ListConnectorModels`：`model_id ASC`

## K-PAGE-004 过滤语义

- `kind_filter/status_filter` 中 `UNSPECIFIED` 条目静默忽略。
- `provider_filter` 继承 provider 小写约束；trim 后空值静默忽略。`provider_filter` 输入假定已由 ConnectorService 入口归一化（`K-PROV-005`），List RPC 不二次归一化。
- 过滤后无匹配返回空列表，不返回错误。

## K-PAGE-005 通用分页默认值

所有 List RPC（K-PAGE-006 枚举）若支持分页，遵循以下统一默认值：

- `page_size` 默认值：`50`
- `page_size` 最大值：`200`
- `page_size` 超上限：按最大值裁剪，不返回错误
- `page_size=0`：使用默认值
- `page_token` 缺失或空：从首条记录开始
- 响应必须包含 `next_page_token`（空字符串表示无后续页）

各 List RPC 可在其 kernel 契约中覆盖上述默认值（如 K-AUDIT-007 对 `ListAuditEvents` 的过滤字段定义），但未声明时以本规则为准。

## K-PAGE-006 List RPC 分页适用性

全量 List RPC 分页规格：

| RPC | Service | 分页 | 排序 | 过滤 | 规格来源 |
|---|---|---|---|---|---|
| `ListConnectors` | ConnectorService | 是（K-PAGE-001） | kind → local_category → connector_id / created_at（K-PAGE-003） | kind_filter, status_filter, provider_filter（K-PAGE-004） | K-PAGE-001/003/004 |
| `ListConnectorModels` | ConnectorService | 是（K-PAGE-001） | model_id ASC（K-PAGE-003） | — | K-PAGE-001/003 |
| `ListLocalAssets` | RuntimeLocalService | 是（K-PAGE-005） | local_category ASC, asset_id ASC | status_filter, kind_filter, engine_filter, category_filter | K-LOCAL-030 |
| `ListVerifiedAssets` | RuntimeLocalService | 是（K-PAGE-005） | kind ASC, asset_id ASC | kind_filter, engine_filter, category_filter | K-LOCAL-030 |
| `ListLocalServices` | RuntimeLocalService | 是（K-PAGE-005） | service_id ASC | status_filter | K-LOCAL-030 |
| `ListNodeCatalog` | RuntimeLocalService | 是（K-PAGE-005） | node_type ASC, node_id ASC | type_filter | K-LOCAL-030 |
| `ListLocalAudits` | RuntimeLocalService | 是（K-PAGE-005） | timestamp DESC | app_id, subject_user_id, time_range | K-LOCAL-029/030 |
| `ListLocalTransfers` | RuntimeLocalService | 是（K-PAGE-005） | created_at DESC, install_session_id ASC | session_kind, state, model_id, artifact_id | K-LOCAL-030 |
| `ListTokenChain` | RuntimeGrantService | 是（K-PAGE-005） | issued_at DESC | root_token_id（必填）, include_revoked | K-GRANT-011 |
| `ListAuditEvents` | RuntimeAuditService | 是（K-PAGE-005） | timestamp DESC | app_id, subject_user_id, domain, reason_code, caller_kind, caller_id, time_range | K-AUDIT-007 |
| `ListUsageStats` | RuntimeAuditService | 是（K-PAGE-005） | bucket_start DESC | app_id, subject_user_id, caller_kind, caller_id, capability, model_id | K-AUDIT-008 |
| `ListAIProviderHealth` | RuntimeAuditService | 否（全量返回） | provider_name ASC | — | K-AUDIT-013 |
| `ListModels` | RuntimeModelService | 是（K-PAGE-005） | model_id ASC | status_filter | K-MODEL-004 |
| `ListKnowledgeBanks` | RuntimeCognitionService | 是（K-PAGE-005） | scope ASC, bank_id ASC | scope_filter, app_id, workspace_id | K-KNOW-005 |
| `ListPages` | RuntimeCognitionService | 是（K-PAGE-005） | updated_at DESC, page_id ASC | bank_id（必填）, entity_type, slug_prefix | K-KNOW-005 |
| `SearchHybrid` | RuntimeCognitionService | 是（K-PAGE-005） | score DESC, page_id ASC | bank_id（必填）, query（必填）, entity_type | K-KNOW-005 |
| `ListLinks` | RuntimeCognitionService | 是（K-PAGE-005） | updated_at DESC, link_id ASC | bank_id（必填）, from_page_id（必填）, link_type | K-KNOW-005 |
| `ListBacklinks` | RuntimeCognitionService | 是（K-PAGE-005） | updated_at DESC, link_id ASC | bank_id（必填）, to_page_id（必填）, link_type | K-KNOW-005 |
| `TraverseGraph` | RuntimeCognitionService | 是（K-PAGE-005） | depth ASC, page_id ASC | bank_id（必填）, root_page_id（必填）, link_type, max_depth | K-KNOW-005 |
| `ListBanks` | RuntimeCognitionService | 是（K-PAGE-005） | scope ASC, bank_id ASC | scope_filter, app_id, workspace_id, agent_id, world_id | K-MEM-002/K-MEM-006 |
| `ListAgents` | RuntimeAgentService | 是（K-PAGE-005） | created_at DESC, agent_id ASC | lifecycle_status, autonomy_enabled | K-AGCORE-006 |
| `ListPendingHooks` | RuntimeAgentService | 是（K-PAGE-005） | scheduled_for ASC, hook_id ASC | agent_id（必填）, trigger_filter, status_filter | K-AGCORE-003/K-AGCORE-006 |
| `SearchCatalogModels` | RuntimeLocalService | 是（K-PAGE-005） | verified DESC, title ASC（K-LOCAL-021） | query（必填）, category_filter, engine_filter | K-LOCAL-030 |

**注意**：`ListAIProviderHealth` 不使用分页，因 provider 总数通常 < 20，全量返回更适合 UI 消费。
