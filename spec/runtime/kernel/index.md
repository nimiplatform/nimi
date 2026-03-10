# Runtime Kernel Contracts

> Scope: Runtime 全量服务契约（AI 执行平面 / Auth Core / Workflow / Voice / Audit / Model / Knowledge / App / Daemon / Config / Connector / Multimodal / Proto Governance）。

## 1. 目标

本目录是 Runtime 规范的唯一权威层（kernel layer）。
任何跨域规则只能在 kernel 定义一次，domain 文档只能引用 Rule ID，不得复述规则正文。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`spec/runtime/*.md` 仅保留导引和映射，不承载本地规则体系。
- 冲突处理：若下游与 kernel 冲突，以 kernel 为准；下游同次修正。

## 3. Rule ID 规范

- 格式：`K-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：
  - `RPC` `AUTH` `AUTHN` `AUTHSVC` `GRANT` `KEYSRC` `JOB`
  - `LOCAL` `LENG` `DEV` `SEC` `STREAM` `ERR` `PAGE` `AUDIT`
  - `DAEMON` `PROV` `WF` `MODEL` `KNOW` `APP` `CLI`
  - `CFG` `CONN` `NIMI` `MCAT` `MMPROV` `VOICE` `GATE` `PROTO`
- `NNN` 三位递增编号，不复用。
- `NNNa`/`NNNb` 后缀允许用于后插入的细化规则（如 `K-KEYSRC-005a`），保留原有规则编号稳定性。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `rpc-surface.md` | `K-RPC-*` | Runtime 对外 RPC 面与命名权威 |
| `authz-ownership.md` | `K-AUTH-*` | JWT、owner、信息隐藏、访问门禁 |
| `authn-token-validation.md` | `K-AUTHN-*` | JWT/JWKS 验签、缓存刷新、时钟偏差、会话失效 |
| `auth-service.md` | `K-AUTHSVC-*` | RuntimeAuthService 契约与会话生命周期 |
| `grant-service.md` | `K-GRANT-*` | RuntimeGrantService 契约与 delegated token 约束 |
| `key-source-routing.md` | `K-KEYSRC-*` | `connector_id`/inline 与 metadata 契约 |
| `scenario-job-lifecycle.md` | `K-JOB-*` | ScenarioJob 生命周期与 owner/credential 快照 |
| `local-category-capability.md` | `K-LOCAL-*` | 本地模型能力、依赖解析、适配器路由 |
| `local-engine-contract.md` | `K-LENG-*` | 本地引擎类型、运行模式、配置优先级 |
| `device-profile-contract.md` | `K-DEV-*` | 设备画像与兼容性判定 |
| `endpoint-security.md` | `K-SEC-*` | endpoint 安全校验与 TOCTOU 防护 |
| `streaming-contract.md` | `K-STREAM-*` | 流式阶段边界、终帧与错误语义 |
| `error-model.md` | `K-ERR-*` | ReasonCode 分层、映射原则 |
| `pagination-filtering.md` | `K-PAGE-*` | 分页、排序、过滤、token 语义 |
| `audit-contract.md` | `K-AUDIT-*` | 审计字段、写入义务、统计与健康快照 |
| `daemon-lifecycle.md` | `K-DAEMON-*` | 健康状态机、启动序列、优雅停机 |
| `provider-health-contract.md` | `K-PROV-*` | Provider 探测、状态机、名称归一化 |
| `workflow-contract.md` | `K-WF-*` | Workflow DAG、节点类型、状态机、事件流 |
| `voice-contract.md` | `K-VOICE-*` | Voice 工作流、VoiceAsset 生命周期与引用契约 |
| `model-service-contract.md` | `K-MODEL-*` | 模型注册、能力画像、状态枚举 |
| `knowledge-contract.md` | `K-KNOW-*` | 索引构建、搜索、生命周期 |
| `app-messaging-contract.md` | `K-APP-*` | 应用间消息、事件流 |
| `cli-onboarding-contract.md` | `K-CLI-*` | CLI 首次使用、provider-first cloud setup 与脚手架约束 |
| `config-contract.md` | `K-CFG-*` | 配置路径、优先级、secret policy、写入语义 |
| `connector-contract.md` | `K-CONN-*` | connector 托管、字段约束、补偿与并发安全 |
| `nimillm-contract.md` | `K-NIMI-*` | remote 执行边界、流式与审计对齐 |
| `model-catalog-contract.md` | `K-MCAT-*` | 模型/voice catalog SSOT、远程覆写与 fail-close 语义 |
| `multimodal-provider-contract.md` | `K-MMPROV-*` | canonical 输入、artifact、adapter 与路由约束 |
| `delivery-gates-contract.md` | `K-GATE-*` | 交付门定义与证据路由 |
| `proto-governance-contract.md` | `K-PROTO-*` | proto 治理、兼容策略、发布门禁 |

## 5. 结构化事实源

`tables/` 目录中的 YAML 是自动生成表格与 lint 的事实源：

- `tables/rpc-methods.yaml`
- `tables/rpc-migration-map.yaml`
- `tables/scenario-types.yaml`
- `tables/scenario-execution-matrix.yaml`
- `tables/scenario-profile-fields.yaml`
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
- `tables/voice-workflow-types.yaml`
- `tables/voice-reference-kinds.yaml`
- `tables/voice-persistence-types.yaml`
- `tables/voice-asset-statuses.yaml`
- `tables/tts-provider-capability-matrix.yaml`
- `tables/multimodal-canonical-fields.yaml`
- `tables/multimodal-artifact-fields.yaml`
- `tables/provider-extension-registry.yaml`
- `tables/runtime-delivery-gates.yaml`
- `tables/runtime-proto-governance-gates.yaml`
- `tables/capability-vocabulary-mapping.yaml`
- `tables/config-schema.yaml`
- `tables/rule-evidence.yaml`

Runtime provider model/voice default data is maintained outside `spec/` at:

- `runtime/catalog/providers/*.yaml`

## 6. Kernel Companion 约束

- `kernel/companion/*.md` 只做解释层，不定义规则。
- companion 每个章节必须带 `Anchors:` 指向 kernel Rule ID。

## 7. 结构约束

- kernel 表 `source_rule` 仅允许 `K-*`。
- domain 文档 Section 0 的导入必须在正文显式落到至少一个具体 Rule ID。
- 执行态内容不得进入 `spec/**`，计划/证据分别写入 `dev/plan/*`、`dev/report/*`。

## 8. 跨域状态机术语映射

不同域的状态机使用不同的状态名称和大小写惯例，以下分歧均为有意设计：

| 域 | 初始态 | 终态（成功） | 终态（超时/过期） | 大小写 | 引用 |
|---|---|---|---|---|---|
| ScenarioJob (`K-JOB-*`) | `SUBMITTED` | `COMPLETED` | `TIMEOUT` | UPPER_SNAKE | K-JOB-002 |
| Workflow (`K-WF-*`) | `ACCEPTED` | `COMPLETED` | — | UPPER_SNAKE | K-WF-003 |
| Provider Async Task (`K-MMPROV-*`) | `queued` | `succeeded` | `expired` | lower_snake | K-MMPROV-027 |

**设计理由**：
- ScenarioJob 与 Workflow 是 Runtime 内部域，使用 proto enum 惯例（UPPER_SNAKE）。
- Provider Async Task 是 provider API 归一化层，使用 lower_snake 以贴近 provider 原始语义。
- K-MMPROV-027 定义了 provider 异步状态到 ScenarioJob 终态的映射规则（`succeeded→COMPLETED`、`expired→TIMEOUT`、`failed→FAILED`）。

## 9. Scope 与 Deferred

本目录覆盖 Runtime proto 全量服务。Phase 1 规则构成当前规范基线；Phase 2 kernel contracts 可先以 draft 形态并存，待语义收敛后再提升为规范基线。新增语义必须先入 kernel，再改 domain 与实现。
