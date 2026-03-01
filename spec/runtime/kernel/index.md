# Runtime Kernel Contracts

> Status: Phase 1 Normative — FROZEN (2026-03-01) · Phase 2 — Draft
> Date: 2026-03-01
> Scope: Runtime 全量服务契约（AI 执行平面 / Auth Core / Workflow / Audit / Model / Knowledge / App / ScriptWorker / Daemon 基础设施）。

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
  - `DOMAIN` 固定枚举：`RPC` `AUTH` `AUTHN` `AUTHSVC` `GRANT` `KEYSRC` `JOB` `LOCAL` `LENG` `DEV` `SEC` `STREAM` `ERR` `PAGE` `AUDIT` `DAEMON` `PROV` `WF` `MODEL` `KNOW` `APP` `SCRIPT`
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
| `local-category-capability.md` | `K-LOCAL-*` | `LocalConnectorCategory`、capability 映射、三层抽象、模型获取、依赖解析、适配器路由、Node 目录生成、搜索排序 |
| `local-engine-contract.md` | `K-LENG-*` | 本地引擎类型、运行模式、HTTP 协议、健康探测、配置优先级 |
| `device-profile-contract.md` | `K-DEV-*` | 设备画像结构、GPU/NPU/Python 检测、硬件兼容性判定 |
| `endpoint-security.md` | `K-SEC-*` | endpoint 安全校验与 TOCTOU 防护 |
| `streaming-contract.md` | `K-STREAM-*` | 流式阶段边界、终帧与错误语义 |
| `error-model.md` | `K-ERR-*` | ReasonCode 分层、映射原则与值域来源 |
| `pagination-filtering.md` | `K-PAGE-*` | 分页、排序、过滤、token 语义 |
| `audit-contract.md` | `K-AUDIT-*` | 审计字段、写入义务、RuntimeAuditService 完整契约、使用量统计、健康快照 |
| `daemon-lifecycle.md` | `K-DAEMON-*` | Daemon 健康状态机、启动序列、优雅停机、Worker 监管、拦截器链、调度器、超时、配置 |
| `provider-health-contract.md` | `K-PROV-*` | Provider 健康探测、状态机、探测目标、名称归一化 |
| `workflow-contract.md` | `K-WF-*` | RuntimeWorkflowService DAG 定义、节点类型、状态机、事件流、执行模式 |
| `model-service-contract.md` | `K-MODEL-*` | RuntimeModelService 模型注册、能力画像、状态枚举 |
| `knowledge-contract.md` | `K-KNOW-*` | RuntimeKnowledgeService 索引构建、搜索、生命周期 |
| `app-messaging-contract.md` | `K-APP-*` | RuntimeAppService 应用间消息、事件流 |
| `script-worker-contract.md` | `K-SCRIPT-*` | ScriptWorkerService 脚本执行、沙箱约束 |

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
- `tables/local-engine-catalog.yaml`
- `tables/local-adapter-routing.yaml`
- `tables/daemon-health-states.yaml`
- `tables/interceptor-chain.yaml`
- `tables/ai-timeout-defaults.yaml`
- `tables/provider-probe-targets.yaml`
- `tables/workflow-node-types.yaml`
- `tables/workflow-states.yaml`

## 6. 下游引用约束

- `connector-auth.md`：仅保留 Connector 领域增量规则，导入 kernel。
- `nimillm.md`：仅保留 remote 执行模块增量规则，导入 kernel。
- `local-model.md`：仅保留 local 执行模块增量规则，导入 kernel。

## 7. 结构约束

- kernel 表（`tables/*.yaml`）的 `source_rule` 字段仅允许 `K-*` 格式的 kernel Rule ID，不允许 domain Rule ID（如 `CONN-*`、`LOCAL-*`、`NIMI-*`）。
- domain 文档 Section 0 列出的 kernel 导入必须在 body 中至少显式引用一次对应 domain 的 Rule ID，否则应从导入列表移除。

## 8. Domain 规则编号规范

domain 规则编号采用 **段落式十位递增**：

- `001`–`00x`：不变量
- `010`–`01x`：第一增量段
- `020`–`02x`：第二增量段
- 依此类推

段内连续，段间跳跃为预留空间。此规范适用于 `connector-auth.md`、`nimillm.md`、`local-model.md` 等所有 runtime domain 文档。

## 9. Scope 与 Deferred

本目录覆盖 Runtime proto 全量服务。所有服务均已有 kernel 契约覆盖，分为 Phase 1（Normative）和 Phase 2（Draft）两个约束级别。

服务清单：

**Phase 1（Normative）— 实现必须遵循全部规则：**

- `RuntimeAiService`（`K-RPC-002`）
- `ConnectorService`（`K-RPC-003`，design-first）
- `RuntimeLocalRuntimeService`（`K-RPC-004`）
- `RuntimeAuthService`（`K-AUTHSVC-002`）
- `RuntimeGrantService`（`K-GRANT-002`）

**Phase 2（Draft）— 规格完整但约束力降低，实现期允许修正：**

- `RuntimeWorkflowService`（`K-WF-*`）— `workflow-contract.md`
- `RuntimeAuditService`（`K-AUDIT-013`）— `audit-contract.md`（审计核心字段与 Phase 1 共享部分为 Normative）
- `RuntimeModelService`（`K-MODEL-004`）— `model-service-contract.md`
- `RuntimeKnowledgeService`（`K-KNOW-001`）— `knowledge-contract.md`
- `RuntimeAppService`（`K-APP-001`）— `app-messaging-contract.md`
- `ScriptWorkerService`（`K-SCRIPT-001`）— `script-worker-contract.md`
