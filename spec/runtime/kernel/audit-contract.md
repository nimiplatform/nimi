# Audit Contract

> Owner Domain: `K-AUDIT-*`

## K-AUDIT-001 最小字段

审计最小字段固定包含：

- `request_id`
- `trace_id`
- `user_id`
- `app_id`
- `client_id`（可选）
- `connector_id`（若适用）
- `provider`
- `model`
- `request_source`
- `usage`
- `grpc_code` / `reason_code`（失败时）

## K-AUDIT-002 事件覆盖面

管理 RPC 与 consume RPC 都必须记录成功与失败事件。

## K-AUDIT-003 request_id / trace_id 规则

Phase 1 固定 `request_id == trace_id`（同一 ULID），为后续 fan-out 分离预留。

## K-AUDIT-004 app_id 承载规则

- AI consume / MediaJob 查询：`app_id` 在 request body
- Connector 管理：`x-nimi-app-id` metadata
