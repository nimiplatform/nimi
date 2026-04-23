# AuthZ & Ownership Contract

> Owner Domain: `K-AUTH-*`

## K-AUTH-001 身份模型

- 有效 Realm JWT：可访问 `LOCAL_MODEL` 与 owner=`sub` 的 `REMOTE_MANAGED`。
- 无 JWT：可访问 `LOCAL_MODEL`、system-owned remote connector，以及 inline 路径；其中 anonymous 创建的 machine-global connector 仅限 `auth_kind=API_KEY`，并以 `owner_type=SYSTEM`、`owner_id="machine"` 持久化。
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
- `LOCAL_MODEL -> CONNECTOR_OWNER_TYPE_SYSTEM`

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
