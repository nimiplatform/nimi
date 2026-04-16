# Knowledge Contract

> Owner Domain: `K-KNOW-*`

## K-KNOW-001 RuntimeKnowledgeService Authority Home

`RuntimeKnowledgeService` is the runtime-owned authority for **runtime-local
knowledge banks and knowledge pages** in Wave 1.

Wave 1 owns:

- runtime-local knowledge bank lifecycle
- runtime-local knowledge page lifecycle
- keyword-based knowledge search

Wave 1 does not own:

- Realm/shared knowledge truth
- knowledge replication or sync backlog truth
- canonical agent-facing knowledge policy
- AgentCore prompt-assembly knowledge lanes
- cross-service citation/relation truth

## K-KNOW-002 Wave 1 Bank Scope And Owner Boundary

Wave 1 public knowledge scopes are fixed to:

- `APP_PRIVATE`
- `WORKSPACE_PRIVATE`

Wave 1 public surface must reject:

- `AGENT_CORE`
- `AGENT_DYADIC`
- `WORLD_SHARED`

Fixed rules:

- every knowledge page belongs to exactly one knowledge bank
- every knowledge bank uses an admitted typed owner shape rather than free-form `scope + owner_id`
- `APP_PRIVATE` knowledge banks are app-owned
- `WORKSPACE_PRIVATE` knowledge banks are workspace-owned
- illegal scope/owner combinations must fail close
- page access inherits bank authorization; Wave 1 does not admit a separate page owner model

## K-KNOW-003 RuntimeKnowledgeService Public Surface

`RuntimeKnowledgeService` admits the following public operations:

1. `CreateKnowledgeBank`
2. `GetKnowledgeBank`
3. `ListKnowledgeBanks`
4. `DeleteKnowledgeBank`
5. `PutPage`
6. `GetPage`
7. `ListPages`
8. `DeletePage`
9. `SearchKeyword`
10. `SearchHybrid`
11. `AddLink`
12. `RemoveLink`
13. `ListLinks`
14. `ListBacklinks`
15. `TraverseGraph`
16. `IngestDocument`
17. `GetIngestTask`

Fixed rules:

- this Wave 1 local slice replaces the older design-first 3-method index draft as the admitted design authority
- `CreateKnowledgeBank` / `DeleteKnowledgeBank` are admitted only for Wave 1 infra scopes
- `PutPage` creates or updates one page inside one admitted bank
- `DeletePage` is page-level delete; `DeleteKnowledgeBank` is bank-level delete
- `ListKnowledgeBanks` and `ListPages` are paginated list surfaces
- `SearchKeyword` remains the Wave 1 lexical / FTS-only surface
- `SearchHybrid` is the only Wave 2A retrieval-expansion delta
- Wave 2B admits only same-bank page-to-page graph / backlink surfaces
- `AddLink` and `RemoveLink` operate on runtime-local page links inside one admitted bank
- `ListLinks` returns outgoing links for one page inside one admitted bank
- `ListBacklinks` returns incoming links for one page inside one admitted bank
- `TraverseGraph` returns same-bank graph expansion from one root page and does not imply cross-bank or cross-service citation
- Wave 2C admits only single-document async ingest plus explicit task polling
- `IngestDocument` accepts one runtime-local document payload and returns one ingest task rather than synchronously returning a page write result
- `GetIngestTask` is the only admitted Wave 2C progress surface; Wave 2C does not admit ingest event streams or batch task lists
- public proto, runtime implementation, CLI, and SDK method projection must stay aligned to this admitted surface
- legacy `BuildIndex` / `SearchIndex` / `DeleteIndex` names remain migration-only and must not be treated as stable public contract

## K-KNOW-004 SearchKeyword Semantics

`SearchKeyword` is lexical / FTS-only in Wave 1.

Fixed rules:

- Wave 1 keyword search does not require an embedding profile
- Wave 1 does not admit vector search
- Wave 1 does not admit hybrid search / RRF fusion
- Wave 1 does not admit graph expansion
- Wave 1 does not admit multi-query expansion
- search results remain runtime-local knowledge hits; they do not imply AgentCore or canonical-memory admission

## K-KNOW-004a SearchHybrid Semantics

`SearchHybrid` is a runtime-local Wave 2A retrieval-expansion surface.

Fixed rules:

- combines lexical and vector-backed recall
- may use fusion / dedup internally
- does not imply graph expansion
- does not imply AgentCore admission
- does not imply shared truth
- must fail close when hybrid retrieval capability is unavailable
- must not silently downgrade to `SearchKeyword`

## K-KNOW-004b Graph / Backlink Semantics

`AddLink` / `RemoveLink` / `ListLinks` / `ListBacklinks` / `TraverseGraph` are a
runtime-local Wave 2B same-bank graph expansion.

Fixed rules:

- links are directed page-to-page relations inside exactly one admitted bank
- public graph surfaces must reject cross-bank and cross-service relation truth
- page existence and bank authorization must be validated before graph reads or writes
- `link_type` is caller-provided but non-empty; runtime does not admit a blank relation type
- duplicate same-bank relations with the same `from_page_id + to_page_id + link_type` must fail close
- self-links must fail close
- `ListLinks` and `ListBacklinks` are paginated read surfaces
- `TraverseGraph` is a paginated breadth-first graph read surface
- `TraverseGraph` depth must be explicit and bounded; invalid depth must fail close
- graph hits remain runtime-local knowledge projections; they do not imply citation redesign, canonical truth, or AgentCore admission

## K-KNOW-004c Ingest / Progress Semantics

`IngestDocument` / `GetIngestTask` are a runtime-local Wave 2C async ingest
surface.

Fixed rules:

- Wave 2C admits only single-document ingest; it does not admit multi-document batch ingest
- `IngestDocument` must validate bank existence and bank authorization before accepting a task
- `IngestDocument` must fail close on invalid envelopes; it must not silently coerce missing `bank_id`, `slug`, or `content`
- accepted ingest work is represented as a runtime-local knowledge ingest task with explicit status and `progress_percent`
- `GetIngestTask` must return task state by explicit `task_id`; missing task ids must fail close
- ingest task completion may create or update one page inside one admitted bank
- Wave 2C ingest does not admit timeline/version/revert semantics
- Wave 2C ingest does not admit cross-bank ingest, cross-service citation, shared truth, or AgentCore admission
- Wave 2C progress is poll-based; it does not imply workflow-service reuse or server-stream task events

## K-KNOW-005 Supporting Requirements

Supporting contract requirements are fixed:

- bank/page authorization is bank-scoped and must fail close
- `ListKnowledgeBanks` and `ListPages` must use admitted pagination semantics from `K-PAGE-*`
- admitted write paths must emit audit events under `K-AUDIT-*`
- admitted Wave 1 failures must map to explicit knowledge reason codes
- `SearchHybrid` pagination semantics and unavailable states must be explicit
- Wave 2B graph reads must use explicit pagination semantics
- Wave 2B graph writes must remain same-bank only and auditable
- Wave 2C ingest task reads and writes must remain runtime-local, explicit, and auditable
- if page writes affect durable hybrid retrieval readiness, the resulting indexing-side-effect posture must be explicit and auditable

Minimum Wave 1 audited writes:

- `CreateKnowledgeBank`
- `DeleteKnowledgeBank`
- `PutPage`
- `DeletePage`
- `AddLink`
- `RemoveLink`
- `IngestDocument`

Minimum Wave 1 paginated reads:

- `ListKnowledgeBanks`
- `ListPages`
- `ListLinks`
- `ListBacklinks`
- `TraverseGraph`

## K-KNOW-005a 消费契约状态

KnowledgeService 的跨域消费契约状态：

| 消费层 | 当前状态 | Wave 1 启动前必须 |
|---|---|---|
| **SDK 方法投影** | admitted / landed | 保持 Wave 1 SDK 方法投影与 runtime proto / reason-code / pagination 语义对齐 |
| **Desktop UI Spec** | admitted / landed | 保持 Knowledge Wave 1 UI spec 与 Runtime-path authz / unavailable / pagination / method surface 对齐 |
| **knowledge-base mod (Desktop host sqlite)** | 独立实现 | KB mod 当前不消费 RuntimeKnowledgeService；Wave 1 不要求该 mod 迁移，只要求不再把旧 index-only draft当作 Runtime 稳定目标 |

> **设计完整性注意**：当前 admitted knowledge slice 只定义 runtime-local infra-scoped ownership；AgentCore integration、shared truth、cross-service citation redesign 仍未交付。Runtime、CLI、SDK、Desktop UI spec 已就绪，但 Desktop/Forge 产品消费实现仍属于后续交付。
>
> **Wave 2A 注意**：`SearchHybrid` 只扩 retrieval surface；它不改变 Wave 1 bank/page ownership、也不引入 graph、AgentCore、shared truth 或 citation admission。
>
> **Wave 2B 注意**：graph/backlink 只扩同 bank page-to-page runtime-local relations；它不引入 cross-bank relation truth、cross-service citation、shared truth 或 AgentCore knowledge lane。
>
> **Wave 2C 注意**：ingest/progress 只扩 runtime-local single-document async ingest 与 task polling；它不引入 batch ingest、timeline/version、workflow-service ownership、shared truth 或 AgentCore admission。

## K-KNOW-006 Explicit Deferrals

Current admitted surface之外，以下内容仍明确 deferred：

- shared-truth / Realm replication
- `AGENT_CORE` / `AGENT_DYADIC` / `WORLD_SHARED`
- AgentCore `QueryAgentMemory` knowledge expansion
- `Layer 1K`
- consolidation / dream cycle
- public reindex / ingest admin surface
- richer ingest admin / batch progress protocol
- timeline management
- version history / revert
- relation-based memory-to-knowledge citation redesign

## K-KNOW-007 Standalone Cognition Boundary

`RuntimeKnowledgeService` is not the semantic owner of standalone cognition.

Fixed rules:

- runtime knowledge remains the runtime-owned authority for runtime-local bank/page/search/graph/ingest semantics on the runtime path
- extracted standalone cognition knowledge semantics must live under cognition authority rather than being redefined here
- cognition knowledge upgrade and no-downgrade requirements are governed by `.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`, `.nimi/spec/cognition/kernel/knowledge-service-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`
- runtime knowledge must not absorb cognition kernel, working-state, prompt, or routine ownership by extension
- shared page or relation mechanics do not make runtime knowledge the continuing owner of cognition knowledge projections
