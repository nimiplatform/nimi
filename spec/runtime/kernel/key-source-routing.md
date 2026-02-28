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

## K-KEYSRC-006 managed / inline 真值表

`managed` 与 `inline` 的字段必填/禁填语义，以 `tables/key-source-truth-table.yaml` 为唯一事实源：

- `key_source=managed`（或省略但提供 `connector_id`）时，`connector_id` 必须存在且非空。
- `key_source=managed` 时，`x-nimi-provider-*` inline 凭据字段必须全部禁填。
- `key_source=inline` 时，`connector_id` 必须禁填，且 inline 必填字段必须满足表定义。
- 任意违反真值表的请求必须 fail-close，不允许自动修正为另一条路由。

## K-KEYSRC-007 managed 缺失 connector_id 的错误语义

- 显式 `key_source=managed` 且缺失/空 `connector_id`：`INVALID_ARGUMENT` + `AI_CONNECTOR_ID_REQUIRED`。
- inline 必填字段缺失：`INVALID_ARGUMENT` + `AI_REQUEST_CREDENTIAL_MISSING`。

## K-KEYSRC-008 inline 显式 endpoint 必填规则

当 inline `provider_type` 对应 provider 需要显式 endpoint（见 `tables/provider-catalog.yaml`）时：

- `x-nimi-provider-endpoint` 必须非空
- 缺失/空值必须返回 `INVALID_ARGUMENT` + `AI_REQUEST_CREDENTIAL_MISSING`
