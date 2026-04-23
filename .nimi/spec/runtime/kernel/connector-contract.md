# Runtime Connector Contract

> Owner Domain: `K-CONN-*`

## K-CONN-001 Custodian Not Distributor

AI provider 凭据的唯一托管者是 Runtime ConnectorService。调用方通过 `connector_id` 引用凭据，不直接分发原始密钥。

- managed connector 的 credential truth 允许两类 admitted auth 形态：
  - `auth_kind=API_KEY`
  - `auth_kind=OAUTH_MANAGED`
- Runtime 在持久化层托管的是 provider-defined credential payload；执行层只消费请求作用域中被解出的最小凭据子集。

## K-CONN-002 Create Contract

CreateConnector 必须校验必填字段、注入默认 endpoint/label，并写入初始状态。

- authenticated caller 创建 user-owned remote managed connector（`owner_type=REALM_USER`, `owner_id=sub`）。
- anonymous caller 只能创建 `auth_kind=API_KEY` 的 machine-global remote managed connector（`owner_type=SYSTEM`, `owner_id="machine"`）。
- `owner_id="system"` 保留给 runtime config / env 注入的系统 connector，不允许通过 RPC 请求体声明。
- `auth_kind=API_KEY` 时，`api_key` 必填，`provider_auth_profile` 与 `credential_json` 禁填。
- `auth_kind=OAUTH_MANAGED` 时，必须存在 authenticated caller，并且 `provider_auth_profile` 与 `credential_json` 必填，`api_key` 禁填。
- `provider_auth_profile` 不是自由字符串；其唯一事实源是 `tables/connector-auth-profiles.yaml`，并且必须与 connector provider 保持兼容。
- `auth_kind` 省略时，服务端可按请求载荷推断：
  - `credential_json` 存在时推断为 `OAUTH_MANAGED`
  - 否则推断为 `API_KEY`

## K-CONN-003 Update Contract

UpdateConnector 必须校验可变字段集合；凭据或 endpoint 变化必须触发缓存失效。

- `owner_id="system"` 的 system-managed remote connector 保持 immutable。
- `owner_id="machine"` 的 machine-global remote connector 仅允许 `auth_kind=API_KEY` 形态，并允许 anonymous 与 authenticated 调用方更新。
- `auth_kind=OAUTH_MANAGED` connector 必须保持 `owner_type=REALM_USER`；发现非 user-owned 记录时必须 fail-close 并按 `NOT_FOUND` 隐藏。
- auth 相关 patch 必须保持 coherent final state：
  - `auth_kind=API_KEY` 不允许携带 `provider_auth_profile`
  - `auth_kind=OAUTH_MANAGED` 必须持有 `provider_auth_profile`
  - `provider_auth_profile` 必须继续属于 `tables/connector-auth-profiles.yaml` admitted set，并与现有 connector provider 保持兼容
  - `api_key` 与 `credential_json` 不得在同一次 patch 中并存
- 切换 auth kind 时必须显式补足目标形态所需 credential；不允许依赖隐式转换。

## K-CONN-004 Delete Compensation

DeleteConnector 必须执行级联清理与可恢复补偿流程。

- `owner_id="system"` 的 system-managed remote connector 不可删除。
- `owner_id="machine"` 的 machine-global remote connector 仅允许 `auth_kind=API_KEY` 形态，并允许 anonymous 与 authenticated 调用方删除。
- `auth_kind=OAUTH_MANAGED` connector 若不满足 user-owned 边界，删除路径必须 fail-close 并按 `NOT_FOUND` 隐藏。

## K-CONN-005 Inventory-Mode Model Listing

`ListConnectorModels` 必须按 provider inventory mode 分支：

- `static_source` remote provider：
  - 远端 connector 模型列表只能来自 active catalog snapshot
  - `force_refresh` 为 no-op
- `dynamic_endpoint` remote provider：
  - 模型列表来自 live connector discovery
  - runtime 可以做内存级缓存
  - `force_refresh=true` 必须触发重新探测
  - 返回结果必须经过 source-authored policy 过滤与归一化

非 scenario 路径不得把 live discovery 结果提升为 catalog authority；它只
是 dynamic provider 的 execution-time inventory truth。

## K-CONN-006 Probe Preconditions

远端探测前必须通过 owner/status/credential 前置校验。

## K-CONN-007 List Models Boundaries

`TestConnector(remote)` 可以出站做连通性 / 凭据有效性探测，但不得承担模型发现、voice discovery 或 catalog 预热职责。

## K-CONN-008 Provider Canonical Domain

Connector provider 值域由 `provider-catalog.yaml` 管理，禁止非 canonical provider。

## K-CONN-009 Ownership Enforcement

Connector 的读写与探测必须遵循 owner 隔离与授权边界。

- user-owned remote connector 继续按 `sub` 隔离。
- machine-global remote connector 只适用于 `auth_kind=API_KEY`，并对当前 Runtime 实例上的所有调用方可见。
- `auth_kind=OAUTH_MANAGED` connector 只允许 user-owned；发现 machine/system-owned 记录时，读与探测路径必须按 `NOT_FOUND` 隐藏。
- system-managed remote connector 仅表示 runtime config / env 注入来源，保持只读。

## K-CONN-010 Audit Requirements

Connector 的创建、更新、删除、探测行为必须写入审计轨迹。

## K-CONN-011 Startup Recovery

进程启动时必须具备 delete-pending 等中间态恢复能力。

## K-CONN-012 Concurrency Safety

并发更新/删除必须有一致性保护，避免凭据与缓存状态撕裂。

## K-CONN-013 UpdateMask + optional Patch 语义

`UpdateConnectorRequest` 的 patch 语义必须满足：

- `update_mask.paths` 允许值固定为：`label`、`endpoint`、`api_key`、`status`、`auth_kind`、`provider_auth_profile`、`credential_json`。
- 当 `update_mask` 为空时，服务端必须从请求中显式出现的 optional 字段（`label`/`endpoint`/`api_key`/`auth_kind`/`provider_auth_profile`/`credential_json`）与 `status!=UNSPECIFIED` 推导有效更新路径。
- 推导后仍无有效路径时必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- `update_mask` 出现未知路径，或路径被声明但对应 optional 字段未显式出现时，必须拒绝：`INVALID_ARGUMENT` + `AI_CONNECTOR_INVALID`。
- 不在有效更新路径中的字段必须保持不变（patch 语义，禁止隐式全量覆盖）。

## K-CONN-014 Connector 分页字段契约

Connector 列表 RPC 的分页字段必须成对出现并遵循统一边界：

- `ListConnectorsRequest` 与 `ListConnectorModelsRequest` 必须携带 `page_size/page_token`。
- `ListConnectorsResponse` 与 `ListConnectorModelsResponse` 必须返回 `next_page_token`（空字符串表示末页）。
- 默认分页值 `page_size=50`，最大值 `200`；超上限必须裁剪到上限，禁止回退为默认值。
- `page_token` 为空或缺失表示首页；非法 token 必须返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。

## K-CONN-015 Connector owner 字段冻结

Connector 相关请求中的 `owner_id` 已冻结为 `reserved`，调用方不得通过请求体声明 owner。服务端 owner 归属必须由认证身份推导，并执行 `K-CONN-009` 的隔离规则。

## K-CONN-016 World Generate Connector Custody

当远端 provider admitted `world.generate` 时，connector custody 规则不变化：

- 调用方继续只提交 `connector_id`，不得提交原始 provider secret。
- world-generation provider 调用中的 upload / generate / poll / fetch-world
  凭据注入必须继续由 Runtime ConnectorService 托管。
- provider 返回 world asset URL 或 viewer URL 不得被解释为新的 credential
  ownership path。

## K-CONN-017 Memory Embedding Cloud Binding Reference Boundary

当 Desktop-host-owned memory embedding live config 选择 `cloud` source 时，其
legal binding reference 必须继续服从 connector custody 规则。

固定规则：

- cloud memory embedding binding 必须引用 remote managed connector；host 持久化
  config 不得携带 raw provider secret、inline endpoint、或 provider-native
  credential fields
- admitted cloud binding shape 至少包含 `connector_id + model_id` 或其等价 typed
  reference；仅 `connector_id` 不构成完整 binding
- 被引用 connector 的 provider 必须属于 canonical provider domain，且继续受
  owner/status/credential 校验约束
- `kind=LOCAL_MODEL` 的 connector 不得被 memory embedding cloud binding 当作
  legal remote reference
- connector custody 只拥有 credential 托管与 remote binding legality；resolved
  embedding profile、bank bind、以及 migration / cutover truth 仍由 runtime
  memory authority 拥有

## K-CONN-018 OAuth-managed Lifecycle Boundary

`auth_kind=OAUTH_MANAGED` 的 runtime authority 固定为“托管 sealed payload 并在
consume/probe 时解出最小执行凭据子集”，而不是“拥有第三方 OAuth 登录与刷新
编排”。

固定规则：

- `credential_json` 是 provider-defined sealed payload；runtime 在当前 admitted
  scope 只要求其中能解出一个可用执行 token（例如 `api_key`、`access_token`、
  或 `token`）
- runtime 可以按 `provider_auth_profile` 为执行请求派生 provider-native
  headers，但不得因此把 provider-specific payload schema 提升为新的 proto
  truth
- runtime 在当前 topic scope 内不拥有 browser/device-code login、refresh
  orchestration、或 token rotation 持久化语义；这些不属于 connector consume
  contract
- managed OAuth payload 若无法解出执行 token，probe 与 consume 必须返回
  `AI_CONNECTOR_CREDENTIAL_MISSING`
- 上游若以 401/403 或等价 provider-auth failure 拒绝 managed OAuth credential，
  runtime 必须 fail-close 为 `AI_PROVIDER_AUTH_FAILED`
- provider auth failure 不得触发 runtime 内部的隐式 refresh、fallback 到其他
  connector、或 credential payload 静默重写
