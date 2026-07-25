# Runtime Security Core Rationale

> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/runtime/security-core.authority.yaml`。

## Rationale 完整性对账

### 已收录

- AuthN token validation：`K-AUTHN-001..009` 的 bearer input、claims、algorithm/header、JWKS cache/source、clock skew、revocation wire/failure taxonomy、minimum context 与 Realm claim alignment 收录为 `rule.nimi.runtime.security-core.r001..r018`。
- AuthZ and ownership：`K-AUTH-000..007` 的 local-target hard cut、authenticated/anonymous access、information hiding、connector owner/RPC gates、fixed consume order、ScenarioJob ownership 与 AuthN/AuthZ layering 收录为 `r019..r030`。
- Endpoint security：`K-SEC-001..005` 的 managed/inline validation、HTTPS/loopback baseline、unsafe ranges、DNS revalidation、pinned-IP failover、execution-time enforcement 与 no-private-allowlist boundary 收录为 `r031..r036`。
- Permission decision：`K-GRANT-001..003`、`K-GRANT-014` 的 public grant hardcut、app posture-only surface、five authority classes、no-generic-grant boundary、atomic admission、empty current set 与 future owner lifecycle 收录为 `r037..r047`、`r082..r083`。
- Key source and routing：`K-KEYSRC-000..013` 的 target-v2 hard cut、managed/inline paths、metadata and truth table、fixed evaluation, identity and error requirements、managed/inline dispatch、no fallback、target refs、memory/AIProfile cloud binding 与 request-scoped credential injection 收录为 `r048..r066`、`r084..r085`。
- Workspace binding：`K-BIND-016..024` 的 owner/purpose、relation/attachment、issue/revoke, TTL/restart、internal resolver, decision/allow/revocation/audit/fail-close matrix 与 consumer boundary 收录为 `r067..r081`、`r086..r087`。
- 旧 `workspace-binding-relation.yaml` 的 blocked-pending production posture、relation field authority、attachment allow/forbid lists、closed decisions 与 revoke triggers 已进入 `r067`、`r069..r070`、`r075`、`r078`；表已删除，不再形成平行产品事实源。
- 下文逐字保留六份旧契约散文，供历史 rationale 与逐条核对；现行 canonical 容器为 6 个 definition 加 87 个 rule，共 93 个单元。

### 缺失

- 第一轮成文后逐句对账发现 five authority classes 的名称不能替代各类产品含义，已补入 `r082`。
- 第一轮成文后逐句对账发现 `store_identity: absent_pre_admission` 与 positive mutation absent 的独立变更禁令需要显式准入，已补入 `r083`。
- 第一轮成文后逐句对账发现 key source、local connector facade、provider runtime plane 与 route policy 的分类边界容易被路由摘要吞掉，已补入 `r084`。
- 第一轮成文后逐句对账发现 managed credential 只经 ConnectorService 注入 request-scoped execution context、下游不得直读 CredentialStore 的边界遗漏，已补入 `r085`。
- 第一轮成文后逐句对账发现 workspace binding 的 adjacent-product 禁用清单与 scoped app relation 不得扩宽需要逐项保留，已补入 `r086`。
- 第一轮成文后逐句对账发现 resolver caller metadata 的两个 exact header name 与 device derivation source 需要显式保留，已补入 `r087`。
- 补齐后缺失：无。

### 有意拒绝

- 旧 `K-*` 标识、Owner Domain 标题、章节编号、跨文档编排与 reference-test 文件清单仅作为下方历史 rationale 保留；现行规范稳定标识为 `rule.nimi.runtime.security-core.r001..r087`。
- 邻接 owner 的 catalog、provider capability、Runtime Target v2、account membership、permission catalog 与 RPC posture 表不复制为本容器的第二份完整 authority；本容器只准入本波需要的安全消费边界与 fail-closed 结果。
- `workspace-binding-relation.yaml` 的 product_catalog 包装、entries 索引与旧 source-rule 编排不准入；其产品绑定语义、禁带凭据、decision 和 revoke closed set 已进入 canonical rules。
- Workspace issue/revoke/resolver 的历史正向描述不覆盖随行表的 blocked-pending-separate-operation posture；`r067` 维持生产禁用，`r068..r081`、`r086..r087` 仅定义未来独立准入必须满足的边界。
- Runtime Go 注释中的旧规则 ID 仅为历史锚点，不构成活消费，也不在本波改动产品代码。

---

<!-- migrated-source: .nimi/spec/runtime/kernel/authn-token-validation.md -->

# AuthN Token Validation Contract

> Owner Domain: `K-AUTHN-*`

## K-AUTHN-001 Bearer token 输入模型

- gRPC metadata 认证头键固定为 `authorization`（HTTP `Authorization` 在 gRPC 层归一化为该键）。
- `authorization` 仅接受 `Bearer <jwt>` 形式。
- 无 `Authorization` 视为 anonymous，不报错。
- `authorization` 存在但格式非法，必须 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`，不得降级为 anonymous。

## K-AUTHN-002 必校验 claims

Realm JWT 最小必校验集合：

- `iss`
- `aud`
- `sub`
- `exp`
- `iat`

如存在 `nbf`，必须参与时序校验。

## K-AUTHN-003 算法与 Header 约束

- 仅允许 generated Realm JWKS contract 当前声明的 `RS256`；未在该
  contract 中出现的算法或 key shape 一律 fail-close，Runtime 不维护平行
  transport DTO。
- `alg=none` 必须拒绝。
- `kid` 缺失必须拒绝。

## K-AUTHN-004 JWKS 缓存与刷新

- JWKS 读取采用缓存优先，缓存 miss 或 `kid` miss 触发单次刷新。
- 刷新失败时不得降级为 anonymous，必须返回 `UNAUTHENTICATED`。
- 必须具备失败回退窗口：可在短 TTL 内继续使用最近一次成功快照（仅用于已命中 `kid`）。
- `auth.jwt.jwksUrl` 是 Runtime 验签公钥的唯一来源；`publicKeyPath` 不属于有效验签链路。
- `auth.jwt.jwksUrl` 默认必须使用 `https`；仅当 host 为 loopback（`localhost` / `127.0.0.0/8` / `::1`）时允许 `http`，用于本地开发与桌面集成。

## K-AUTHN-005 时钟偏差

- `exp`/`nbf` 校验必须应用固定时钟偏差窗口（Phase 1: `±60s`）。
- 超过窗口后 token 视为无效，不允许软容忍。

## K-AUTHN-006 会话失效与撤销

- token 通过签名校验后仍需检查会话撤销状态（若会话域可用）。
- 已撤销或已过期会话必须返回 `UNAUTHENTICATED` + `SESSION_EXPIRED`。
- Runtime 通过 `auth.jwt.revocationUrl` 配置的内省端点执行撤销检查；bearer JWT 验签成功后必须携带 `sid` 继续查询该端点。
- `auth.jwt.revocationUrl` 与 `auth.jwt.issuer` / `auth.jwt.audience` / `auth.jwt.jwksUrl` 属于同一组 restart 配置，缺任一项时 bearer JWT 链路必须 fail-close。
- 撤销查询 contract 固定为 `POST auth.jwt.revocationUrl`，JSON body 包含：
  - `session_id`
  - `subject_user_id`
  - `issuer`
  - `audience`
  - `issued_at`
  - `expires_at`
- 内省响应 contract 固定为 `200 application/json`，字段为：
  - `active: boolean`
  - `revoked: boolean`
  - `expires_at?: string`（RFC3339）
- `revoked=true` 或 `active=false` 均视为撤销；网络错误、非 2xx、非法响应不得降级为 anonymous，必须返回 `UNAVAILABLE` + `AUTH_REVOCATION_UNAVAILABLE`，并携带 retryable 投影。

## K-AUTHN-007 失败语义统一

Bearer 格式、验签、claims 失败统一：

- gRPC code: `UNAUTHENTICATED`
- reason code: `AUTH_TOKEN_INVALID`

> **注脚**：K-AUTHN-006 对已判定的会话撤销/过期使用 `SESSION_EXPIRED`，对撤销内省临时不可判定使用 `AUTH_REVOCATION_UNAVAILABLE`。K-AUTHSVC-013 为 ExternalPrincipal 场景定义了细分码 `AUTH_TOKEN_EXPIRED`（proof JWT 过期）和 `AUTH_UNSUPPORTED_PROOF_TYPE`（不支持的 proof_type）。这些均为本规则的显式细分例外。

## K-AUTHN-008 上下文投影

AuthN 成功后向下游投影最小身份上下文：

- `subject_user_id`（来自 `sub`）
- `issuer`
- `audience`
- `session_id`（若存在）

下游 AuthZ 仅消费投影结果，不重复实现 JWT 解析逻辑。

## K-AUTHN-009 跨服务 Token Claims 契约

Realm 后端签发 JWT，Runtime 校验 JWT。两者的 claims 契约必须对齐：

- **`iss`（签发者）**：Runtime 接受的 `iss` 值由配置定义（`K-DAEMON-009` 的 `auth.jwt.issuer` 字段）。部署者必须确保 Realm 后端签发的 token 的 `iss` claim 与 Runtime 配置的 `auth.jwt.issuer` 一致。
- **`aud`（受众）**：Runtime 接受的 `aud` 值由配置定义（`K-DAEMON-009` 的 `auth.jwt.audience` 字段）。部署者必须确保 Realm 后端签发的 token 的 `aud` claim 包含 Runtime 配置的 `auth.jwt.audience` 值。
- **JWKS 端点**：Runtime 通过配置中的 `auth.jwt.jwksUrl` 获取 Realm 后端的公钥集合（`K-AUTHN-004`）。

**不一致后果**：`iss` 或 `aud` 不匹配时，Runtime 对所有携带 Realm token 的请求返回 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`（`K-AUTHN-007`）。Desktop 用户将无法执行任何认证操作。

**跨层引用**：`D-AUTH-004`（Desktop 消费 Realm 签发 token）、`K-DAEMON-009`（配置三层优先级）。

> 跨表引用：每个 RPC 的 closed posture（including binding-only,
> protected-origin, blocked-pending-authority and deny-all tombstone）由
> `tables/runtime-rpc-auth-posture.yaml` 索引并汇总在分片中；a JWT posture
> never implies protected origin。

## Reference Tests (informative, not normative)

K-AUTHN-006 conformance is exercised by the runtime test suite at
`runtime/internal/authn/validator_test.go` and
`runtime/internal/authn/interceptor_test.go`. Tests cover all
rows of the response decision matrix defined in the
cross-referenced introspection contract, plus network-failure
branches (HTTP 500, non-JSON body, missing fields, wrong
content-type, request timeout, and revocationUrl-empty
fail-close per the K-AUTHN-006 restart config group). The test
fixtures use real `httptest.NewServer`
to exercise the contract under realistic transport behavior.


---

<!-- migrated-source: .nimi/spec/runtime/kernel/authz-ownership.md -->

# AuthZ & Ownership Contract

> Owner Domain: `K-AUTH-*`

## K-AUTH-000 Runtime Target Identity v2 Hard Cut

`LOCAL_MODEL` is not an active connector kind or ownership path. Local model
authorization must be derived from Runtime local asset/profile ownership.
Connector ownership applies to remote credential custody only.

## K-AUTH-001 身份模型

- 有效 Realm JWT：可访问 caller-owned local asset/profile target refs 与 owner=`sub` 的 `REMOTE_MANAGED` credential connector。
- 无 JWT：可访问 machine-local asset/profile target refs、system-owned remote credential connector，以及 inline 路径；其中 anonymous 创建的 machine-global connector 仅限 `auth_kind=API_KEY`，并以 `owner_type=SYSTEM`、`owner_id="machine"` 持久化。
- 携带 `Authorization` 但 JWT 无效：必须 `UNAUTHENTICATED`，不降级匿名。

`JWT` 的有效性判定由 `K-AUTHN-002`（必校验 claims）、`K-AUTHN-003`（算法约束）、`K-AUTHN-004`（JWKS）与 `K-AUTHN-005`（时钟偏差）定义。

## K-AUTH-002 信息隐藏

以下场景统一返回 `NOT_FOUND`：

- remote connector 不存在。
- remote connector owner 不匹配。
- 无 JWT 访问 user-owned remote connector 路径。

## K-AUTH-003 Connector owner 固定映射

- authenticated `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_REALM_USER`
- anonymous machine-global `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_SYSTEM` 且 `owner_id="machine"`，但仅适用于 `auth_kind=API_KEY`
- `auth_kind=OAUTH_MANAGED` 的 `REMOTE_MANAGED` 必须固定为 `CONNECTOR_OWNER_TYPE_REALM_USER`
- local asset/profile target refs -> RuntimeLocalService ownership, not ConnectorService ownership

## K-AUTH-004 管理 RPC 身份门禁

- `Create`：有效 JWT 时可创建 user-owned remote connector；JWT 缺失时只允许创建 `auth_kind=API_KEY` 的 machine-global remote connector。
- `Update/Delete`：user-owned remote connector 仍必须有效 JWT；`owner_id="machine"` 的 machine-global remote connector 仅限 `auth_kind=API_KEY`，并允许 anonymous 与 authenticated 调用方管理。
- `Get/List/Test/ListConnectorModels`：JWT 可缺失；缺失时 user-owned remote 语义按信息隐藏处理，system-owned remote connector 继续可见；若发现 non-user-owned `OAUTH_MANAGED` 记录，必须按 `NOT_FOUND` fail-close。

## K-AUTH-005 AI consume 资源校验顺序

`connector_id` 路径在 JWT 通过后，必须按固定顺序：

1. owner
2. status
3. credential

该顺序不可调整，避免越权侧信道泄露。此评估顺序由 K-KEYSRC-004 的 step 定义强制执行。

## K-AUTH-006 ScenarioJob owner 语义

- job 创建时：有效 JWT => `owner_id=jwt.sub`；否则 `owner_id="anonymous"`。
- `GetScenarioJob/CancelScenarioJob/SubscribeScenarioJobEvents/GetScenarioArtifacts` 基于 job owner 校验，不依赖 connector 存续。

## K-AUTH-007 AuthN 与 AuthZ 分层

- AuthN（验签/会话有效性）失败统一返回 `UNAUTHENTICATED` + `AUTH_TOKEN_INVALID`，不进入 AuthZ 评估。
- AuthZ 规则（owner/status/credential）仅在 AuthN 通过后执行。

> 跨表引用：每个 RPC 的 closed posture（including binding-only,
> protected-origin, blocked-pending-authority and deny-all tombstone）由
> `tables/runtime-rpc-auth-posture.yaml` 索引并汇总在分片中；ordinary authn
> or request-body authorization never upgrades protected origin。


---

<!-- migrated-source: .nimi/spec/runtime/kernel/endpoint-security.md -->

# Endpoint Security Contract

> Owner Domain: `K-SEC-*`

## K-SEC-001 校验对象

以下 endpoint 必须校验：

- `REMOTE_MANAGED` connector endpoint
- inline `x-nimi-provider-endpoint`

## K-SEC-002 Phase 1 安全基线

1. 默认仅允许 `https://`
2. `http://` 仅在满足以下全部条件时允许：
   - 目标地址为 loopback（`localhost`、`127.0.0.0/8`、`::1`）
   - 显式开启 `allow_loopback_provider_endpoint=true`
3. 无条件拒绝的高风险地址（不受任何开关影响）：
   - 链路本地：`169.254.0.0/16`、`169.254.169.254`、`fe80::/10`
   - 私网：`fc00::/7`
4. 条件拒绝的 loopback 地址（`allow_loopback_provider_endpoint=false` 时拒绝）：
   - `localhost`、`127.0.0.0/8`、`::1`
5. DNS 解析后按实际 IP 网段重新校验（解析结果可能落入上述拒绝范围）

## K-SEC-003 TOCTOU 防护

- 必须 pin 已校验 IP 作为实际拨号目标。
- TLS `ServerName` 与 HTTP `Host` 仍使用原始域名。
- 当 DNS 返回多个已校验的 safe IP 时，transport 必须允许在这些 pinned IP 之间做连接级 failover；不得因为只固定第一个 safe IP 而把同一 hostname 的后续 safe 地址全部浪费掉。

## K-SEC-004 执行期强制校验

endpoint 校验不允许只在 create/update 时执行；每次实际出站请求前必须执行。

## K-SEC-005 Phase 1 配置边界

Phase 1 不提供私网 allowlist（CIDR/hosts）。


---

<!-- migrated-source: .nimi/spec/runtime/kernel/grant-service.md -->

# Runtime Permission Decision Contract

> Owner Domain: `K-GRANT-*` (owner-internal decision lifecycle only)

## K-GRANT-001 Public Grant Family Hardcut

The former public credential-grant service is removed from proto, generated
clients, SDK exports, Runtime registration and persistence. Its wire identities
are reserved. No token, bearer, scope list, resource fingerprint, operation id,
delegation chain or app-selected endpoint may recreate it under another name.

The app-facing surface is product-level permission status and request only.
Apps cannot approve, decide, revoke, mint or carry authority. Desktop may own a
future user decision UI, but Runtime or the canonical remote owner retains the
decision truth and endpoint enforcement.

## K-GRANT-002 Authority-Class Separation

Runtime resolves every local-app action to exactly one Platform authority class:

- `base_entitlement`: the calling principal's bounded Nimi-private partition;
- `user_permission`: durable access to a protected Nimi/Realm/Agent/Cognition
  product capability through one admitted public permission id;
- `one_shot_consent`: one owner-selected resource represented by a bounded,
  non-forgeable handle;
- `app_owned_authority`: the app host's own SQLite, media, settings, cache,
  routes and product commands; or
- `os_right`: authority actually granted to the native process by the OS.

Only `user_permission` may use an owner-internal durable decision lifecycle.
Base entitlements, app-owned authority, one-shot handles and OS rights never
create a Runtime permission row. Launch approval, publisher review, Developer
Mode, login, session existence, product-route availability, AI routing and
metering are not permissions and cannot create synthetic permission truth.

## K-GRANT-003 No Generic Operation/Resource Grant Engine

Public permissions come only from
`../../platform/kernel/tables/nimi-app-permission-catalog.yaml`. Internal
operation and resource identities remain implementation details of their
canonical owner. They may be used for endpoint enforcement and protected audit,
but are forbidden from manifests, permission requests, ordinary SDK/Kit
surfaces, approval UI and app-readable diagnostics.

Runtime must not persist or evaluate a generic `capability_scope +
resource_scope` grant. A catalog row alone is not authority. A permission can
become admitted only when its decision owner, selector, lifecycle, endpoint
mapping, audit, revoke, SDK/Kit projection, product UI and positive evidence
arrive atomically. Until then status/request returns typed `unavailable` and
every mapped protected operation fails closed.

## K-GRANT-014 Local Public-Permission Lifecycle Admission Boundary

The current admitted third-party public-permission set is empty. Consequently
Runtime has no positive local permission mutation path and no durable
permission-decision store. A local app may
still open a restricted process-bound session and use base entitlements; it may
not list protected Agent/account/resource inventory merely to construct an
authorization request.

When a Runtime-owned public permission is admitted, its private lifecycle must
bind at least:

`local_os_user_anchor + account_id + local_app_principal_id + permission_id +
owner_selector_digest`.

The selector is produced by the canonical owner, never supplied as authority by
the app. The lifecycle must have monotonic revision, explicit user decision
evidence, account/principal isolation, revoke semantics, fresh reads at every
protected endpoint and complete audit. Account switch, principal tombstone or
owner-policy change must fail closed. Display `app_id`, publisher tier,
provenance, catalog presence or a valid session cannot substitute for the
current decision.

The exact pre-admission and future target schema is defined by
`tables/local-app-grant-binding-schema.yaml`. It intentionally declares
`store_identity: absent_pre_admission`; changing that value requires the full
permission admission slice, not a standalone schema or CRUD change.


---

<!-- migrated-source: .nimi/spec/runtime/kernel/key-source-routing.md -->

# Key Source & Routing Contract

> Owner Domain: `K-KEYSRC-*`

## K-KEYSRC-000 Runtime Target Identity v2 Hard Cut

`K-RTARGET-*` is the active target-identity authority. `connector_id` remains a
managed credential custody input only. It is not a cloud model target identity.
Remote cloud execution must resolve through `remote_model_catalog_id`. Local
execution must resolve through v2 local durable refs. Any older `model_id`
validation chain or `connector_id + model_id` cloud target shape in this file
is retired as durable target identity.

## K-KEYSRC-001 路径模型

AI consume 的显式 key-source 只允许二选一路径：

- `connector_id` 路径（managed remote）— **推荐路径**，凭据由 Runtime ConnectorService 托管（K-CONN-001: custodian not distributor）
- inline 路径（`x-nimi-key-source=inline` + inline metadata）— **escape hatch**，凭据通过 gRPC metadata 直传

managed remote connector 的 admitted auth shape 允许：
- `API_KEY`
- `OAUTH_MANAGED`

这两类都仍属于 connector custody；调用方都只提交 `connector_id`。

`OAUTH_MANAGED` connector 的 credential payload 是 provider-defined sealed secret，
但其 `provider_auth_profile` 仍受 admitted set 约束；唯一事实源是
`tables/connector-auth-profiles.yaml`。
此外，`OAUTH_MANAGED` connector 必须保持 user-owned；发现 machine/system-owned
记录时，managed 路径必须按 `NOT_FOUND` fail-close。

local connector 不属于 AI consume 的执行入口；Phase 1 中它仅作为本地 category 的目录 / probe facade（见 `K-LOCAL-004`）。

`tables/provider-capabilities.yaml` 中的 `runtime_plane: local | remote` 保持其 provider capability 语义，不等同于本文件的路由策略 `LOCAL | CLOUD`。

若 `connector_id` 与 inline metadata 都未提供，请求不进入 managed / inline 路径，继续按 runtime config 或 anonymous local 默认路由评估。

**Inline 路径定位声明（K-KEYSRC-001）**：inline 路径是为以下场景设计的 escape hatch，非推荐的常规使用路径：
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
9. runtime target ref / remote catalog validation
10. 路由执行 + 审计

对于 `OAUTH_MANAGED` connector，step 6 与 step 10 的附加固定语义是：

- step 6 只负责从 sealed payload 解出当前请求所需的最小执行 token / headers
- 若 step 6 无法解出执行 token，必须 fail-close 为
  `AI_CONNECTOR_CREDENTIAL_MISSING`
- step 10 若遭遇 provider-auth rejection，必须 fail-close 为
  `AI_PROVIDER_AUTH_FAILED`
- runtime 不得在 consume 路径中隐式 refresh、替换、或重写 managed OAuth
  payload

## K-KEYSRC-005 管理 RPC app_id 传递

- 管理 RPC 的 `app_id` 仅通过 `x-nimi-app-id` 传递（必填）。
- AI consume 的 `app_id` 在 request body 中传递（必填）。

## K-KEYSRC-005a AI consume subject_user_id 要求

- `subject_user_id` 对以下 AI consume 路径仍为必填：
  - `route_policy=CLOUD`
  - 任意 remote managed `connector_id` 路径
  - 任意 inline remote 凭据路径（`x-nimi-key-source=inline` 或 `x-nimi-provider-*`）
- 仅当请求显式走 anonymous local 路径时，`subject_user_id` 才允许为空：
  - `route_policy=LOCAL`
  - `connector_id` 为空
  - 不存在 inline remote 凭据 metadata
- anonymous local 只在请求未携带 `Authorization` 时成立。若携带的 Bearer 非法或失效，仍必须按 `K-AUTHN-001` / `K-AUTHN-007` 返回 `UNAUTHENTICATED + AUTH_TOKEN_INVALID`，不得降级为 anonymous。

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
2. 若 connector 的 raw kind 为 retired local connector value `1`，必须拒绝：
   `FAILED_PRECONDITION` + `AI_LOCAL_CONNECTOR_RETIRED`。local connector 不得进入 AI consume 执行链路。
3. 查 `tables/provider-capabilities.yaml`，按 connector 的 `provider` 确定 `runtime_plane` 与 `execution_module`。
4. managed connector 仅允许 `runtime_plane=remote`；执行模块固定分发到 `nimillm`。

**inline 路径**（`x-nimi-key-source=inline`）：

1. 从 `x-nimi-provider-type` 查 `tables/provider-capabilities.yaml`。
2. inline 仅支持 `runtime_plane=remote` 且 `inline_supported=true` 的 provider。`runtime_plane=local` 或 `inline_supported=false` 的 provider 不可通过 inline 路径访问。
3. 分发到 `nimillm` 执行模块。

路由判定不可回退：一旦确定执行路径，不允许在执行失败后自动切换到另一条路径。

## K-KEYSRC-010 Runtime Target Ref Validation（Step 9）

K-KEYSRC-004 step 9 follows K-RTARGET durable target identity:

**Remote managed path**:
- Cloud execution requires `connector_id`, `remote_model_catalog_id`,
  `provider_model_id`, and `provider`.
- Missing `remote_model_catalog_id` returns `INVALID_ARGUMENT` +
  `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED`.
- Stale or snapshot-mismatched `remote_model_catalog_id` returns
  `FAILED_PRECONDITION` + `AI_REMOTE_MODEL_CATALOG_STALE`.

**Local path**:
- Local execution requires the v2 local discriminant from K-RTARGET-002.
- Raw local asset ids, provider model ids, or retired compact
  `targetId/profileId` pairs are rejected as durable execution identity.
- Missing, incompatible, or unknown local component bindings fail with the
  K-RTARGET-008 reason-code taxonomy.

Provider-native model ids remain provider facts only. They must not be used to
mint durable runtime target identity.

## K-KEYSRC-011 Memory Embedding Cloud Binding Resolution Boundary

Desktop-host-owned memory embedding live config 若选择 `cloud` source，其 remote
binding resolution 必须复用 managed connector 路径语义，而不是发明第二套凭据路径。

固定规则：

- admitted cloud binding shape 必须至少包含 `connector_id`,
  `remote_model_catalog_id`, `provider_model_id`, and `provider`
- host 持久化的 memory embedding config 不得使用 inline credential metadata、
  inline endpoint、或任何 escape-hatch secret shape
- runtime 在解析 cloud memory embedding binding 时，必须沿用 managed connector
  的 owner/status/credential/endpoint 安全校验，而不是跳过到 provider-specific
  shortcut
- 若 `connector_id` 指向 local connector、无效 connector、或 owner/status 校验
  不通过，则该 cloud binding 必须 fail-close
- 本规则只冻结 remote credential/routing legality；resolved embedding profile、
  readiness、以及 canonical bank bind / cutover 结果仍由 runtime memory authority
  决定

## K-KEYSRC-012 Generic AIProfile Cloud Connector Target Ref

For AIProfile cloud connector slices (`K-CONN-019`), the live AIConfig target ref
may carry only non-secret connector routing identity:

- `connector_id`
- `remote_model_catalog_id`
- `provider_model_id`
- `provider`
- provider/capability discriminator when needed for validation
- profile slice / requirement ref needed for traceability

Runtime must resolve the connector through managed connector owner/status/
credential checks before execution. SDK/Desktop/App callers must not use inline
credential metadata, inline endpoint, provider-native secret fields, or
app-local connector stores as substitutes for the managed connector path.

This rule does not own provider model catalog truth, readiness, quota, health,
or execution result. Those remain Runtime connector/provider execution evidence
outside AIProfile/AIConfig.

## K-KEYSRC-013 Runtime Target Identity v2 Supersession

K-RTARGET-002 and K-RTARGET-003 supersede K-KEYSRC-010 through K-KEYSRC-012 for
durable target identity. Remote managed cloud refs must include `connector_id`,
`remote_model_catalog_id`, `provider_model_id`, and `provider`. Missing
`remote_model_catalog_id` fails with `AI_REMOTE_MODEL_CATALOG_ID_REQUIRED`;
stale ids fail with `AI_REMOTE_MODEL_CATALOG_STALE`.

Local refs must use the v2 local discriminant from K-RTARGET-002. Raw
`model_id`, `target_model_id`, `localModelId`, `goRuntimeLocalModelId`,
`targetId/profileId`, and `connector_id + model_id` are not admitted durable
target identity. `connector_id` remains credential custody only.


---

<!-- migrated-source: .nimi/spec/runtime/kernel/workspace-binding-contract.md -->

# Workspace Binding Contract

> Owner Domain: `K-BIND-*`

## K-BIND-016 Workspace Knowledge Binding Authority

Workspace binding is a Runtime-issued, workspace-specific, non-secret
attachment/relation family for WORKSPACE_PRIVATE knowledge access. It is
separate from Avatar / agent scoped app binding.

Fixed rules:

- workspace binding issue/revoke authority is owned by
  `RuntimeAccountService`; public `IssueWorkspaceBinding` and
  `RevokeWorkspaceBinding` RPC projection is admitted only for workspace
  binding attachment mint/revoke and must not expose resolver/probe semantics
- workspace binding exists only for `purpose = workspace.knowledge.consume`
- workspace binding must not be accepted for Avatar, agent, app messaging,
  world, grant, Realm REST, or direct account-token access
- Avatar / agent scoped binding relation semantics must not be broadened to
  satisfy WORKSPACE_PRIVATE knowledge authorization
- the attachment is a non-secret selector, not a token, not a Realm credential,
  and not subject/account truth

## K-BIND-017 Workspace Binding Relation And Attachment

The admitted workspace binding relation is:

| Field | Requirement |
|---|---|
| `binding_id` | Runtime-issued opaque id |
| `runtime_app_id` | required; Runtime-authenticated caller app id |
| `app_instance_id` | required; Runtime-authenticated caller app instance id |
| `device_id` | required; Runtime-derived device identity |
| `account_id` | required; Runtime account custody projection |
| `realm_environment_id` | required; Runtime account projection environment |
| `workspace_id` | required; target Realm-owned workspace membership key |
| `purpose` | exactly `workspace.knowledge.consume` |
| `scopes` | subset of admitted runtime knowledge scopes |
| `issued_at` / `expires_at` | required; active binding cannot be durable |
| `state` / `reason_code` | required lifecycle state and last reason |

The admitted `KnowledgeRequestContext` workspace binding attachment may contain
only:

- `binding_id`
- optional `binding_handle`
- `runtime_app_id`
- `app_instance_id`
- `workspace_id`
- optional `realm_environment_id`

It must not contain `account_id`, `device_id`, Realm token, Runtime app session
token, refresh token, raw JWT, decoded subject, `subject_user_id`, or
membership proof material.

## K-BIND-018 Workspace Binding Issue And Revoke Lifecycle

The workspace binding issue path must:

- require Runtime-authenticated caller app identity
- require account state `authenticated`
- validate caller `runtime_app_id`, `app_instance_id`, `device_id`,
  `account_id`, and `realm_environment_id` from Runtime-owned context
- validate target `workspace_id` against an active `K-ACCSVC-018` membership
  projection
- require a non-empty scope set from the admitted runtime knowledge scope
  vocabulary
- mint only a workspace binding attachment and redacted binding audit/event
  evidence

The workspace binding revoke path must:

- require Runtime-authenticated caller app identity
- validate caller ownership of the stored workspace binding relation
- revoke the binding idempotently
- emit `binding.revoked` with a typed reason

Workspace bindings must have short TTLs, must not survive daemon restart, and
must not be persisted as active capabilities. Implementations may retain a
redacted ledger for audit/restart evidence, but that ledger must not be
accepted as active binding state.

## K-BIND-019 Internal Workspace Binding Resolver

`ResolveWorkspaceBinding` is an internal account-owned resolver seam. It is not
a public RPC.

Resolver input must include:

- Runtime-authenticated caller identity from the protocol envelope: app id from
  `x-nimi-app-id`, app instance id from `x-nimi-app-instance-id`, and device
  identity derived or verified through Runtime account/app registry state
- workspace binding attachment
- target workspace id from the knowledge bank owner
- required knowledge scopes
- knowledge action name for audit

Resolver decisions are:

- `ALLOW`
- `DENY_MISSING_ATTACHMENT`
- `DENY_MALFORMED_ATTACHMENT`
- `DENY_NOT_FOUND`
- `DENY_REVOKED`
- `DENY_EXPIRED`
- `DENY_REPLAY`
- `DENY_ACCOUNT_UNAVAILABLE`
- `DENY_CALLER_MISMATCH`
- `DENY_WORKSPACE_MISMATCH`
- `DENY_ENV_MISMATCH`
- `DENY_DEVICE_MISMATCH`
- `DENY_SCOPE_MISSING`

Positive allow requires all of:

- account state is `authenticated`
- active workspace membership projection exists at consume time
- binding exists, is active, and is not expired
- relation purpose is `workspace.knowledge.consume`
- caller app, app instance, device, account, and realm environment match the
  stored relation
- attachment workspace id equals the target bank owner workspace id
- required scopes are covered by the relation scopes

Any mismatch fails closed. Resolver must not make synchronous Realm membership
lookups for every knowledge RPC and must not delegate truth to SDK/Desktop/app
cache.

## K-BIND-020 Workspace Binding Revocation And Restart

Workspace bindings must revoke or become invalid on:

- logout
- account switch
- membership loss
- realm environment change
- custody unavailable
- refresh failure / reauth required
- account expiration
- device mismatch
- scope change
- replay detection
- policy revocation
- daemon restart

Daemon restart posture is memory-only not-found for active state. If a redacted
ledger exists, it may emit `binding.revoked` evidence with reason
`daemon_restart_no_recovery`, but old workspace binding ids must never become
active again after restart.

## K-BIND-021 Workspace Binding Audit

Workspace binding issue, revoke, expire, replay, and resolver-deny decisions
must write audit evidence. Minimum fields:

- `binding_id`
- `runtime_app_id`
- `app_instance_id`
- `device_id`
- `account_id`
- `realm_environment_id`
- `workspace_id`
- `knowledge_action` when consumed through knowledge authorization
- `required_scopes`
- `decision`
- `reason_code`
- `action_hint`
- `event_sequence`

Audit must not record attachment handles as secrets, token values, raw JWT,
decoded subject, refresh material, or caller-supplied subject proof.

## K-BIND-022 Workspace Binding Fail-Close Matrix

Workspace binding must fail closed for missing attachment, malformed
attachment, unknown binding id, revoked binding, expired binding, replay,
account unavailable, caller mismatch, workspace mismatch, realm environment
mismatch, device mismatch, missing scope, membership projection missing/stale,
and direct use of `app_id` / `subject_user_id` as proof.

## K-BIND-023 SDK/Desktop/App Boundary

SDK, Desktop, Web, and apps may only carry or project the workspace
binding attachment fields admitted by `K-BIND-017`. They must not compute
workspace authorization, cache membership truth as resolver truth, call an
internal resolver, or convert workspace binding into Realm REST credentials.

## K-BIND-024 Workspace Binding Tables

Machine-readable workspace binding relation, decision, and scope facts must be
kept in `tables/workspace-binding-relation.yaml` and consumed by runtime
spec-derived docs before implementation begins.
