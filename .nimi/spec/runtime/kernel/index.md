# Runtime Kernel Contracts

> Scope: Runtime 全量服务契约（AI 执行平面 / Auth Core / Workflow / Voice / Audit / Model / Knowledge / Memory / Agent Service / App / Daemon / Config / Connector / Multimodal / Proto Governance）。

## 1. 目标

本目录是 Runtime 规范的唯一权威层（kernel layer）。
任何跨域规则只能在 kernel 定义一次，domain 文档只能引用 Rule ID，不得复述规则正文。

## 2. One Fact One Home

- 单一事实源：同一规则只允许在一个 kernel 文件定义。
- 下游投影：`.nimi/spec/runtime/*.md` 仅保留导引和映射，不承载本地规则体系。
- 冲突处理：若下游与 kernel 冲突，以 kernel 为准；下游同次修正。

## 3. Rule ID 规范

- 格式：`K-<DOMAIN>-NNN`
- `DOMAIN` 固定枚举：
  - `RPC` `AUTH` `AUTHN` `AUTHSVC` `GRANT` `KEYSRC` `JOB`
  - `LOCAL` `LENG` `DEV` `SEC` `STREAM` `ERR` `PAGE` `AUDIT`
  - `DAEMON` `PROV` `WF` `MODEL` `KNOW` `APP` `CLI`
  - `CFG` `CONN` `NIMI` `MCAT` `MMPROV` `VOICE` `GATE` `PROTO`
  - `AIEXEC` `SCHED` `WEV` `MEM` `MEMSUB` `AGCORE`
- `NNN` 三位递增编号，不复用。
- `NNNa`/`NNNb` 后缀允许用于后插入的细化规则（如 `K-KEYSRC-005a`），保留原有规则编号稳定性。

## 4. 文档所有权

| 文档 | Domain | 说明 |
|---|---|---|
| `rpc-surface.md` | `K-RPC-*` | Runtime 对外 RPC 面与命名权威 |
| `authz-ownership.md` | `K-AUTH-*` | JWT、owner、信息隐藏、访问门禁 |
| `authn-token-validation.md` | `K-AUTHN-*` | JWT/JWKS 验签、缓存刷新、时钟偏差、会话失效 |
| `auth-service.md` | `K-AUTHSVC-*` | RuntimeAuthService 契约与会话生命周期 |
| `account-session-contract.md` | `K-ACCSVC-*` | RuntimeAccountService 契约：local first-party account session、login lifecycle、secure custody、refresh、short-lived app access-token projection、logout、user switch、daemon restart recovery、scoped binding issuance |
| `scoped-app-binding-contract.md` | `K-BIND-*` | Runtime-issued scoped app binding：carrier 分类、生命周期、relation tuple、revocation、replay、Avatar/Mod/Desktop binding 规则 |
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
| `knowledge-contract.md` | `K-KNOW-*` | runtime-local knowledge banks、page lifecycle、keyword search |
| `runtime-memory-service-contract.md` | `K-MEM-*` | Runtime-owned memory substrate、bank scope、provider boundary、Realm replication |
| `runtime-memory-substrate-contract.md` | `K-MEMSUB-*` | Runtime-private local memory substrate / Hindsight bridge、health、daemon boundary、runtime-owned typed overlay |
| `runtime-agent-service-contract.md` | `K-AGCORE-*` | Runtime-owned live agent lifecycle、typed hook admission、conversation continuity、agent memory policy |
| `agent-conversation-anchor-contract.md` | `K-AGCORE-*` | Runtime-owned `ConversationAnchor` continuity truth for per-agent multi-surface chat/session sharing inside a multi-agent runtime |
| `agent-presentation-contract.md` | `K-AGCORE-*` | Runtime-owned persistent `AgentPresentationProfile` truth、default avatar binding、and non-owner boundary for renderer-local state |
| `agent-presentation-stream-contract.md` | `K-AGCORE-*` | Runtime-owned transient `turn` / `presentation` projection seam、current emotion projection、and stream commit semantics |
| `agent-hook-intent-contract.md` | `K-AGCORE-*` | Runtime-owned narrow-admit `HookIntent` truth、admission states、and event seam |
| `agent-output-wire-contract.md` | `K-AGCORE-*` | Agent chat model-facing APML output wire authority、APML-to-runtime projection boundary、and post-turn action / HookIntent split |
| `app-messaging-contract.md` | `K-APP-*` | 应用间消息、事件流 |
| `cli-onboarding-contract.md` | `K-CLI-*` | CLI 首次使用、provider-first cloud setup 与 author tooling 边界 |
| `config-contract.md` | `K-CFG-*` | 配置路径、优先级、secret policy、写入语义 |
| `connector-contract.md` | `K-CONN-*` | connector 托管、字段约束、补偿与并发安全 |
| `nimillm-contract.md` | `K-NIMI-*` | remote 执行边界、流式与审计对齐 |
| `model-catalog-contract.md` | `K-MCAT-*` | 模型/voice catalog SSOT、远程覆写与 fail-close 语义 |
| `multimodal-provider-contract.md` | `K-MMPROV-*` | canonical 输入、artifact、adapter 与路由约束（含 `MUSIC_GENERATE` iteration 扩展） |
| `delivery-gates-contract.md` | `K-GATE-*` | 交付门定义与证据路由 |
| `proto-governance-contract.md` | `K-PROTO-*` | proto 治理、兼容策略、发布门禁 |
| `ai-profile-execution-contract.md` | `K-AIEXEC-*` | AIProfile 执行、probe、snapshot、scheduling boundary |
| `scheduling-contract.md` | `K-SCHED-*` | 调度 five-state preflight judgement、atomic target / aggregate Peek、occupancy、denial |
| `world-evolution-engine-contract.md` | `K-WEV-*` | World Evolution Engine 的 Runtime-owned event semantics、replay/checkpoint/supervision/effect-stage/commit-request 合同，以及 workflow partial-reuse hardcut |

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
- `tables/voice-enums.yaml`
- `tables/tts-provider-capability-matrix.yaml`
- `tables/multimodal-canonical-fields.yaml`
- `tables/multimodal-artifact-fields.yaml`
- `tables/provider-extension-registry.yaml`
- `tables/runtime-memory-bank-scope.yaml`
- `tables/runtime-memory-hook-trigger.yaml`
- `tables/runtime-memory-replication-outcome.yaml`
- `tables/runtime-agent-service-typed-family.yaml`
- `tables/runtime-agent-event-projection.yaml`
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
- 执行态内容不得进入 `/.nimi/spec/**`；human-authored topic lifecycle reports 写入 `.nimi/topics/{proposal|ongoing|pending|closed}/<topic-id>/**`；legacy execution evidence may still appear under `.local/report/**` as local-only operational output；tracked spec 不依赖具体 local 文件。

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

本目录覆盖 Runtime proto 全量服务，包含 `workflow-contract.md` 与 `voice-contract.md` 在内的全部 kernel 合同。审计或实施可以按主题分批进行，但 chunk 边界不是规范边界，不得被写回 spec 作为排除项。

Phase 1 规则构成当前规范基线；Phase 2 kernel contracts 可先以 draft 形态并存，待语义收敛后再提升为规范基线。新增语义必须先入 kernel，再改 domain 与实现。

## 10. 跨层信息引用约定

Runtime kernel 合同中出现的 Desktop（`D-*`）或 SDK（`S-*`）Rule ID 默认用于记录消费方行为、集成上下文或跨层排障锚点。除非规则正文显式声明为共享 gate，此类引用均为信息性引用，不构成 Runtime 侧前置条件。

- Runtime 行为与合规性不得依赖 Desktop/SDK 规则先成立。
- Desktop/SDK 对自身规则合规性负责；Runtime 仅记录与其交互的消费方假设。
- 跨层引用应保持说明性文字，例如“Desktop 端（D-SEC-009）始终使用 managed connector 路径”，不得把下游 Rule ID 写成 Runtime required gate。
