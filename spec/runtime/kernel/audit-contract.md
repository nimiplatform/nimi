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

## K-AUDIT-018 AI 执行审计扩展字段

AI 执行路径（Generate/StreamGenerate/Embed/MediaJob/TTS 等）的审计事件在 `K-AUDIT-001` 通用底线基础上，额外包含：

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

## K-AUDIT-002 事件覆盖面

管理 RPC 与 consume RPC 都必须记录成功与失败事件。

## K-AUDIT-003 request_id / trace_id 规则

Phase 1 固定 `request_id == trace_id`（同一 ULID），为后续 fan-out 分离预留。

## K-AUDIT-004 app_id 承载规则

- AI consume / MediaJob 查询：`app_id` 在 request body
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

- 事件环形缓冲上限：默认 20,000 条（可通过 `K-DAEMON-009` 配置覆盖）。超出时按 FIFO 淘汰最旧事件。
- `ListAuditEvents` 支持分页（`page_size` + `page_token`），支持按 `app_id`/`subject_user_id`/`domain`/`reason_code`/`caller_kind`/`caller_id`/`time_range` 过滤。

## K-AUDIT-008 使用量样本存储

- 使用量环形缓冲上限：默认 50,000 条样本（可通过 `K-DAEMON-009` 配置覆盖）。超出时按 FIFO 淘汰。
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
- `eof=true` 后 server 正常关闭流。

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
2. `ExportAuditEvents` — 流式导出审计事件
3. `ListUsageStats` — 分页查询使用量统计
4. `GetRuntimeHealth` — 获取运行时健康快照
5. `ListAIProviderHealth` — 列出所有 AI Provider 健康快照
6. `SubscribeAIProviderHealthEvents` — 订阅 AI Provider 健康变更事件流
7. `SubscribeRuntimeHealthEvents` — 订阅运行时健康变更事件流

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

- **LocalRuntimeService 审计**：存储于 `local-runtime-state.json`（`K-LOCAL-016`），上限 5,000 条，FIFO 淘汰。通过 `ListLocalAudits` RPC 查询。
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
| **K-LOCAL-016 LocalAuditEvent** | `local-category-capability.md` | 本地审计存储（`RuntimeLocalRuntimeService`） | `ListLocalAudits` 使用的轻量 schema。面向本地推理场景，不含 auth/grant 字段。 |

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
