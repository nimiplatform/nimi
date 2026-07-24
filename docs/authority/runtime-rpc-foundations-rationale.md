# Runtime RPC Foundations - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/runtime/rpc-foundations.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/audit-contract.md -->

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


---

<!-- source: .nimi/spec/runtime/kernel/error-model.md -->

# Error Model Contract

> Owner Domain: `K-ERR-*`

## K-ERR-001 双层错误模型

错误由两层组成：

- gRPC Code：表示失败阶段
- ReasonCode：表示业务原因

两者正交，不要求一一映射。

## K-ERR-002 ReasonCode 事实源

ReasonCode 的唯一事实源是 `tables/reason-codes.yaml`。
文档中的枚举表必须由该 YAML 生成，不允许手工维护多个版本。

## K-ERR-003 传递机制

- Unary：`Status.details` 的 `google.rpc.ErrorInfo` 携带 ReasonCode
- 生成流式：建流前同 Unary；建流后优先终帧 `reason_code`
- 状态事件流：不使用终帧语义，致命错误走 gRPC status

## K-ERR-004 关键映射约束

- owner 不匹配 / 无 JWT 访问 remote：`NOT_FOUND` + `AI_CONNECTOR_NOT_FOUND`
- connector disabled：`FAILED_PRECONDITION` + `AI_CONNECTOR_DISABLED`
- credential 缺失：
  - consume / list-models：`FAILED_PRECONDITION` + `AI_CONNECTOR_CREDENTIAL_MISSING`
  - test-connector：`OK + ok=false + AI_CONNECTOR_CREDENTIAL_MISSING`

## K-ERR-005 ListConnectorModels(remote) 特殊映射

Provider 上游失败（401/429/5xx/timeout）统一映射：`UNAVAILABLE` + `AI_PROVIDER_UNAVAILABLE`。

## K-ERR-006 映射矩阵事实源

`tables/error-mapping-matrix.yaml` 是错误映射矩阵唯一事实源，必须覆盖：

- consume / connector / media 三类入口
- 每个 `ReasonCode` 至少一个约束场景
- 场景对应的 gRPC code 与出口语义（error status 或 `ok=false`）

## K-ERR-007 Media 幂等冲突

`AI_MEDIA_IDEMPOTENCY_CONFLICT` 必须有显式出口语义：

- `SubmitScenarioJob` 幂等键冲突：`ALREADY_EXISTS` + `AI_MEDIA_IDEMPOTENCY_CONFLICT`
- 不允许将该冲突静默降级为普通 provider 错误或未知内部错误

幂等键由客户端通过 gRPC metadata `x-nimi-idempotency-key` 传递（`K-DAEMON-006`），缺失时不做去重。

## K-ERR-008 管理 RPC 的 NOT_FOUND 语义

本地模型管理 RPC（`StartLocalAsset`、`StopLocalAsset`、`RemoveLocalAsset` 等）在目标 `local_model_id` 不存在时返回 `NOT_FOUND`（无特定 reason code）。`AI_LOCAL_*` 系列 reason code 专用于 consume 路径和 probe 路径场景（见 error-mapping-matrix.yaml）。

## K-ERR-009 结构化错误字段稳定性

Runtime 对用户可触达失败（grant / connector / ai）必须输出可机器消费的结构化字段，不允许仅返回自由文本：

- `reasonCode`（主判定码）
- `actionHint`
- `traceId`
- `retryable`

传输要求：

- gRPC `ErrorInfo.Reason` 必须携带稳定 `reasonCode`
- `ErrorInfo.Metadata` 至少包含 `action_hint`，并在可用时包含 `trace_id` 与 `retryable`
- 对 bridge/sdk 兼容路径，status message 可携带 JSON 结构化体，但不得替代 `ErrorInfo` 语义
- 对异步 `ScenarioJob` 终态失败，safe `ErrorInfo.Metadata` 必须可投影到 job 的 `reason_metadata`，不得在 job 轮询链路中退化为只剩自由文本

## K-ERR-010 内部细节泄漏约束

grant / connector / ai 关键路径禁止将内部实现错误（provider SDK 文本、存储层原始报错）直接暴露为用户判定依据。

- 对外返回必须映射到稳定 `reasonCode`
- 内部细节仅写入服务端日志（可用 `traceId` 关联）
- 不允许以自由文本 message 作为唯一判据驱动客户端分支

## K-ERR-011 Local Speech Bundle Reason Family

ordinary-user baseline `Local Speech` bundle 的 fail-closed gating / init /
repair 路径必须使用 runtime-owned bundle-aware ReasonCode family，而不是把
Desktop alias code、host helper 文本或单一 `bootstrap failed` 句式升格为
canonical truth。

本轮最小 runtime ReasonCode family 固定为：

- `AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED`
- `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED`
- `AI_LOCAL_SPEECH_ENV_INIT_FAILED`
- `AI_LOCAL_SPEECH_HOST_INIT_FAILED`
- `AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED`
- `AI_LOCAL_SPEECH_BUNDLE_DEGRADED`

约束：

- `AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED` 是 fail-closed gating
  reason，不是后台自动重试信号；runtime/SDK/Desktop 不得把它降级为 silent
  bootstrap/download。
- `AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED` 只表达 bundle 前置条件不满足；
  不得借此伪装成 env init 或 host init 失败。
- `AI_LOCAL_SPEECH_ENV_INIT_FAILED`、`AI_LOCAL_SPEECH_HOST_INIT_FAILED`、
  `AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED` 必须分别保持可区分；不得重新
  折叠成单一 local speech bootstrap failed。
- `AI_LOCAL_SPEECH_BUNDLE_DEGRADED` 表示既有 bundle slice 已进入 repair-needed /
  degraded truth；不得被 runtime 或 Desktop 自动伪装为 healthy。
- capability / slice-specific 细节必须进入结构化 metadata（例如 capability、
  bundle slice、repair hint），而不是在本轮再拆出 `STT` / `TTS` /
  `voice_workflow.voice_clone` / `voice_workflow.voice_design` 专属 reason code。
- Desktop `LOCAL_AI_SPEECH_*` 仅可保留为 bridge 诊断别名；canonical 产品错误
  owner 仍是 runtime ReasonCode。

## K-ERR-012 Local App Kernel Reason Family

Local-app principal/record/permission/launch/session failures use the closed
`LOCAL_APP_*` family in `tables/reason-codes.yaml`. The response exposes only
the stable reason, action hint, retryability and trace id; it must not expose
principal/record/permission-decision/session ids, lineage, SID partition, process proof,
attestation refs, endpoint, bearer or native verification detail.

Fixed action classes:

- principal/record/provenance failures require Desktop owner action and are not
  silently retryable by the app;
- lease replay/process mismatch/session revoked/account changed require a new
  owner-approved launch/session and never reuse the old carrier;
- grant required/revoked/superseded returns a denied permission posture while
  the identity session may remain valid;
- Developer Mode disabled, approval-required, and risk-disclosure failures require
  explicit Desktop interaction and never background-approve or autostart;
- operation unavailable is not a generic proxy fallback signal.


---

<!-- source: .nimi/spec/runtime/kernel/pagination-filtering.md -->

# Pagination & Filtering Contract

> Owner Domain: `K-PAGE-*`

## K-PAGE-000 Runtime Target Identity v2 Hard Cut

Connector pagination must not expose local connector ordering as active truth.
The retired raw local connector kind and connector-local category ordering are
retired by `K-RTARGET-006`. Remaining model ids in list/audit/model-service
pagination are non-identity list facts and must not mint durable target refs.

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

1. connector kind：active connectors are remote credential connectors only
2. remote：`created_at DESC`，同值 `connector_id ASC`
3. local assets/profiles：handled by RuntimeLocalService pagination, not ConnectorService local connector ordering

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
| `ListConnectors` | ConnectorService | 是（K-PAGE-001） | kind → created_at DESC → connector_id ASC（K-PAGE-003） | kind_filter, status_filter, provider_filter（K-PAGE-004） | K-PAGE-001/003/004 |
| `ListConnectorModels` | ConnectorService | 是（K-PAGE-001） | model_id ASC（K-PAGE-003） | — | K-PAGE-001/003 |
| `ListLocalAssets` | RuntimeLocalService | 是（K-PAGE-005） | kind ASC, asset_id ASC | status_filter, kind_filter, engine_filter, category_filter | K-LOCAL-030 |
| `ListVerifiedAssets` | RuntimeLocalService | 是（K-PAGE-005） | kind ASC, asset_id ASC | kind_filter, engine_filter, category_filter | K-LOCAL-030 |
| `ListLocalServices` | RuntimeLocalService | 是（K-PAGE-005） | service_id ASC | status_filter | K-LOCAL-030 |
| `ListNodeCatalog` | RuntimeLocalService | 是（K-PAGE-005） | node_type ASC, node_id ASC | type_filter | K-LOCAL-030 |
| `ListLocalAudits` | RuntimeLocalService | 是（K-PAGE-005） | timestamp DESC | app_id, subject_user_id, time_range | K-LOCAL-029/030 |
| `ListLocalTransfers` | RuntimeLocalService | 是（K-PAGE-005） | created_at DESC, install_session_id ASC | session_kind, state, model_id, artifact_id | K-LOCAL-030 |
| `ListAuditEvents` | RuntimeAuditService | 是（K-PAGE-005） | timestamp DESC | app_id, subject_user_id, domain, reason_code, caller_kind, caller_id, time_range | K-AUDIT-007 |
| `ListDesktopAuditEvents` | RuntimeAuditService | 是（K-AUDIT-024） | timestamp DESC, audit_id DESC | trace_id, request_id, app_id, domain, operation, reason_code, caller_kind, required bounded time_range | K-AUDIT-024 |
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
| `ListAgentConversationSummaries` | RuntimeAgentService | 是（K-PAGE-005） | updated_at DESC, conversation_anchor_id ASC | agent_id（必填）, status_filter | K-AGCORE-006b |
| `ListPendingHooks` | RuntimeAgentService | 是（K-PAGE-005） | scheduled_for ASC, intent_id ASC | agent_id（必填）, trigger_family_filter, trigger_detail_filter, admission_state_filter | K-AGCORE-003/K-AGCORE-006 |
| `SearchCatalogModels` | RuntimeLocalService | 是（K-PAGE-005） | verified DESC, title ASC（K-LOCAL-021） | query（必填）, category_filter, engine_filter | K-LOCAL-030 |

**注意**：`ListAIProviderHealth` 不使用分页，因 provider 总数通常 < 20，全量返回更适合 UI 消费。


---

<!-- source: .nimi/spec/runtime/kernel/rpc-route-describe-contract.md -->

# RPC Route Describe Contract

> Owner Domain: `K-RPC-*`

Runtime route describe, typed result schema, producer derivation, fail-close, transport, voice workflow independence, voice asset lifecycle, and workflow family validation authority.

This file is a semantic split from `rpc-surface.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-RPC-015 Route Describe Logical Operation And Single Authority

`runtime.route.describe(...)` 是 runtime-owned 的逻辑操作，用于为单个 canonical capability route 生成 app-facing typed metadata projection。

- metadata authority 固定属于 Runtime；SDK、Desktop、host capability 只允许投影和消费，不得生成第二份 metadata 真相。
- `runtime.route.describe(...)` 的对象是“已解析 capability route 的 metadata”，不是新的 provider 探测面，也不是 Desktop heuristic。
- `describe` 返回的 metadata 只描述 capability policy / input / reasoning / workflow 语义；不得承载 health 成功语义、fallback 决策或 Desktop local cache truth。

## K-RPC-016 Route Capability Responsibility Split

route capability surface 的职责固定拆分如下：

- `runtime.route.listOptions(...)`：只返回可选择 binding/options；不产生 resolved binding、health 或 metadata truth。
- `runtime.route.resolve(...)`：只执行 selection -> resolved binding resolution；不得输出 health verdict 或 metadata policy truth。
- `runtime.route.checkHealth(...)`：只返回 resolved binding 的 health/readiness truth；不得补写 resolution 或 metadata。
- `runtime.route.describe(...)`：只返回 resolved route 的 typed metadata；不得承担 selection resolution、health 探测、provider fallback、或 Desktop-owned projection 组装。
- 对 `audio.synthesize` 与 `audio.transcribe`，`runtime.route.checkHealth(...)` 必须回答 capability-scoped readiness，而不是 generic `speech` provider/engine reachability。
- 对 plain speech，即使共享同一 `speech` engine，`audio.synthesize` 与 `audio.transcribe` 也允许 health truth 分离；任一 capability 缺失独立 admitted ready proof 时必须 fail-close。
- richer plain-speech health/readiness truth 不得被 Desktop/SDK 或其它消费面倒推出 `voice_workflow.voice_clone` / `voice_workflow.voice_design` admitted success；workflow independence 约束继续成立。

实现层允许共享底层 resolver/cached lookup，但 public contract 上述四者的语义边界不得合并。

## K-RPC-017 Route Describe Typed Result Schema

`runtime.route.describe(...)` 的 Phase 1 typed result 固定为 discriminated result：

- `capability`：canonical capability token（必须来自 `K-MCAT-024`）
- `metadataVersion`：固定为 `v1`
- `resolvedBindingRef`：由 `runtime.route.resolve(...)` 产生并可复核的 resolved binding reference；`describe` 不接受 Desktop heuristically assembled route
- `metadataKind`：`text.generate | image.generate | audio.synthesize | audio.transcribe | voice_workflow.voice_clone | voice_workflow.voice_design`
- `metadata`：与 `metadataKind` 对应的 typed object

`metadataKind=text.generate` 时，`metadata` 最小必填字段固定为：

- `supportsThinking: boolean`
- `traceModeSupport: 'none' | 'hide' | 'separate'`
- `supportsImageInput: boolean`
- `supportsAudioInput: boolean`
- `supportsVideoInput: boolean`
- `supportsArtifactRefInput: boolean`

`metadataKind=image.generate` 时，`metadata` 最小必填字段固定为：

- `supportedResponseFormats: string[]`
- `maxImagesPerRequest: number`
- `supportsNegativePrompt: boolean`
- `supportsReferenceImages: boolean`
- `supportsMask: boolean`
- `supportsSeed: boolean`
- `supportsSize: boolean`
- `supportsAspectRatio: boolean`
- `supportsQuality: boolean`
- `supportsStyle: boolean`

可选字段：

- `defaultResponseFormat`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这些字段只表达 runtime canonical `ImageGenerateScenarioSpec` 的请求能力；
不得暴露 provider raw parameter allowlist、endpoint/path 覆写键、或 adapter
私有 schema。`image.generate` 的 execution surface 仍固定为 async
`SubmitScenarioJob` / artifact output；route describe probe 只允许返回 metadata，
不得创建第二条 image execution control plane。

`metadataKind=voice_workflow.voice_clone` 时，`metadata` 最小必填字段固定为：

- `workflowType: 'voice_clone'`
- `requiresTargetSynthesisBinding: boolean`
- `textPromptMode: 'unsupported' | 'optional' | 'required'`
- `supportsLanguageHints: boolean`
- `supportsPreferredName: boolean`
- `referenceAudioUriInput: boolean`
- `referenceAudioBytesInput: boolean`
- `allowedReferenceAudioMimeTypes: string[]`

可选字段：

- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这两个字段只暴露 extension namespace/schema identity，不暴露具体
extension-key allowlist、transport override 键或 runtime-private schema
内容。

`metadataKind=voice_workflow.voice_design` 时，`metadata` 最小必填字段固定为：

- `workflowType: 'voice_design'`
- `requiresTargetSynthesisBinding: boolean`
- `instructionTextMode: 'unsupported' | 'optional' | 'required'`
- `previewTextMode: 'unsupported' | 'optional' | 'required'`
- `supportsLanguage: boolean`
- `supportsPreferredName: boolean`

可选字段：

- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

这两个字段只暴露 extension namespace/schema identity，不暴露具体
extension-key allowlist、transport override 键或 runtime-private schema
内容。

`metadataKind=audio.synthesize` 时，`metadata` 最小必填字段固定为：

- `supportedAudioFormats: string[]`
- `supportedTimingModes: ('none' | 'word' | 'char')[]`
- `supportsLanguage: boolean`
- `supportsEmotion: boolean`

可选字段：

- `defaultAudioFormat`
- `voiceRenderHints`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

`metadataKind=audio.transcribe` 时，`metadata` 最小必填字段固定为：

- `tiers: string[]`
- `supportedResponseFormats: string[]`
- `supportsLanguage: boolean`
- `supportsPrompt: boolean`
- `supportsTimestamps: boolean`
- `supportsDiarization: boolean`

可选字段：

- `maxSpeakerCount`
- `providerExtensionNamespace`
- `providerExtensionSchemaVersion`

Phase 1 未在本规则列出的 capability，不得借由自由对象、provider raw payload 或 Desktop 本地推导补充稳定 metadata contract。

## K-RPC-018 Route Describe Producer Derivation Rules

`describe(...)` metadata 必须单向派生自 runtime 既有 capability truth：

- `text.generate.supportsImageInput | supportsAudioInput | supportsVideoInput`
  - 单向派生自 `K-MMPROV-030` 的 multimodal preflight capability truth。
- `text.generate.supportsArtifactRefInput`
  - 单向派生自 runtime 对 `artifact_ref` 可解析后目标模态的 capability truth；Desktop 不得维护第二份 artifact modality matrix。
- `text.generate.supportsThinking | traceModeSupport`
  - 单向派生自 `K-MMPROV-037` 的 typed reasoning capability truth。
- `image.generate`
  - 单向派生自 source-authored `image_request_options` + resolved model
    `image.generate` catalog truth；local image route 可额外消费 local image
    supervised backend resolver 已验证的 runtime-private support class，但不得
    由 Desktop/SDK/provider adapter heuristic 推断。
- `voice_workflow.voice_clone | voice_workflow.voice_design`
  - 单向派生自 source-authored workflow `request_options` + `K-MMPROV-019`、`K-MMPROV-020`、`K-MCAT-013`、`K-MCAT-014`、`K-MCAT-021` 以及 local `speech` capability truth（含 `K-LOCAL-017`）。
- `audio.synthesize`
  - 单向派生自 source-authored `voice.request_options` + resolved model `audio.synthesize` catalog truth。
- `audio.transcribe`
  - 单向派生自 source-authored `transcription` + resolved model `audio.transcribe` catalog truth。

若 producer 需要读取 catalog projection、本地 capability resolver、或 workflow binding matrix，该读取仍属于 Runtime 内部单向投影，不得形成 Desktop-owned metadata cache truth。

## K-RPC-019 Route Describe Fail-Close Semantics

以下任一条件成立时，`runtime.route.describe(...)` 必须 fail-close：

- `capability` 不是 canonical capability token
- 输入缺失 `resolvedBindingRef`，或该 binding 不是 runtime-owned resolve truth
- `metadataKind` 与 `capability` 不匹配
- 缺失本规则要求的 typed field、discriminator、枚举值，或字段类型非法
- producer 无法从 runtime truth 导出 Phase 1 要求的 metadata 最小集
- workflow binding / synthesis binding compatibility 需要显式证明但未能解析
- workflow metadata 只能通过 `input_contract_ref` naming、runtime hardcoded allowlist、或 app-local heuristic 才能推断

fail-close 时不得：

- 伪造默认 `supportsThinking=false` / `supports*Input=false`
- 以 provider 名称、route kind、local/cloud 假设补猜 metadata
- 把 `audio.synthesize` metadata 冒充 `voice_workflow.*` metadata

## K-RPC-020 Route Describe Transport Boundary

`runtime.route.describe(...)` 在 Phase 1 只定义 logical operation 与 metadata authority，不定义新的 daemon 顶层 RPC method。

- `.nimi/spec/runtime/kernel/tables/rpc-methods.yaml` 在本轮不得新增 `DescribeRoute`、`GetRouteMetadata` 或等价顶层 RPC。
- app-facing transport 可以与 `resolve / checkHealth` 形态不完全对称，但该不对称只允许存在于 host/SDK typed projection 面。
- 若 host capability、SDK typed surface、或 runtime-private transport adapter 内部复用 runtime catalog/local resolver truth，它们仍必须保持单向投影，不得升级为第二份 authority。

## K-RPC-021 Voice Workflow Capability Independence

`voice_workflow.voice_clone` 与 `voice_workflow.voice_design` 在 selection / resolve / checkHealth / describe 上必须被视为独立 capability，而不是 `audio.synthesize` 的隐式附属面。

- selection truth 必须按 `voice_workflow.voice_clone`、`voice_workflow.voice_design` 各自 capability key 记录；不得复用 `audio.synthesize` 的 selected binding。
- `resolve(...)` 对 workflow capability 必须解析 workflow model binding；当 binding matrix 要求目标 synthesis model 时，还必须显式解析 compatibility，而不是继承 `audio.synthesize` 的任意 route。
- `checkHealth(...)` 对 workflow capability 必须检查 workflow driver/readiness；当 `requiresTargetSynthesisBinding=true` 时，还必须把目标 synthesis binding readiness 作为同一路径的组成条件。
- `describe(...)` 对 workflow capability 只返回 workflow metadata；不得返回 `audio.synthesize` 的 voice list/synthesis metadata 代替。
- workflow metadata 必须继续单向派生自 source-authored workflow metadata；不得借用 plain `audio.synthesize` / `audio.transcribe` metadata，亦不得因 provider/engine 共享同一 `speech` host 就推断 workflow metadata 存在。
- 任一 workflow capability 缺失独立 selection、resolution、health、或 metadata truth 时必须 fail-close，不得降级到 `audio.synthesize` 成功路径。
- 对 local workflow execution admission，workflow success 也必须保持 family-scoped：
  - baseline admitted family 当前固定为 `qwen3_tts`
  - `resolve(...)` / `checkHealth(...)` / `describe(...)` 对 `qwen3_tts` 的成功不得被解释为 generic local workflow success
  - 其它 local workflow family（包括 `voxcpm`、`omnivoice`）在未独立 admitted 前必须继续 fail-close

## K-RPC-022 VoiceAsset Lifecycle Boundary

`GetVoiceAsset` / `ListVoiceAssets` / `DeleteVoiceAsset` 只操作 runtime-managed `VoiceAsset` truth，不直接操作 provider-native handle truth。

- `provider_voice_ref` 可以作为 `VoiceAsset` 的内部字段或 `VoiceReference` 的一种来源存在，但仅限 Runtime 内部 / privileged / debug 面
- ordinary profile / SDK 公共绑定输入只接受 `preset_voice_id` 或 `voice_asset_id`；不得接受裸 `provider_voice_ref` 或未判别的自由字符串音色引用（`K-VOICE-003`）
- 但对外公共资产生命周期主对象固定为 `VoiceAsset`
- 调用方不得绕过 `VoiceAsset` 把 provider-native handle 当作公共资产主键

`DeleteVoiceAsset` 的公共契约必须受 `voice_handle_policy.delete_semantics` 约束：

- 对 `runtime_authoritative_delete`，runtime 删除 `VoiceAsset` 即构成公共删除成功
- 对 `best_effort_provider_delete`，runtime 允许先删除本地 `VoiceAsset`，provider cleanup 作为 best-effort follow-up
- 对未 admitted 的更强语义，必须 fail-close，不得借由模糊 ack 冒充成功

## K-RPC-023 Workflow Family Validation Boundary

workflow-capable speech family 的 app-facing consume 与健康验证必须保持 family-level 边界：

- workflow family 的 plain TTS / workflow 成功，不得被 host、SDK、Desktop、或 tests 隐式提升成 `audio.transcribe` 成功
- STT 必须继续由独立 STT family 的 resolved binding / health / execution truth 验证
- family-level acceptance matrix 若缺失独立 STT sentinel，则不得宣称整条 `tts + stt + voice_design + voice_clone` 链路已经 admitted


---

<!-- source: .nimi/spec/runtime/kernel/streaming-contract.md -->

# Streaming Contract

> Owner Domain: `K-STREAM-*`

## K-STREAM-001 适用 RPC

本契约覆盖 Runtime 全部 server-streaming RPC。按流关闭模式分类：

**模式 A — done=true 终帧**（K-STREAM-003/004）：
- `StreamScenario`（TEXT_GENERATE）
- `StreamScenario`（SPEECH_SYNTHESIZE）

**模式 B — 终态事件后 gRPC OK close**（K-STREAM-005）：
- `SubscribeScenarioJobEvents`（状态事件流）
- `SubscribeWorkflowEvents`（K-WF-004：终态事件后 server 正常关闭流）
- `SubscribeAgentVoiceStream`（K-VOICE-019：agent voice playback terminal event 后 server 正常关闭流；非 final chunks 仅 transient transport，final replay authority 来自唯一 durable audio artifact）

**模式 C — eof=true 块后 gRPC OK close**（K-STREAM-009）：
- `ExportAuditEvents`（K-AUDIT-009：`eof=true` 后 server 关闭流）

**模式 D — 长生命周期订阅流**（K-STREAM-010）：
- `SubscribeRuntimeHealthEvents`（K-AUDIT-013）
- `SubscribeAIProviderHealthEvents`（K-AUDIT-013）
- `SubscribeAccountSessionEvents`
- `SubscribeMemoryEvents`
- `SubscribeAgentEvents`
- `SubscribeRuntimeAgentAIConfigReadiness`（K-AGCORE-149：连接即发送 initial snapshot，随后按 config/readiness 变更推送）
- `SubscribeAppMessages`（K-APP-003）
- `WatchAppInstallJobEvents`（K-APP-013）
- `ReadRealtimeEvents`
- `WatchLocalTransfers`
- `grpc.health.v1.Health/Watch`

模式 D 的流没有终帧/eof 信号，客户端或 server 可单方关闭。server 关闭场景：daemon 进入 STOPPING（K-DAEMON-003）时以 gRPC `CANCELLED` 关闭所有活跃订阅流。客户端应以 `runtime.disconnected`（S-RUNTIME-028）或 gRPC status 检测到关闭后决策是否重建。

## K-STREAM-002 阶段边界

`StreamScenario`（TEXT_GENERATE/SPEECH_SYNTHESIZE）的建流边界固定为：

- K-KEYSRC-004 定义的 10 步评估链中，step 1-9（校验阶段）全部通过后，stream 才算建立；step 10（路由执行）即为流式推理的开始。
- 建流前错误统一走 gRPC error。
- 建流后业务/上游错误优先走终帧事件（`done=true + reason_code`）。

## K-STREAM-003 文本流事件约束

- `done=false` 事件：`text_delta` 必须非空。
- `done=true` 终帧：必须携带 `usage`；若上游缺失 token 统计则填 `-1`。
- `done=true` 终帧可携带最后一段 `text_delta`。

## K-STREAM-004 语音流事件约束

`StreamScenario`（SPEECH_SYNTHESIZE）的语音负载走 `ScenarioStreamDelta.artifact`
（proto `ArtifactStreamDelta { bytes chunk; string mime_type }`），不使用
`audio_chunk` 字段。`audio_chunk`（`ai_realtime.proto` `RealtimeAudioChunk audio_chunk = 12`）
是 `RuntimeAiRealtimeService` duplex realtime session 的字段，不得被当作 scenario
语音流字段。

- 非终帧 delta 事件：`ScenarioStreamDelta.artifact.chunk` 必须非空，`mime_type`
  必须为 `audio/*`。
- `ScenarioStreamCompleted` 成功：`finish_reason` 表达成功终态，不再携带 artifact
  delta。
- `ScenarioStreamFailed` 失败：`reason_code` 必填。

语音流输出真相（正向）：

- SPEECH_SYNTHESIZE 流必须在 `ScenarioStreamStarted.voice_output_mode`
  （proto `VoiceOutputMode`，取 `tables/voice-enums.yaml` `output_modes`）上正向声明
  `native_stream` 或 `simulated_stream`。消费方不得从事件形状推断 realtime。
- `native_stream` 要求在 full synthesis completion 之前已有可播放的非终帧
  `ScenarioStreamDelta.artifact`；把完成后的完整 payload 切片下推只能是
  `simulated_stream`。
- `ScenarioStreamCompleted.stream_simulated` 是 compatibility metadata（并覆盖
  `K-LENG-011` text/speech 降级审计），不是主验收真相；`stream_simulated=false`
  单独不足以证明 native realtime。realtime 验收以正向
  `voice_output_mode=native_stream` 为准（见 `K-VOICE-019`）。

## K-STREAM-005 状态事件流约束

`SubscribeScenarioJobEvents` / `SubscribeWorkflowEvents` 不使用 `done=true` 语义； steady-state 下在终态事件后 server 正常关闭流（gRPC OK）。但 daemon 进入 `STOPPING` 时，runtime 可为 bounded shutdown 直接以 gRPC `CANCELLED` 预empt这些活跃流，不保证一定送达终态事件。

同一 job / workflow 在非终态期间可重复发送相同 `event_type` 的状态事件；消费者必须以事件内最新 snapshot 覆盖旧 snapshot，而不是假设事件类型严格单调不重复。

## K-STREAM-006 Chunk framing 规则

流式 AI 输出的 chunk 最小单元为 32 bytes。实现在达到最小单元前缓冲数据；终帧时刷出所有剩余缓冲。

## K-STREAM-007 首包超时独立于总超时

流式 RPC 有两个独立超时：

- **首包超时**：从请求发出到收到第一个非空 chunk 的等待上限（默认 60s，`K-DAEMON-008`）。
- **总超时**：从请求发出到流正常关闭的总耗时上限（默认 120s）。

首包超时触发时，流以 `DEADLINE_EXCEEDED` + `AI_PROVIDER_TIMEOUT` 终止。总超时独立计时，不因收到首包而重置。

## K-STREAM-008 流关闭模式统一分类

Runtime 全部 server-streaming RPC 归入四种关闭模式（K-STREAM-001 分类表）：

| 模式 | 关闭信号 | 适用 RPC | 详细规则 |
|---|---|---|---|
| A — done=true 终帧 | 最后一帧 `done=true` + 可选 `reason_code` | StreamScenario(TEXT_GENERATE), StreamScenario(SPEECH_SYNTHESIZE) | K-STREAM-003, K-STREAM-004 |
| B — 终态事件后 close | steady-state 下终态事件（COMPLETED/FAILED/CANCELED 等）发出后 server gRPC OK close；shutdown 可 `CANCELLED` 预empt | SubscribeScenarioJobEvents, SubscribeWorkflowEvents, SubscribeAgentVoiceStream | K-STREAM-005, K-WF-004, K-VOICE-019 |
| C — eof=true 块后 close | `eof=true` 块发出后 server gRPC OK close | ExportAuditEvents | K-AUDIT-009 |
| D — 长生命周期订阅 | 无终帧/eof 信号；server 在 daemon STOPPING 时以 `CANCELLED` 关闭 | SubscribeRuntimeHealthEvents, SubscribeAIProviderHealthEvents, SubscribeAccountSessionEvents, SubscribeRuntimeAgentAIConfigReadiness, SubscribeAppMessages, WatchAppInstallJobEvents, ReadRealtimeEvents, WatchLocalTransfers, grpc.health.v1.Health/Watch | K-STREAM-010 |

SDK 消费方实现流式 RPC 时必须按所属模式处理流关闭语义。新增 server-streaming RPC 时必须在本表中声明所属模式。

## K-STREAM-009 eof 标记流关闭协议

`ExportAuditEvents` 使用 eof 标记流关闭模式（模式 C）：

- 每个 chunk 携带 `eof` 布尔字段。
- `eof=true` 标记最后一个数据块。
- server 在发送 `eof=true` 块后正常关闭流（gRPC OK）。
- 客户端在收到 `eof=true` 后应停止读取。

详细字段定义见 K-AUDIT-009。

## K-STREAM-010 长生命周期订阅流协议

长生命周期订阅流（模式 D）没有业务层的终止信号，流的生命周期与订阅方/被观察资源的生命周期绑定：

- server 在以下场景关闭流：
  - daemon 进入 `STOPPING` 状态（K-DAEMON-003）
  - 被订阅资源不再可用
- server 关闭流时使用 gRPC `CANCELLED` 状态码。
- 客户端通过 gRPC status 或 `runtime.disconnected` 事件检测到流关闭。
- 重建策略由 SDK/Desktop 消费层定义，Runtime 不规定。

除模式 D 之外，Runtime 仍允许在 daemon `STOPPING` 时为 bounded shutdown 直接预empt活跃模式 A/B/C 流，并以 gRPC `CANCELLED` 关闭；一旦进入该路径，Runtime 不得再伪造完成态、失败态或 eof 终帧来掩盖 shutdown 预empt。

## K-STREAM-011 End-to-End Backpressure Budget

Runtime → SDK → Desktop 的流式路径必须共享显式背压预算，而不是把缓冲无限下推：

- Runtime 负责声明每类流的 server-side queue depth 和 flush 粒度。
- SDK 负责把慢消费者状态转化为可判定的取消、暂停或失败，而不是继续无限累积内存。
- Desktop/UI 层负责在不可及时消费时优先丢弃可重建的中间态，不得阻塞终态、错误态和审计态事件。

## K-STREAM-012 Slow Consumer Failure Mode

- 当 server-side queue depth 超过预算且客户端未及时消费时，Runtime 必须以确定性方式结束流：优先 `RESOURCE_EXHAUSTED` 或 `CANCELLED`，不得静默悬挂。
- 对于存在终态事件的流，Runtime 必须优先保证终态/失败态可达，再丢弃可重建的中间 delta。
- SDK 必须把慢消费者关闭原因投影为稳定的错误形态；Desktop 不得把该类关闭误报为“模型输出完成”。

## K-STREAM-013 Resume / Retry Boundary

- 背压触发后的恢复边界必须由流类型显式决定：订阅流可重建，非幂等执行流不得自动重放。
- SDK 自动重试只适用于订阅型或可安全重放的读取型流；执行型流是否重试必须由调用方显式决策。
- Desktop 在流因背压关闭后，必须展示“已中断/需重试”的用户可读状态，并保留 `trace_id` 供跨层排障。


---

<!-- source: .nimi/spec/runtime/kernel/runtime-target-identity-contract.md -->

# Runtime Target Identity Contract

> Authority: Runtime Kernel
> Rule prefix: `K-RTARGET-*`
> Status: active hard-cut authority

## K-RTARGET-001 Scope

Runtime target identity is the durable identity layer used by AIConfig,
AIProfile execution, workflow AI nodes, memory embedding, route APIs, and AI
execution. It replaces durable identity based on raw `model_id`,
`target_model_id`, `localModelId`, `goRuntimeLocalModelId`,
`targetId/profileId`, or `connector_id + model_id`.

Connector identity remains credential custody only. Local runtime identity is
owned by local asset/profile readiness, not ConnectorService.

## K-RTARGET-002 Durable Target Refs

Durable refs are persisted intent. They must not contain runtime proof,
resolved endpoint paths, selected source evidence, execution metadata, or
display-only fields.

Local durable ref grammar is a required discriminated union:

```text
kind = local-runtime
version = v2
ref = profile_binding_id | readiness_ref
```

`profile_binding_id` and `readiness_ref` are mutually exclusive. Empty
local-runtime refs fail closed. `targetId`, `profileId`, `localAssetId`,
`assetId`, filename, path, digest, `localModelId`, `goRuntimeLocalModelId`, and
`model_id` are forbidden as durable local target identity.

Cloud durable ref grammar is:

```text
kind = cloud
version = v2
connector_id
remote_model_catalog_id
provider_model_id
provider
```

`connector_id` is credential custody. `remote_model_catalog_id` is the
Runtime-minted model target identity. `provider_model_id` is a provider/catalog
fact and is not sufficient to mint a durable target ref.

## K-RTARGET-003 Remote Model Catalog Identity

Runtime ConnectorService owns `remote_model_catalog_id` minting. The id must be
derived from a canonical snapshot containing connector id, connector snapshot
id, endpoint profile id, inventory snapshot id, provider, provider model id,
and capability.

Connector snapshot changes invalidate previously minted ids when provider,
endpoint, auth kind, provider auth profile, credential revision, provider
catalog version, or model/capability/availability inventory changes. Label-only
and display-only changes do not mint a new id.

A stale `remote_model_catalog_id` fails closed with
`AI_REMOTE_MODEL_CATALOG_STALE`. Missing cloud `remote_model_catalog_id` fails
closed with `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED`.

## K-RTARGET-004 Shape Separation

The following shapes are distinct:

- Durable target refs: persisted intent for AIConfig/profile/workflow/memory.
- Inventory projection: UI/diagnostic target list with display, readiness, and
  compatibility facts.
- Resolved execution binding: runtime execution truth after target resolution.

`RuntimeTargetInventoryProjection` is a collection:

```text
RuntimeTargetInventoryProjection { capability, targets[] }
RuntimeTargetInventoryItem { target_ref, display, readiness, compatibility }
```

Resolved execution binding must be typed, must carry `route_metadata_ref`, and
must be exposed on execute/stream/describe surfaces. UI inventory must not be
persisted as execution truth.

## K-RTARGET-005 Local Import Identity

Every user file import mints a new installed `local_asset_id`. Duplicate
filename, duplicate bytes, duplicate digest, and duplicate
`asset_id + engine + kind` do not collapse user imports into an existing
installed record.

`asset_id` is catalog/template metadata for verified catalog assets. Display
name is editable and non-identity.

## K-RTARGET-006 Local Connector Retirement

Local connectors are retired. ConnectorService owns remote credential custody
only. `LOCAL_MODEL`, `CONNECTOR_KIND_LOCAL_MODEL`, `LocalConnectorCategory`,
and `Connector.local_category` must not remain active connector vocabulary.

Old wire/store records using raw numeric local connector values are quarantined
as retired records and must not project active connectors or target refs.

## K-RTARGET-007 Memory Embedding

Memory embedding durable binding uses the same v2 target ref grammar. Cloud
memory binding requires `remote_model_catalog_id + provider_model_id +
provider + connector_id`. Local memory binding requires the local durable ref
discriminant.

Provider/model/profile facts may appear only after resolution as resolved bank
profile facts. They are not durable target refs.

## K-RTARGET-008 Workflow, Voice, and RPC Execution

AI workflow node configs, voice workflow nodes, and admitted AI RPC request
surfaces consume v2 durable target refs or resolved binding inputs. Raw
`model_id`, `target_model_id`, and `connector_id + model_id` must not be
durable target identity.

If `model_id` or `target_model_id` remains for audit, provider execution,
catalog, model service, or voice asset compatibility, it is an
`allowed_non_identity_fact` and must be guarded so it cannot mint or persist a
durable target ref.

## K-RTARGET-009 Component Compatibility

Component compatibility is validated before warm, health, generate,
`StartLocalAsset`, lease/acquire, and resident load. Unknown compatibility
fails with `AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN`. Known incompatibility
fails with `AI_LOCAL_COMPONENT_INCOMPATIBLE`.

Compatibility errors must not collapse to slot-missing or generic local model
unavailable reason codes.

## K-RTARGET-010 Reason Code Governance

The following Runtime reason codes are admitted by this hard cut and must be
present in `tables/reason-codes.yaml`, `proto/runtime/v1/common.proto`,
generated clients, SDK constants, and error mappings before use:

| ReasonCode | Proto value |
| --- | ---: |
| `AI_LOCAL_CONNECTOR_RETIRED` | 317 |
| `AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN` | 378 |
| `AI_LOCAL_COMPONENT_INCOMPATIBLE` | 379 |
| `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED` | 381 |
| `AI_REMOTE_MODEL_CATALOG_STALE` | 382 |
| `AI_MEMORY_EMBEDDING_TARGET_REF_INVALID` | 444 |

## K-RTARGET-011 Scan-Derived Classification Inventory

This inventory is the active G0/G12 classification source for
Runtime Target Identity v2. The current scan command is:

```powershell
rg -n "\b(model_id|target_model_id|connector_id|LOCAL_MODEL|targetId|profileId|localModelId|goRuntimeLocalModelId)\b" .nimi/spec --glob "!**/generated/**" --glob "!**/gen/**"
```

Every scan-hit file must be classified. Valid classifications are
`must_migrate`, `allowed_non_identity_fact`, `retired_history`, and
`unrelated_domain`. `allowed_non_identity_fact` rows must name the guard that
prevents durable target-ref minting. `must_migrate` rows are patch-owned by
this hard cut unless a downstream owner is explicitly named.

| Surface | Matched terms | Classification | Required action / guard |
| --- | --- | --- | --- |
| `.nimi/spec/avatar/kernel/agent-script-contract.md` | `model_id` | `unrelated_domain` | Avatar Live2D package id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/app-shell-contract.md` | `model_id` | `unrelated_domain` | Avatar app shell asset id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/avatar-event-contract.md` | `model_id` | `unrelated_domain` | Avatar event asset fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md` | `model_id` | `unrelated_domain` | Avatar visual acceptance fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md` | `model_id` | `unrelated_domain` | Live2D compatibility fact; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/live2d-render-contract.md` | `model_id` | `unrelated_domain` | Live2D `*.model3.json` id; not Runtime AI target identity. |
| `.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml` | `model_id` | `unrelated_domain` | Live2D adapter diagnostic fact. |
| `.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml` | `model_id` | `unrelated_domain` | Live2D adapter manifest field. |
| `.nimi/spec/canonical/desktop/ai-consumption.authority.yaml` | `targetId`, `profileId`, `model_id`, `connector_id`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch Desktop AIProfile config authority to v2 refs. |
| `.nimi/spec/canonical/desktop/ai-consumption.authority.yaml` | `connector_id` | `allowed_non_identity_fact` | Remote credential custody only; G3/G9/G12 reject connector-only target identity. |
| `.nimi/spec/canonical/desktop/shell-runtime.authority.yaml` | `connector_id` | `allowed_non_identity_fact` | Managed credential routing only; G3/G12 require remote catalog target identity. |
| `.nimi/spec/platform/kernel/ai-profile-selection-policy-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile identity only; G4/G9 reject profile id as local-runtime target identity. |
| `.nimi/spec/platform/kernel/nimi-app-admission-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile identity only; G4 rejects profile id in local target refs. |
| `.nimi/spec/platform/kernel/nimi-first-party-integration-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile apply reference only; G4/G9 require v2 AIConfig refs before execution. |
| `.nimi/spec/platform/kernel/nimi-home-contract.md` | `profileId` | `allowed_non_identity_fact` | AIProfile selection only; G4/G9 guard the AIConfig projection boundary. |
| `.nimi/spec/runtime/kernel/ai-profile-execution-contract.md` | `localModelId`, `model_id`, `connector_id` | `must_migrate` | Patch AIProfile execution and memory binding authority to v2 refs. |
| `.nimi/spec/runtime/kernel/audit-contract.md` | `model_id`, `connector_id` | `allowed_non_identity_fact` | Post-resolve audit facts only; G5/G8/G12 reject audit fields as target-ref inputs. |
| `.nimi/spec/runtime/kernel/authz-ownership.md` | `LOCAL_MODEL`, `connector_id` | `must_migrate` | Retire local connector ownership and route local auth through local asset/profile ownership. |
| `.nimi/spec/runtime/kernel/connector-contract.md` | `connector_id`, `model_id`, `LOCAL_MODEL` | `must_migrate` | Patch connector authority to remote credential custody only. |
| `.nimi/spec/runtime/kernel/index.md` | `connector_id` | `allowed_non_identity_fact` | Index navigation text only; linked authority files carry v2 semantics. |
| `.nimi/spec/runtime/kernel/key-source-routing.md` | `connector_id`, `model_id`, `target_model_id`, `LOCAL_MODEL`, `targetId`, `profileId`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch managed credential routing and cloud target identity separation. |
| `.nimi/spec/runtime/kernel/local-category-capability.md` | `connector_id`, `model_id` | `must_migrate` | Patch local connector/category identity text to v2 local refs or non-identity facts. |
| `.nimi/spec/runtime/kernel/local-profile-application-contract.md` | `model_id` | `must_migrate` | Patch raw local model routing and profile application text to v2 local refs or resolved non-identity facts. |
| `.nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md` | `model_id` | `allowed_non_identity_fact` | Catalog/route model selector only; G4/G12 reject it as durable local target identity. |
| `.nimi/spec/runtime/kernel/model-catalog-contract.md` | `model_id` | `must_migrate` | Patch remote catalog id minting and provider/catalog model id non-identity semantics. |
| `.nimi/spec/runtime/kernel/model-service-contract.md` | `model_id` | `allowed_non_identity_fact` | Catalog model identifier only; G3/G11 reject descriptor/model-service id as target ref. |
| `.nimi/spec/runtime/kernel/nimillm-contract.md` | `model_id` | `must_migrate` | Patch outbound validation to resolved binding/provider facts. |
| `.nimi/spec/runtime/kernel/pagination-filtering.md` | `LOCAL_MODEL`, `connector_id`, `model_id` | `must_migrate` | Patch local connector pagination and classify remaining list fields as non-identity. |
| `.nimi/spec/runtime/kernel/rpc-surface.md` | `model_id`, `target_model_id`, `connector_id` | `must_migrate` | Patch admitted AI RPC target inputs to v2 refs or resolved binding. |
| `.nimi/spec/runtime/kernel/runtime-memory-service-contract.md` | `connector_id`, `model_id` | `must_migrate` | Patch memory embedding durable binding to v2 refs. |
| `.nimi/spec/runtime/kernel/runtime-target-identity-contract.md` | `model_id`, `target_model_id`, `connector_id`, `LOCAL_MODEL`, `targetId`, `profileId`, `localModelId`, `goRuntimeLocalModelId` | `allowed_non_identity_fact` | This file is the classification and retirement authority itself; G12 parses this inventory and does not treat its listed forbidden vocabulary as active target identity. |
| `.nimi/spec/runtime/kernel/tables/key-source-truth-table.yaml` | `connector_id` | `allowed_non_identity_fact` | Credential custody table only; G3/G12 require remote catalog target identity. |
| `.nimi/spec/runtime/kernel/tables/metadata-keys.yaml` | `connector_id` | `allowed_non_identity_fact` | Credential routing metadata only; G3 rejects connector-only target identity. |
| `.nimi/spec/runtime/kernel/voice-contract.md` | `model_id`, `target_model_id` | `must_migrate` | Patch voice execution target inputs to v2 refs; keep asset compatibility only as guarded non-identity facts. |
| `.nimi/spec/runtime/kernel/workflow-contract.md` | `model_id`, `target_model_id`, `connector_id` | `must_migrate` | Patch workflow AI node configs to v2 refs or resolved binding inputs. |
| `.nimi/spec/sdks/kernel/ai-config-surface-contract.md` | `profileId`, `targetId`, `localModelId`, `goRuntimeLocalModelId` | `must_migrate` | Patch SDK core AIConfig authority and validators to v2 refs. |
| `.nimi/spec/sdks/kernel/connector-auth-acquisition-contract.md` | `profileId` | `allowed_non_identity_fact` | OAuth acquisition profile metadata only; G4/G12 reject it as local-runtime target identity. |
| `.nimi/spec/sdks/kernel/runtime-route-contract.md` | `localModelId` | `retired_history` | This file explicitly retires legacy route bindings and `localModelId`; G8/G12 reject them as route target identity. |
| `.nimi/spec/sdks/kernel/transport-contract.md` | `connector_id` | `allowed_non_identity_fact` | Credential/bearer routing only; G3/G12 reject connector-only cloud target identity. |

