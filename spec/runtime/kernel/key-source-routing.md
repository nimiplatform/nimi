# Key Source & Routing Contract

> Owner Domain: `K-KEYSRC-*`

## K-KEYSRC-001 路径模型

AI consume 只允许二选一路径：

- `connector_id` 路径（managed/local）— **推荐路径**，凭据由 Runtime ConnectorService 托管（K-CONN-001: custodian not distributor）
- inline 路径（`x-nimi-key-source=inline` + inline metadata）— **escape hatch**，凭据通过 gRPC metadata 直传

**Inline 路径定位声明（K-KEYSRC-001a）**：inline 路径是为以下场景设计的 escape hatch，非推荐的常规使用路径：
- 开发调试：开发者临时使用自有 API key 测试，无需预配置 connector
- 外部 Agent 直连：第三方 agent 通过 SDK 直连 Runtime，不经过 Desktop connector 管理 UI
- 临时/一次性调用：无需持久化凭据的场景

Desktop 端（D-SEC-009）始终使用 managed connector 路径，renderer 不接触原始 API key。inline 路径的凭据安全由调用方负责（Runtime 仅在 K-AUDIT-005/K-AUDIT-017 层面对审计记录执行脱敏，不对 inline 凭据做额外安全保护）。

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
6. owner/status/credential 校验（credential 由 ConnectorService 在本步骤解密并注入执行上下文；下游执行模块如 nimiLLM 通过执行上下文获取凭据，不直接访问存储）。"执行上下文" 为请求作用域的参数结构（如 `nimillm.RemoteTarget`），承载 `provider_type`/`endpoint`/`credential` 三元组。接口定义由实现层决定，spec 仅约束：下游模块不直接访问 CredentialStore
7. remote endpoint 安全校验
8. inline endpoint 安全校验
9. `model_id` 校验链路
10. 路由执行 + 审计

## K-KEYSRC-005 管理 RPC app_id 传递

- 管理 RPC 的 `app_id` 仅通过 `x-nimi-app-id` 传递（必填）。
- AI consume 的 `app_id` 在 request body 中传递（必填）。

## K-KEYSRC-005a AI consume subject_user_id 要求

- `subject_user_id` 对以下 AI consume 路径仍为必填：
  - `route_policy=TOKEN_API`
  - 任意 `connector_id` 托管路径（local / remote）
  - 任意 inline remote 凭据路径（`x-nimi-key-source=inline` 或 `x-nimi-provider-*`）
- 仅当请求显式走 anonymous local-runtime 路径时，`subject_user_id` 才允许为空：
  - `route_policy=LOCAL_RUNTIME`
  - `connector_id` 为空
  - 不存在 inline remote 凭据 metadata
- anonymous local-runtime 只在请求未携带 `Authorization` 时成立。若携带的 Bearer 非法或失效，仍必须按 `K-AUTHN-001` / `K-AUTHN-007` 返回 `UNAUTHENTICATED + AUTH_TOKEN_INVALID`，不得降级为 anonymous。

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

## K-KEYSRC-009 AI 执行路由判定

在 `K-KEYSRC-004` step 10 "路由执行" 阶段，按以下规则判定执行路径：

**managed 路径**（`connector_id` 存在）：

1. 从 `connector_id` 加载 connector 记录。
2. 查 `tables/provider-capabilities.yaml`，按 connector 的 `provider` 确定 `runtime_plane` 与 `execution_module`。
3. 分发到对应 `execution_module`（`nimillm` 用于 remote、`local-model` 用于 local）。

**inline 路径**（`x-nimi-key-source=inline`）：

1. 从 `x-nimi-provider-type` 查 `tables/provider-capabilities.yaml`。
2. inline 仅支持 `runtime_plane=remote` 的 provider。`runtime_plane=local` 的 provider 不可通过 inline 路径访问。
3. 分发到 `nimillm` 执行模块。

路由判定不可回退：一旦确定执行路径，不允许在执行失败后自动切换到另一条路径。

## K-KEYSRC-010 model_id 校验链路（Step 9）

K-KEYSRC-004 step 9 的 `model_id` 校验按路径分行为：

**Remote 路径**（managed remote / inline）：
- `model_id` 为透传字段，Runtime 不校验其是否存在于 provider 模型目录。
- 无效 `model_id` 由 provider 上游返回错误，映射为 `AI_MODEL_NOT_FOUND`（K-ERR-004）。

**Local 路径**（managed local）：
- `model_id` 按 K-LOCAL-020 前缀路由规则解析。
- 前缀不匹配已安装模型的引擎时，返回 `AI_MODEL_PROVIDER_MISMATCH`。
- 匹配后模型不可用（非 `ACTIVE` 状态）时，返回 `AI_LOCAL_MODEL_UNAVAILABLE`。

`model_id` 为空或缺失时，必须返回 `INVALID_ARGUMENT` + `AI_MODEL_ID_REQUIRED`。
