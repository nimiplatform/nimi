# Audit Contract

> Owner Domain: `K-AUDIT-*`

## K-AUDIT-001 通用审计底线字段

所有审计路径（AI 执行、auth/grant、lifecycle 等）最小字段固定包含：

- `trace_id`
- `app_id`
- `domain`
- `operation`
- `reason_code`
- `timestamp`

任何审计事件至少包含上述 6 个字段。domain 专属扩展字段由各自规则定义（如 AI 执行扩展见 `K-AUDIT-018`）。

## K-AUDIT-002 事件覆盖面

管理 RPC 与 consume RPC 都必须记录成功与失败事件。

Baseline knowledge management 路径同样受本规则约束。最小覆盖写路径至少包括：

- `knowledge.bank.create`
- `knowledge.bank.delete`
- `knowledge.page.put`
- `knowledge.page.delete`
- `knowledge.link.add`
- `knowledge.link.remove`

Hybrid retrieval expansion 不要求为 `SearchHybrid` 本身新增读审计基线；但如果
page write 会改变 durable hybrid retrieval readiness（例如索引就绪、索引刷新中、
索引失败），对应的知识域状态变更事件必须仍受本规则约束。

## K-AUDIT-003 request_id / trace_id 规则

Current baseline 固定 `request_id == trace_id`（同一 ULID），为后续 fan-out 分离预留。

## K-AUDIT-004 app_id 承载规则

- AI consume / ScenarioJob 查询：`app_id` 在 request body
- Connector 管理：`x-nimi-app-id` metadata

## K-AUDIT-005 安全治理基线

- 审计存储必须受 retention 策略控制（时长可配置，禁止无限保留）。
- 审计写入必须执行敏感字段脱敏（例如凭据、token、secret、authorization 原文）。
- 禁止采集可还原的明文凭据片段；如确需排障只能记录不可逆摘要或前后缀掩码。

## K-AUDIT-006 AuditEventRecord 完整字段

`AuditEventRecord` 固定字段（proto field 编号即为权威顺序）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `audit_id` | string | 是 | ULID 唯一标识 |
| `request_id` | string | 否 | 请求 ID（AI 执行路径填充，其他路径可为空） |
| `app_id` | string | 是 | 来源应用 |
| `subject_user_id` | string | 否 | 用户主体 |
| `domain` | string | 是 | 审计域（如 `runtime.ai`、`runtime.lifecycle`） |
| `operation` | string | 是 | 操作名称（如 `generate`、`provider.health`） |
| `reason_code` | ReasonCode | 是 | 结果码 |
| `trace_id` | string | 是 | 追踪 ID |
| `timestamp` | Timestamp | 是 | 事件时间 |
| `payload` | Struct | 否 | 扩展数据 |
| `caller_kind` | CallerKind | 否 | 调用方类型 |
| `caller_id` | string | 否 | 调用方标识 |
| `surface_id` | string | 否 | 界面标识 |
| `principal_id` | string | 否 | 主体 ID |
| `principal_type` | string | 否 | 主体类型 |
| `external_principal_type` | string | 否 | 外部主体类型 |
| `capability` | string | 否 | 执行能力 |
| `token_id` | string | 否 | 访问令牌 ID |
| `parent_token_id` | string | 否 | 父令牌 ID |
| `consent_id` | string | 否 | 同意 ID |
| `consent_version` | string | 否 | 同意版本 |
| `policy_version` | string | 否 | 策略版本 |
| `resource_selector_hash` | string | 否 | 资源选择器哈希 |
| `scope_catalog_version` | string | 否 | 范围目录版本 |

## K-AUDIT-007 审计事件存储容量

- 事件环形缓冲上限：默认 20,000 条（可通过 `K-DAEMON-009` 的 `auditRingBufferSize` 配置覆盖）。超出时按 FIFO 淘汰最旧事件。
- `ListAuditEvents` 支持分页（`page_size` + `page_token`），支持按 `app_id`/`subject_user_id`/`domain`/`reason_code`/`caller_kind`/`caller_id`/`time_range` 过滤。

## K-AUDIT-008 使用量样本存储

- 使用量环形缓冲上限：默认 50,000 条样本（可通过 `K-DAEMON-009` 的 `usageStatsBufferSize` 配置覆盖）。超出时按 FIFO 淘汰。
- 样本维度：`app_id` × `subject_user_id` × `caller_kind` × `caller_id` × `capability` × `model_id`。
- `ListUsageStats` 支持分页和上述维度过滤。

## K-AUDIT-009 审计导出流协议

`ExportAuditEvents` 返回 server-stream `AuditExportChunk`：

| 字段 | 类型 | 说明 |
|---|---|---|
| `export_id` | string | 导出任务唯一 ID |
| `sequence` | uint64 | 块序号，从 0 递增 |
| `chunk` | bytes | 数据块 |
| `eof` | bool | 终止标记 |
| `mime_type` | string | 内容类型 |

- 请求可指定 `format`（导出格式）、`compress`（是否 deflate 压缩）、时间范围。
- `eof=true` 后 server 正常关闭流（K-STREAM-008 模式 C，K-STREAM-009）。

## K-AUDIT-010 UsageStatRecord 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `app_id` | string | 应用 |
| `subject_user_id` | string | 用户 |
| `caller_kind` | CallerKind | 调用方类型 |
| `caller_id` | string | 调用方 |
| `capability` | string | 能力 |
| `model_id` | string | 模型 |
| `window` | UsageWindow | 聚合窗口 |
| `bucket_start` | Timestamp | 桶起始时间 |
| `request_count` | int64 | 请求数 |
| `success_count` | int64 | 成功数 |
| `error_count` | int64 | 错误数 |
| `input_tokens` | int64 | 输入 token |
| `output_tokens` | int64 | 输出 token |
| `compute_ms` | int64 | 计算耗时 |
| `queue_wait_ms` | int64 | 队列等待耗时 |

## K-AUDIT-011 UsageWindow 枚举

| 值 | 含义 |
|---|---|
| `MINUTE` | 分钟级聚合 |
| `HOUR` | 小时级聚合 |
| `DAY` | 天级聚合 |

## K-AUDIT-012 运行时健康快照字段

`GetRuntimeHealthResponse` 字段（同 `RuntimeHealthEvent` 去除 `sequence`）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | RuntimeHealthStatus | 健康状态（`K-DAEMON-001`） |
| `reason` | string | 状态原因 |
| `queue_depth` | int32 | 调度队列深度 |
| `active_workflows` | int32 | 活跃工作流数 |
| `active_inference_jobs` | int32 | 活跃推理作业数 |
| `cpu_milli` | int64 | CPU 使用量（毫核） |
| `memory_bytes` | int64 | 内存使用量 |
| `vram_bytes` | int64 | 显存使用量 |
| `sampled_at` | Timestamp | 采样时间 |

## K-AUDIT-013 RuntimeAuditService 方法集合

`RuntimeAuditService` 方法固定为：

1. `ListAuditEvents` — 分页查询审计事件
2. `ListDesktopAuditEvents` — Desktop 受保护管道上的有界、脱敏审计投影
3. `ExportAuditEvents` — 流式导出审计事件
4. `ListUsageStats` — 分页查询使用量统计
5. `GetRuntimeHealth` — 获取运行时健康快照
6. `ListAIProviderHealth` — 列出所有 AI Provider 健康快照
7. `SubscribeAIProviderHealthEvents` — 订阅 AI Provider 健康变更事件流
8. `SubscribeRuntimeHealthEvents` — 订阅运行时健康变更事件流

**消费契约状态**：
- 原始 `ListAuditEvents` 与 `ExportAuditEvents` 不属于 Desktop protected
  consumer set，且不得作为 `ListDesktopAuditEvents` 的 renderer、SDK、Kit
  或公共 TCP fallback。
- `ListDesktopAuditEvents` 由 Desktop 经 K-PLOCAL-006 的精确受保护方法消费，
  其请求、响应、分页和脱敏边界由 K-AUDIT-024 固定。
- `ListUsageStats` 与方法 5-8 保留各自现行 SDK/Desktop 消费姿态；本规则不
  扩张它们的字段、调用方或传输权威。

## K-AUDIT-014 AIProviderHealthSnapshot 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `provider_name` | string | Provider 名称 |
| `state` | string | 健康状态（`K-PROV-001`） |
| `reason` | string | 最近原因 |
| `consecutive_failures` | int32 | 连续失败次数 |
| `last_changed_at` | Timestamp | 最近状态变更时间 |
| `last_checked_at` | Timestamp | 最近探测时间 |
| `sub_health` | repeated AIProviderSubHealth | 子级健康（结构同上，无嵌套） |

## K-AUDIT-015 Local 审计与 Global 审计关系

Runtime 存在两套独立审计存储：

- **LocalService 审计**：存储于 `local-state.json`（`K-LOCAL-016`），上限 5,000 条，FIFO 淘汰。通过 `ListLocalAudits` RPC 查询。
- **RuntimeAuditService 审计**：全局审计环形缓冲（`K-AUDIT-007`），默认上限 20,000 条。通过 `ListAuditEvents` / `ExportAuditEvents` RPC 查询。

Phase 1 两者独立存储，不汇流。各走各自查询 RPC，不做跨存储聚合。

两个审计存储服务不同的查询面，容量独立。`auditRingBufferSize`（K-DAEMON-009）控制全局审计存储（`ListAuditEvents`/`ExportAuditEvents`），`localAuditCapacity` 控制本地审计存储（`ListLocalAudits`）。事件不在两个存储间复制。

## K-AUDIT-016 审计字段模型适用性

Runtime 中存在四层审计字段定义，各有明确适用范围：

| 字段模型 | 定义位置 | 适用范围 | 说明 |
|---|---|---|---|
| **K-AUDIT-001 通用底线** | 本文档 | 所有审计路径（通用 floor） | 6 个通用底线字段（`trace_id`/`app_id`/`domain`/`operation`/`reason_code`/`timestamp`），全局审计与本地审计均需至少包含。 |
| **K-AUDIT-018 AI 执行扩展** | 本文档 | AI 执行路径 | 在 K-AUDIT-001 基础上追加 AI 执行专属字段（`request_id`/`user_id`/`client_id`/`connector_id`/`provider`/`model`/`request_source`/`usage`/`grpc_code`）。 |
| **K-AUDIT-006 AuditEventRecord** | 本文档 | 全局审计存储（`RuntimeAuditService`） | `ListAuditEvents` / `ExportAuditEvents` 使用的完整 schema。包含 K-AUDIT-001 底线字段 + auth/grant 相关字段（`principal_id`、`token_id`、`consent_id` 等）。AI 执行事件同时填充 K-AUDIT-018 扩展字段到 `payload`。 |
| **K-LOCAL-016 LocalAuditEvent** | `local-profile-application-contract.md` | 本地审计存储（`RuntimeLocalService`） | `ListLocalAudits` 使用的轻量 schema。面向本地推理场景，不含 auth/grant 字段。 |

**关系规则**：
- K-AUDIT-001 是所有审计字段的通用底线（floor）。K-AUDIT-006 和 K-LOCAL-016 均包含 K-AUDIT-001 的底线字段。
- K-AUDIT-018 是 AI 执行域的字段扩展，仅在 `domain=runtime.ai` 的审计事件中适用。
- 实现时，全局审计路径写入 K-AUDIT-006 schema 的字段；本地审计路径写入 K-LOCAL-016 schema 的字段。
- auth/grant 相关字段（`principal_id`、`principal_type`、`token_id`、`parent_token_id`、`consent_id`、`consent_version`、`policy_version`、`scope_catalog_version`）仅在 `domain=runtime.auth` 或 `domain=runtime.grant` 的审计事件中有值。

## K-AUDIT-017 敏感字段脱敏规范

审计写入层必须对敏感字段执行统一脱敏，上游模块不负责脱敏。

**脱敏字段枚举**：payload 或 metadata 中键名匹配以下模式的值必须脱敏：

| 键名模式 | 示例 |
|---|---|
| `*api_key*` | `api_key`, `provider_api_key` |
| `*credential*` | `credential`, `credential_value` |
| `*secret*` | `client_secret`, `secret_key` |
| `*authorization*` | `authorization`, `proxy_authorization` |
| `*token*`（排除 `token_id`/`page_token`/`next_page_token`） | `access_token`, `refresh_token` |
| `*password*` | `password`, `db_password` |

**掩码模式**：

- 值长度 >= 8：保留首 4 字符 + `***` + 末 4 字符（如 `sk-p***xY7z`）
- 值长度 < 8：整体替换为 `***`

**约束**：

- 脱敏在审计写入层统一执行，审计事件生产方不负责预脱敏。
- 匹配采用大小写不敏感的子串匹配。
- `token_id`、`parent_token_id`、`page_token`、`next_page_token` 为结构性标识符，不属于敏感凭据，豁免脱敏。

## K-AUDIT-018 AI 执行审计扩展字段

AI 执行路径（ExecuteScenario/StreamScenario/ScenarioJob 等）的审计事件在 `K-AUDIT-001` 通用底线基础上，额外包含：

- `request_id`
- `user_id`
- `client_id`（可选）— 等同于 `app_instance_id`，标识应用的具体运行实例。仅在应用注册时声明了 instance 标识的场景下填充；未声明时留空。
- `connector_id`（若适用）
- `provider`
- `model`
- `request_source`
- `usage`
- `grpc_code`（失败时）

非 AI 执行域（auth/grant/lifecycle）的审计事件不要求包含上述字段。

## K-AUDIT-019 Cross-Layer Correlation Query

跨 Runtime / SDK / Desktop 的排障查询主键固定为：

- `trace_id`（首选）
- `request_id`（若存在）
- `app_id`
- `domain`
- `timestamp` 窗口

单独依赖 message 文本或 UI 本地时间戳不得视为可接受的跨层关联方式。

## K-AUDIT-020 Correlation Propagation Boundary

- Runtime 必须把 `trace_id` 作为所有审计路径的通用底线字段（K-AUDIT-001）。
- SDK/Desktop 若生成本地日志或错误提示，必须保留原始 `trace_id`，不得在边界层重写为另一套随机 ID。
- 当调用链同时包含 Desktop IPC、SDK runtime client 和 Runtime gRPC 时，查询入口必须能从任一层反查到同一 `trace_id`。

## K-AUDIT-021 Query Surface & Redaction

- 跨层查询默认返回结构化字段，不以原始日志全文检索作为唯一入口。
- `trace_id`、`request_id`、`app_id`、`domain`、`reason_code`、`timestamp` 属于可查询字段；凭据、proof、token 明文仍受 `K-AUDIT-005` / `K-AUDIT-017` 脱敏约束。
- Desktop/运维侧展示查询结果时，必须优先显示可复制的 `trace_id`，用于对接 Runtime 审计、Provider 健康事件和前端 renderer 日志。

## K-AUDIT-022 Runtime Agent Participation Audit Projection

Runtime Agent Participation audit/replay must layer on the existing Runtime
audit store and must not create a participation-specific side audit store.

Participation audit events use `K-AUDIT-001` as the required floor and preserve
`K-AUDIT-006` storage semantics. Participation execution metadata may appear as
typed payload extension fields, but the stable query and redaction rules remain
owned by `K-AUDIT-019` through `K-AUDIT-021`.

Participation replay views must be reconstructable from Runtime audit lineage
and the `K-AGCORE-087` participation audit boundary. When delegated gateway
evidence participates, replay may reference `K-DELEG-085` and `K-DELEG-086`;
that reference does not create a second replay store.

## K-AUDIT-023 Audit Context Metadata Header Mapping

The Runtime audit ingress admits the audit-context gRPC metadata headers
`x-nimi-caller-kind`, `x-nimi-caller-id`, `x-nimi-surface-id`, and
`x-nimi-access-token-id`, and maps them onto the `K-AUDIT-006`
`AuditEventRecord` fields `caller_kind`, `caller_id`, `surface_id`, and
`token_id` respectively. These headers are part of the admitted
`runtime_metadata_keys` closed enum (`metadata-keys.yaml`).

`x-nimi-trace-id` is not introduced by this rule: it remains the `P-PROTO-011`
L0 envelope field and is correlated under `K-AUDIT-020`. This rule governs only
the audit-context header-to-field mapping; redaction and query semantics for the
mapped fields remain owned by `K-AUDIT-017` and `K-AUDIT-019` through
`K-AUDIT-021`.

## K-AUDIT-024 Desktop Bounded Audit Projection

`ListDesktopAuditEvents` is the only Desktop product audit-event read. It is
admitted only on the live `desktop_control` connection for the verified Nimi
Desktop process under K-PLOCAL-006. Public TCP, ordinary gRPC, portable
credentials, renderer-selected origin, local-app transports and generic
method-id/bytes proxying cannot authorize it. The raw `ListAuditEvents` and
`ExportAuditEvents` methods are not fallbacks.

The request admits exactly these filters: `trace_id`, `request_id`, `app_id`,
`domain`, `operation`, `reason_code`, `caller_kind`, `from_time`, `to_time`,
`page_size`, and `page_token`. `from_time` and `to_time` are both required,
must be valid timestamps with `from_time <= to_time`, and may span at most
seven days. `page_size=0` uses 50; values above 100 are rejected rather than
clamped. Every non-empty textual filter is an exact, bounded identifier and a
page token is valid only for the same complete filter set. Subject-user,
caller-id, principal, token, consent, policy, resource-selector, scope,
payload-content and arbitrary-text filters are forbidden.

The response contains `events`, `next_page_token`, and no other top-level
fields. Each event contains exactly:

- `audit_id`
- `request_id`
- `app_id`
- `domain`
- `operation`
- `reason_code`
- `trace_id`
- `timestamp`
- `caller_kind`

The projection must be built inside Runtime from the canonical K-AUDIT-006
store before bytes cross the protected transport. It must not contain
`payload`, `subject_user_id`, `caller_id`, `surface_id`, `principal_id`,
`principal_type`, `external_principal_type`, `capability`, `token_id`,
`parent_token_id`, `consent_id`, `consent_version`, `policy_version`,
`resource_selector_hash`, `scope_catalog_version`, credential material, proof
material, or raw log text. Missing canonical audit storage fails closed; a
synthetic event list, local audit store, usage aggregate, app cache, or UI-side
field deletion cannot substitute for it.

Runtime records successful and rejected projection reads in the canonical
audit store without copying request filters or returned event payloads into the
read event. Desktop must present the projected `trace_id` as selectable text
for K-AUDIT-019 correlation while preserving the returned value verbatim.
