# Knowledge UI Contract

> Authority: Desktop Kernel

## Scope

Desktop knowledge management UI 契约。该 surface 消费
`RuntimeKnowledgeService` 的 runtime-local knowledge slices，不经过 Realm
REST / DataSync facade。

## D-DSYNC-014 — Runtime Path And Scope Boundary

Knowledge UI 必须通过 Runtime 路径消费以下 admitted 方法：

- `CreateKnowledgeBank`
- `GetKnowledgeBank`
- `ListKnowledgeBanks`
- `DeleteKnowledgeBank`
- `PutPage`
- `GetPage`
- `ListPages`
- `DeletePage`
- `SearchKeyword`
- `SearchHybrid`（仅在 Wave 2A retrieval expansion admitted 时）
- `IngestDocument` / `GetIngestTask`（仅在 Wave 2C single-document ingest admitted 时）

固定约束：

- Desktop 不得为 Knowledge UI 创建 Realm-side parallel truth 或 REST bypass
- Desktop 不得把旧 `BuildIndex` / `SearchIndex` / `DeleteIndex` draft 当作稳定 surface
- Desktop 只消费 Wave 1 admitted scope：`APP_PRIVATE`、`WORKSPACE_PRIVATE`
- Desktop 不得在 UI 层暗示 shared truth / replication / AgentCore knowledge lane
- Desktop 不得把 `SearchHybrid` 解释成 graph、citation、canonical truth 或 AgentCore admission
- Desktop 不得把 `IngestDocument` / `GetIngestTask` 解释成 shared-truth ingest、workflow-service ownership、或 batch ingest admission

## D-DSYNC-015 — Bank Surface

Desktop Knowledge UI 必须至少定义 bank-level 管理 surface：

- bank list
- bank create
- bank delete
- bank detail / selection

固定约束：

- bank list 使用 `ListKnowledgeBanks`
- bank create 使用 `CreateKnowledgeBank`
- bank delete 使用 `DeleteKnowledgeBank`
- UI 不得生成 free-form `scope + owner_id`；owner shape 必须来自 admitted typed locator
- `APP_PRIVATE` 默认由当前 app 绑定；`WORKSPACE_PRIVATE` 必须显式输入或选择 `workspace_id`

## D-DSYNC-016 — Page Surface

Desktop Knowledge UI 必须至少定义 page-level 管理 surface：

- page list
- page get
- page create/update
- page delete

固定约束：

- page list 使用 `ListPages`
- page detail 使用 `GetPage`
- page create/update 使用 `PutPage`
- page delete 使用 `DeletePage`
- page delete 必须明确区分 bank-level delete 与 page-level delete，UI 不得混淆
- `slug` 冲突必须投影为可理解的冲突错误，不得静默覆盖或伪成功

## D-DSYNC-017 — Search, Authz, And Unavailable Projection

Desktop Knowledge UI 必须定义 `SearchKeyword` 的结果消费和异常投影。

固定约束：

- keyword search 结果只代表 runtime-local lexical hits，不代表 canonical truth、graph expansion、vector recall 或 AgentCore admission
- `ListKnowledgeBanks` / `ListPages` 必须消费 runtime page token；Desktop 不得用 DataSync 默认分页参数覆盖 runtime 分页语义
- `KNOWLEDGE_BANK_ACCESS_DENIED` / `KNOWLEDGE_PAGE_ACCESS_DENIED` 必须投影为 authz denial，而不是 empty state
- Runtime unavailable / bridge unavailable 必须投影为 runtime-path unavailable state，不得回退到本地伪数据
- Desktop 可以在 surface 上声明“Desktop product UI pending / gated”，但不得改变 admitted method meaning

## D-DSYNC-018 — Hybrid Search Projection

Desktop 只有在 Wave 2A retrieval expansion admitted 时才可以暴露 `SearchHybrid`。

固定约束：

- UI 必须明确区分 `SearchKeyword` 与 `SearchHybrid`
- `SearchHybrid` unavailable / capability-missing / index-not-ready 必须投影为显式 unavailable state
- Desktop 不得把 `SearchHybrid` 静默回退为 `SearchKeyword`
- `SearchHybrid` 命中仍只代表 runtime-local retrieval，不代表 graph expansion、shared truth、AgentCore admission 或 citation expansion
- Wave 2A 优先扩展现有 `runtime-config` knowledge surface；本规则不要求产品级 discovery UI 同步交付

## D-DSYNC-019 — Graph / Backlink Projection

Desktop 只有在 Wave 2B same-bank graph admission 落地后才可以暴露知识链接和
backlink surface。

固定约束：

- UI 只可以消费同一 bank 内的 `AddLink`、`RemoveLink`、`ListLinks`、`ListBacklinks`、`TraverseGraph`
- Desktop 不得在 UI 层制造 cross-bank relation、cross-service citation 或 shared-truth 暗示
- page link create/remove 必须显式区分 outgoing link 与 backlink read；UI 不得把 backlink 当作可直接写入的独立 truth
- `ListLinks` / `ListBacklinks` / `TraverseGraph` 必须消费 runtime page token，不得自行改写排序/分页语义
- `KNOWLEDGE_LINK_NOT_FOUND` / `KNOWLEDGE_LINK_ALREADY_EXISTS` / `KNOWLEDGE_LINK_INVALID` / `KNOWLEDGE_GRAPH_DEPTH_INVALID` 必须投影为显式 graph state，而不是静默空列表
- `TraverseGraph` 结果只代表 runtime-local same-bank graph expansion，不代表 citation redesign、AgentCore admission 或 canonical truth
- Wave 2B 优先扩展现有 `runtime-config` knowledge surface；本规则不要求产品级 graph explorer UI 同步交付

## D-DSYNC-020 — Ingest / Progress Projection

Desktop 只有在 Wave 2C single-document ingest admission 落地后才可以暴露
`IngestDocument` / `GetIngestTask`。

固定约束：

- UI 只可以消费单文档 ingest；不得在 Wave 2C UI 层暗示 batch ingest 已 admitted
- `IngestDocument` 必须返回显式 task acceptance；Desktop 不得伪装成同步 `PutPage`
- `GetIngestTask` 必须投影显式 `status` / `progress_percent` / `reason_code`
- `KNOWLEDGE_INGEST_TASK_NOT_FOUND` 必须投影为显式 task-missing state，而不是 generic empty state
- task progress 只代表 runtime-local ingest 执行进度；不代表 timeline/version、shared truth、AgentCore admission 或 workflow-service ownership
- Wave 2C 优先扩展现有 `runtime-config` knowledge surface；本规则不要求产品级 bulk ingest UI 同步交付
