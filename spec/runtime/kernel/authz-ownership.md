# AuthZ & Ownership Contract

> Owner Domain: `K-AUTH-*`

## K-AUTH-001 身份模型

- 有效 Realm JWT：可访问 `LOCAL_MODEL` 与 owner=`sub` 的 `REMOTE_MANAGED`。
- 无 JWT：仅允许 `LOCAL_MODEL` 与 inline 路径。
- 携带 `Authorization` 但 JWT 无效：必须 `UNAUTHENTICATED`，不降级匿名。

## K-AUTH-002 信息隐藏

以下场景统一返回 `NOT_FOUND`：

- remote connector 不存在。
- remote connector owner 不匹配。
- 无 JWT 访问 remote connector 路径。

## K-AUTH-003 Connector owner 固定映射

- `REMOTE_MANAGED -> CONNECTOR_OWNER_TYPE_REALM_USER`
- `LOCAL_MODEL -> CONNECTOR_OWNER_TYPE_SYSTEM`

## K-AUTH-004 管理 RPC 身份门禁

- `Create/Update/Delete`：必须有效 JWT。
- `Get/List/Test/ListConnectorModels`：JWT 可缺失；缺失时 remote 语义按信息隐藏处理。

## K-AUTH-005 AI consume 资源校验顺序

`connector_id` 路径在 JWT 通过后，必须按固定顺序：

1. owner
2. status
3. credential

该顺序不可调整，避免越权侧信道泄露。

## K-AUTH-006 MediaJob owner 语义

- job 创建时：有效 JWT => `owner_id=jwt.sub`；否则 `owner_id="anonymous"`。
- `GetMediaJob/CancelMediaJob/SubscribeMediaJobEvents/GetMediaResult` 基于 job owner 校验，不依赖 connector 存续。
