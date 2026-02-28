# Runtime Kernel Contracts

> Status: Draft
> Date: 2026-02-28
> Scope: Runtime AI 执行平面 + Auth Core 跨域契约（Connector / Remote / Local / AuthN / AuthService / GrantService）。

## 1. 目标

本目录是 Runtime 规范的唯一权威层（kernel layer）。
任何跨域规则只能在 kernel 定义一次，业务文档只能引用 Rule ID，不得复述。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`spec/runtime/connector-auth.md`、`spec/runtime/nimillm.md`、`spec/runtime/local-model.md` 只能引用 kernel Rule ID。
- 冲突处理：若下游与 kernel 冲突，以 kernel 为准；下游必须在同次变更中修正。

## 3. Rule ID 规范

- 格式：`K-<DOMAIN>-NNN`
- 示例：`K-AUTH-003`、`K-AUTHN-002`、`K-STREAM-003`
- 规则：
  - `DOMAIN` 固定枚举：`RPC` `AUTH` `AUTHN` `AUTHSVC` `GRANT` `KEYSRC` `JOB` `LOCAL` `SEC` `STREAM` `ERR` `PAGE` `AUDIT`
  - `NNN` 三位递增编号，不复用。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `rpc-surface.md` | `K-RPC-*` | Runtime 对外 RPC 面与命名权威 |
| `authz-ownership.md` | `K-AUTH-*` | JWT、owner、信息隐藏、访问门禁 |
| `authn-token-validation.md` | `K-AUTHN-*` | JWT/JWKS 验签、缓存刷新、时钟偏差、会话失效 |
| `auth-service.md` | `K-AUTHSVC-*` | RuntimeAuthService 契约与会话生命周期 |
| `grant-service.md` | `K-GRANT-*` | RuntimeGrantService 契约与 delegated token 约束 |
| `key-source-routing.md` | `K-KEYSRC-*` | `connector_id`/inline 与 metadata 契约 |
| `media-job-lifecycle.md` | `K-JOB-*` | MediaJob 生命周期与 owner/credential 快照 |
| `local-category-capability.md` | `K-LOCAL-*` | `LocalConnectorCategory` 与 capability 权威映射 |
| `endpoint-security.md` | `K-SEC-*` | endpoint 安全校验与 TOCTOU 防护 |
| `streaming-contract.md` | `K-STREAM-*` | 流式阶段边界、终帧与错误语义 |
| `error-model.md` | `K-ERR-*` | ReasonCode 分层、映射原则与值域来源 |
| `pagination-filtering.md` | `K-PAGE-*` | 分页、排序、过滤、token 语义 |
| `audit-contract.md` | `K-AUDIT-*` | 审计字段与写入义务 |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是后续自动生成表格与 lint 的事实源：

- `tables/rpc-methods.yaml`
- `tables/rpc-migration-map.yaml`
- `tables/reason-codes.yaml`
- `tables/error-mapping-matrix.yaml`
- `tables/metadata-keys.yaml`
- `tables/key-source-truth-table.yaml`
- `tables/provider-catalog.yaml`
- `tables/provider-capabilities.yaml`
- `tables/connector-rpc-field-rules.yaml`
- `tables/job-states.yaml`
- `tables/state-transitions.yaml`

## 6. 下游引用约束

- `connector-auth.md`：仅保留 Connector 领域增量规则，导入 kernel。
- `nimillm.md`：仅保留 remote 执行模块增量规则，导入 kernel。
- `local-model.md`：仅保留 local 执行模块增量规则，导入 kernel。

## 7. Scope 与 Deferred

本目录当前不覆盖 Runtime proto 全量服务。以下服务仍处于 deferred：

- `RuntimeWorkflowService`
- `RuntimeModelService`
- `RuntimeKnowledgeService`
- `RuntimeAppService`
- `RuntimeAuditService`（仅保留 `K-AUDIT-*` 最小字段，不等价完整服务契约）
