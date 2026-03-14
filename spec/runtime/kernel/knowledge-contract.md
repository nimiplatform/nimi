# Knowledge Contract

> Owner Domain: `K-KNOW-*`

## K-KNOW-001 RuntimeKnowledgeService 方法集合

`RuntimeKnowledgeService` 方法固定为：

1. `BuildIndex` — 构建向量索引
2. `SearchIndex` — 搜索索引
3. `DeleteIndex` — 删除索引

## K-KNOW-002 BuildIndex 语义

构建向量索引请求：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 用户标识 |
| `index_id` | string | 是 | 索引唯一 ID |
| `source_kind` | string | 否 | 来源类型 |
| `source_uris` | repeated string | 是 | 数据源 URI 列表 |
| `embedding_model_id` | string | 否 | 嵌入模型 ID（未指定则使用默认） |
| `overwrite` | bool | 否 | 是否覆盖已存在的索引 |
| `options` | Struct | 否 | 引擎特定选项 |

返回 `task_id`（异步任务 ID）、`accepted`、`reason_code`。

## K-KNOW-003 SearchIndex 语义

搜索向量索引：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `app_id` | string | 是 | 应用标识 |
| `subject_user_id` | string | 是 | 用户标识 |
| `index_id` | string | 是 | 索引 ID |
| `query` | string | 是 | 查询文本 |
| `top_k` | int32 | 否 | 返回前 K 个结果 |
| `filters` | Struct | 否 | 结构化过滤条件 |

返回 `repeated SearchHit`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `document_id` | string | 文档 ID |
| `score` | float | 相似度分数 |
| `snippet` | string | 匹配片段 |
| `metadata` | Struct | 文档元数据 |

## K-KNOW-004 DeleteIndex 语义

删除指定索引。`app_id` + `subject_user_id` + `index_id` 唯一定位。返回 `Ack`。

## K-KNOW-005 索引生命周期

- `BuildIndex` 为异步操作，返回 `task_id` 用于追踪。
- 索引构建完成前对该 `index_id` 的搜索返回空结果。
- `overwrite=true` 时先删除旧索引再构建新索引。
- 索引存储为 in-memory，runtime 重启后丢失。此为 Phase 2 有意的设计约束（见 K-KNOW-006 deferred decisions）。

## K-KNOW-005a 消费契约状态

KnowledgeService 的跨域消费契约状态：

| 消费层 | 当前状态 | Phase 2 启动前必须 |
|---|---|---|
| **SDK 方法投影** | Phase 2 deferred | 创建 SDK 方法投影（BuildIndex、SearchIndex、DeleteIndex），定义 gRPC→SDK 参数映射和错误投影 |
| **Desktop UI Spec** | 完全缺失 | 创建 Knowledge UI spec，至少定义：(1) 索引构建触发 UI（K-KNOW-002 参数收集）；(2) 构建中不确定进度指示（K-KNOW-006 deferred：无进度回调）；(3) 搜索结果展示（K-KNOW-003 SearchHit 映射）；(4) 重启后索引丢失的用户告知（K-KNOW-006 deferred：in-memory only） |
| **knowledge-base mod (Desktop host sqlite)** | 独立实现 | KB mod 使用 Desktop host per-mod sqlite 持久化向量与会话状态，并在浏览器侧保留 in-memory cosine similarity 检索，不依赖 RuntimeKnowledgeService。当 K-KNOW Phase 2 持久化+真向量搜索就绪后，评估迁移。详见 `nimi-mods/runtime/knowledge-base/SSOT.md` |

> **设计完整性注意**：K-KNOW-001~005 定义了完整的索引操作模型，但 SDK 和 Desktop 均无消费契约。Runtime 实现完成后，功能不可交付直到消费层就绪。knowledge-base mod 当前独立实现向量持久化（Desktop host sqlite），不消费 RuntimeKnowledgeService。

## K-KNOW-006 Deferred Decisions

以下决策在 Phase 2 Draft 阶段有意推迟，实现期允许修正：

| 决策 | 当前状态 | 推迟原因 | 消费方影响 |
|---|---|---|---|
| **持久化策略** | in-memory only（K-KNOW-005），重启丢失 | 需评估嵌入模型规模与磁盘 I/O 成本后决定持久化格式（SQLite/mmap/文件系统） | **Desktop UI 必须向用户明确告知"索引在重启后丢失"**。SDK 消费方必须处理重启后 SearchIndex 返回空结果的场景（不应视为错误） |
| **索引更新策略** | 仅支持全量覆盖（`overwrite=true`） | 增量更新需定义文档变更检测机制与部分重建协议 | Desktop 必须在 UI 中提示"更新索引将替换全部内容" |
| **BuildIndex 进度上报** | 仅返回 `task_id`，无进度回调。**当前无追踪 RPC**：task_id 既非 ScenarioJob（无 SubscribeScenarioJobEvents 可用）也非 Workflow task（无 SubscribeWorkflowEvents 可用），且无 `GetIndexBuildStatus` 或 `SubscribeKnowledgeEvents` RPC | 需与 Workflow 事件流（K-WF-*）集成后统一设计。候选方案：(1) 纳入 Workflow 体系作为 INLINE 节点；(2) 新增 `GetBuildStatus(task_id)` 轮询 RPC；(3) 新增 `SubscribeKnowledgeEvents` 流 | Desktop/SDK 无法显示索引构建进度，只能显示"构建中"不确定进度指示。完成检测的临时方案：轮询 `SearchIndex` 判断是否返回非空结果 |
| **SearchIndex 分页** | 无分页，`top_k` 限制返回数量 | 向量搜索的分页语义（score-based cursor）与标准 page_token 不同，需专门设计 | — |
| **多索引联合搜索** | 不支持 | 需定义跨索引 score 归一化与合并策略 | — |
