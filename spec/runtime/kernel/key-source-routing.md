# Key Source & Routing Contract

> Owner Domain: `K-KEYSRC-*`

## K-KEYSRC-001 路径模型

AI consume 只允许二选一路径：

- `connector_id` 路径（managed/local）
- inline 路径（`x-nimi-key-source=inline` + inline metadata）

## K-KEYSRC-002 互斥规则

`connector_id` 与任一 inline 凭据字段同时出现，必须拒绝（`AI_REQUEST_CREDENTIAL_CONFLICT`）。

## K-KEYSRC-003 Metadata 键（Phase 1）

- `x-nimi-key-source=<inline|managed>`
- `x-nimi-provider-type=<provider>`
- `x-nimi-provider-endpoint=<endpoint>`
- `x-nimi-provider-api-key=<apiKey>`
- 管理 RPC 审计键：`x-nimi-app-id`（必填）

## K-KEYSRC-004 评估顺序（AI consume）

请求按固定顺序评估：

1. 解析 body + metadata（空 `connector_id` 归一化为未提供）
2. JWT 校验（若携带）
3. `app_id` 非空校验
4. key-source 与互斥校验
5. connector 加载
6. owner/status/credential 校验
7. remote endpoint 安全校验
8. inline endpoint 安全校验
9. `model_id` 校验链路
10. 路由执行 + 审计

## K-KEYSRC-005 管理 RPC app_id 传递

- 管理 RPC 的 `app_id` 仅通过 `x-nimi-app-id` 传递（必填）。
- AI consume 的 `app_id` 在 request body 中传递（必填）。
