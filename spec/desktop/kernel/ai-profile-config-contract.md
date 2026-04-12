# AI Profile / Config / Snapshot Contract

> Authority: Desktop Kernel

## Scope

定义 `AIProfile`、`AIConfig`、`AISnapshot` 三段式 AI 配置 canonical model，以及它们与现有 `D-LLM-015 ~ D-LLM-021` conversation capability authority 的 umbrella 关系。

本契约是 Desktop 侧 AI 配置的最终态 canonical owner。

在 desktop surface 中，Desktop host 既是 app scope 也是 mod scope 的 `AIConfig` / `AISnapshot` host-local persistence owner；mod business code 只能通过 formal host bridge 消费本 authority，不能自持久化平行真相。

Agent chat behavior semantics 不由本契约拥有。`AIProfile` / `AIConfig` /
`AISnapshot` 只拥有 AI configuration authority；single-message、turn-mode、
experience-policy / settings semantics 继续由
`agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）拥有。

## D-AIPC-001 — Three-Tier AI Configuration Authority

Desktop AI 配置 authority 固定为三段式：

1. **`AIProfile`** — 标准配置包 / 预设 / 模板。可下载、导入导出、推荐、probe、模块测试。不直接作为运行时长期真相。
2. **`AIConfig`** — 某个 scope 当前实际生效的 AI 配置。绑定到 `AIScopeRef`（P-AISC-001）。是运行时长期真相。
3. **`AISnapshot`** — 每次 turn / job 启动时固化的执行快照。是执行期真相。

三者不可互为 fallback：
- `AIProfile` 不能被当作 live config 消费。
- `AIConfig` 不能在执行期间被实时回读替代 snapshot。
- `AISnapshot` 不能回写为 config 或 profile。

## D-AIPC-002 — AIProfile Semantics

`AIProfile` 是 portable 标准配置包，最小语义包含：

- capability route intent / binding intent（per canonical capability）
- generation params（per capability）
- companion model intent
- policy / style metadata
- profile-level UX metadata（`title`、`description`、`tags`）

`AIProfile` 不包含：

- 具体 `AIScopeRef` 绑定（profile 是 scope-agnostic 模板）
- runtime-local install state / machine-specific asset residency
- concrete install result / dependency resolution result
- device-specific feasibility state / host-specific engine binary path
- live health / availability state

与 `ModRuntimeLocalProfile` / `LocalAiProfileDescriptor` 的关系：

- runtime local profile 是 runtime-facing、installable 的 local dependency / execution package。
- 一个 `AIProfile` 可引用、组合或派生出一个或多个 runtime local profile。
- `AIProfile` 与 `ModRuntimeLocalProfile` 不假定一一对应。
- portable profile payload 与 machine-local install state 之间的边界由 D-AIPC-007 定义。

## D-AIPC-003 — AIConfig Semantics

`AIConfig` 是某个 scope 当前实际生效的 AI 配置：

- 必须绑定到 canonical `AIScopeRef`（P-AISC-001）。
- scope 不限于 app；可为 app / mod / module / feature。
- `AIConfig` 必须是 full materialized config — 不允许 partial overlay 或 scope 间 fallback chain（P-AISC-003）。
- `AIConfig` 可与 `AIProfile` 共享 schema subset；区别在于 owner 语义（bound vs template），不在字段形状。
- 在 Desktop host 中，`AIConfig` 的 canonical persistence / subscription / scope-keyed read-write owner 必须是 shared Desktop host AIConfig service，而不是某个单独 consumer 私有的 chat-local 或 mod-local storage helper。
- mod business code 只能通过 Desktop host bridge 编辑或读取其 scope 的 `AIConfig`；不得自定义并持久化另一份 mod-local live AI truth。

`AIConfig` 内部结构固定包含：

- `scopeRef: AIScopeRef` — 所属 scope identity
- `capabilities` — per-capability configuration（对齐 D-LLM-016 selection store schema，详见 D-AIPC-010）
- `profileOrigin?: AIProfileRef | null` — 最近一次 apply 的 profile 来源（仅用于 UX 溯源展示，不构成 live reference）

`AIConfig` 不得把 agent chat 的 `AgentChatExperienceSettings`、
`ResolvedExperiencePolicy`、`resolvedTurnMode`、以及 resolved message/action outputs 收编为新的
top-level live config truth。若 chat consumer 需要这些 behavior semantics，必须回到
`agent-chat-behavior-contract.md` 定义的 authority surface。

用户在 scope 内微调时，改的是该 scope 的 `AIConfig`。修改不反向污染 `AIProfile`。修改后 `profileOrigin` 可保留（表示"基于哪个 profile 的自定义"）但不具有 binding 语义。

## D-AIPC-004 — AISnapshot Semantics

`AISnapshot` 是每次 turn / job 启动时固化的执行证据：

- `executionId: ULID` — 执行标识
- `scopeRef: AIScopeRef` — 来源 scope
- `configEvidence` — 固化时的 `AIConfig` 快照或其 hash
- `conversationCapabilitySlice` — conversation capability execution evidence（收编自 D-LLM-019 `ConversationExecutionSnapshot`）
- `runtimeEvidence` — 执行时 runtime evidence（nullable），包含：
  - `schedulingJudgement` — scheduling preflight judgement（K-SCHED-001 `SchedulingJudgement`，nullable）。如果 submit path 在 `Acquire` 前执行了 target-scoped `Peek`（K-SCHED-002），其 submit-specific execution target judgement 记录在此。scope aggregate judgement 不得写入这里。
  - 未来可扩展：resolved capability evidence、device profile summary 等。
- `createdAt: ISO8601` — 固化时间

`AISnapshot` 是 execution evidence，不是 recovery path：
- 不用于 fallback 恢复
- 不回写为 config 或 selection store
- 运行中 turn / job 只读自己的 snapshot，不回读 live `AIConfig`
- `runtimeEvidence` 为 null 表示 submit path 未执行 scheduling preflight（如 cloud route 不经过 local scheduler），不是错误
- 若 submit path 只有 scope aggregate feasibility 结果而没有 target-scoped scheduling judgement，则 `runtimeEvidence.schedulingJudgement` 必须保持为 null，不允许用 scope aggregate 充当 execution evidence
- 在 Desktop host 中，`AISnapshot` 的 schema、record 与 read owner 同样归 Desktop host；mod business code 不得自定义 consumer-local `AISnapshot` schema 或把 mod-local storage 当成正式 snapshot owner。
- mod-facing execution path 必须通过 mod host bridge 接入 formal `AIConfig` / `AISnapshot` authority；bridge 负责把 mod consumer 的 execution 绑定到 canonical `scopeRef`，而不是由 mod business code 私自决定 snapshot owner 语义。
- snapshot 若记录 agent chat behavior evidence，也只能记录来自
  `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-025`）的 resolved outputs；
  `AISnapshot` 不得在 capture 时重新解析、覆写、或补默认 behavior truth

## D-AIPC-005 — Profile Apply Semantics

用户在某个 scope 中选择 `AIProfile` 时，系统语义固定为：

- 用该 profile 内容**原子覆盖**当前 scope 的 `AIConfig`。
- 不建立对 profile 的长期共享引用。
- apply 不是 merge / partial patch；是 full materialization overwrite。

Apply 原子性规则：
- 要么整个 `AIConfig` materialization 成功，要么保持原 config 不变。
- 不允许 field-level partial commit。
- 并发 apply 需要 scope-level version / CAS 保护。

Apply probe / failure 规则：
- schema invalid → apply 失败，config 不变。
- runtime unavailable / dependency missing → 允许写入 syntactically valid config，但 UI 必须通过 projection / probe 明确标注不可执行（D-LLM-017 reason code 机制）。
- 不允许在 apply 时删除失败 capability 字段形成 pseudo-success。

## D-AIPC-006 — No Global Active Profile

- 不定义 `global active profile`。
- global 层只保留 profile catalog。
- 不允许把所有 scope 的 live config 收口成一个全局单值。
- 每个 scope 独立持有 `AIConfig`，不存在跨 scope 联动 live config 的机制。
- 若某个 consumer 需要“当前正在编辑的 scope”便利状态，该 active-scope orchestration 只能是 consumer-local helper，不能扩展为跨 chat / mod host 的全局 singleton。
- mod-facing surface 调用应优先显式传入 `scopeRef`；不得继承 desktop chat 的 active scope 单值作为默认行为。

## D-AIPC-007 — Portable Profile Boundary

`AIProfile` portable payload 与 runtime-local state 的边界固定为：

**Portable fields**（可下载、分享、导入导出）：

- capability route intent / binding intent
- generation params
- companion model intent
- policy / style metadata
- profile-level UX metadata（`title` / `description` / `tags`）

**Non-portable fields**（不进入 portable profile payload）：

- local file path
- machine-specific asset residency state
- concrete install result
- device-specific feasibility state
- host-specific engine binary / dependency resolution result
- live health / probe result

portable payload 的目标是：任何 profile 可在不同设备间迁移，接收端通过 runtime probe 独立判断可执行性。

## D-AIPC-008 — imageProfileRef Retirement

`imageProfileRef` 不再作为顶层产品概念独立存在：

- `ConversationCapabilitySelectionStore.defaultRefs.imageProfileRef` 在 `AIConfig` 体系下收编为 `AIConfig.capabilities` 中 image-related capability 的 binding intent。
- image 相关的 runtime local profile 需求下沉为 `AIConfig` 内部 capability configuration 的一部分，或 runtime execution dependency。
- Desktop 用户不再面对"AI profile + 单独 image profile ref"双心智。

迁移规则：
- 现有 `imageProfileRef` 值迁移到 `AIConfig.capabilities['image.generate'].localProfileRef` 或等义字段。
- 迁移后 `defaultRefs.imageProfileRef` 从 selection store 中移除。
- 此为 hard cut，不保留兼容层。

## D-AIPC-009 — Snapshot Boundary

- 不做 session 级永久绑定。
- 只在每次 turn / job 启动时生成 `AISnapshot`。
- live `AIConfig` 的后续修改：
  - 影响后续新 turn / 新 job。
  - 不影响已启动 execution 的 snapshot。
- 长任务、流式任务、本地模型任务的配置稳定性由 snapshot 固化保证。

## D-AIPC-010 — Umbrella Authority Over Conversation Capability Model

`AIProfile / AIConfig / AISnapshot` 是 conversation capability 四层 authority（D-LLM-015 ~ D-LLM-021）的 umbrella authority：

- 现有四层不被 supersede 或重命名；它们作为 `AIConfig` / `AISnapshot` 下的 conversation-capability submodel 保留。
- 不允许"旧四层 + 新三层"并列 owner — 四层是 AIConfig/AISnapshot 的 submodel，不是独立 peer authority。
- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）不属于本 umbrella
  收编对象；behavior contract 与本契约是相邻 authority，边界固定为
  config/capability truth vs behavior truth

迁移映射固定为：

| Existing rule | Current owner | Target mapping |
| --- | --- | --- |
| D-LLM-015 Authority Map And Bootstrap Home | capability 四层 authority | 保留 shared builder 约束，将其降为 `AIConfig` 下的 conversation-capability submodel |
| D-LLM-016 Selection Store Semantics | `ConversationCapabilitySelectionStore` | 迁移为 `AIConfig.capabilities` 的 selection 子结构；store schema 保持兼容但 owner 语义归属 `AIConfig` |
| D-LLM-017 Conversation Capability Projection | derived read model | 保留为 `AIConfig` 的派生 projection 层；projection 语义不丢失 |
| D-LLM-018 Agent Effective Capability Resolution | `text.generate` overlay | 保留为 projection 上的 agent overlay；语义不丢失 |
| D-LLM-019 Conversation Execution Snapshot | execution evidence | 收编为 `AISnapshot.conversationCapabilitySlice`；field-level 对齐 |
| D-LLM-020 Voice Workflow Capability Semantics | capability-specific invariant | 原样保留，作为 `AIConfig.capabilities` 下的 voice workflow 专门规则 |
| D-LLM-021 RuntimeFields And Runtime Config Boundary | runtimeFields boundary | 原样保留，防止 `AIConfig` 退化成 `runtimeFields` 替身 |

## D-AIPC-011 — Mutation Rules

### Profile catalog edit

- 编辑 `AIProfile` 本体只影响未来再次 apply 的行为。
- 不自动回写已存在的 `AIConfig`。

### Local customization

- 用户在 scope 内调整模型、companion、params 只改该 scope 的 `AIConfig`。
- 不反向污染 `AIProfile`。
- 自定义修改后 `AIConfig` 仍保持 full materialized，不退回 profile 引用模式。

### Host ownership and bridge

- Desktop host 必须对所有 desktop-resident scope（包括 `kind: 'mod'` scope）提供统一的 AIConfig authority bridge。
- chat、settings、future mod workspace 等 consumer 都只能作为 shared Desktop host AIConfig service 的 consumer，不得各自持有独立 persistence owner。
- mod host bridge 负责把 mod manifest identity 映射到 canonical mod `AIScopeRef`，并把 mod consumer 接到 formal `AIConfig` / `AISnapshot` surface；mod business code 不得直接操作 host persistence。

## D-AIPC-012 — Runtime Probe Taxonomy

profile 与 config 的 probe 分为三类：

1. **Static schema probe** — 检查 profile / config 的 schema 合法性，无需 runtime 在线。
2. **Runtime availability probe** — 检查所需 runtime 路由 / provider / engine 是否在线可用，需要 `runtime.route.checkHealth`。
3. **Resource feasibility probe** — 检查设备资源是否足以执行（VRAM、disk、concurrent slot）。Desktop 在这里固定区分两个 evaluation unit：
   - **scope aggregate**：`probeFeasibility(scopeRef)` 消费 runtime `Peek`（K-SCHED-002）的 aggregate judgement，对当前 scope 中所有 relevant local scheduling targets 做聚合，并在 `AIConfigProbeResult.schedulingJudgement` 中传递该 aggregate scheduling state（K-SCHED-001）。
   - **submit target**：submit guard / execution snapshot capture 必须消费当前 submit target 的 scheduling evaluation；它不是 `probeFeasibility(scopeRef)` 的同义重用。

当 runtime `Peek` 不可用时，`schedulingJudgement` 为 null，`status` 回退为 `degraded`。

约束：

- `probeFeasibility(scopeRef)` 是 scope aggregate surface，不是 submit-time authoritative execution truth。
- Desktop 必须区分 scope aggregate 与 submit-target scheduling evaluation；不允许继续用单个 primary local profile 同时代表这两种语义。
- aggregate `unknown` 不得在 UI 或 submit 逻辑中被伪装成 `runnable`。
- 上述 probe taxonomy 同时适用于 app scope 与 mod scope；mod consumer 不得绕过 formal AIConfig surface，直接把 raw runtime route / scheduler low-level API 升格为 product-facing probe owner。

UI 必须根据 probe 类别展示对应级别的状态信息。不允许将不同类别的 probe failure 混为同一个 generic "unavailable" 标签。当 `schedulingJudgement` 可用时，UI 应展示 scheduling state 的具体含义（queue、slowdown、denied），而不是仅展示 aggregate `status`。

## Fact Sources

- `agent-chat-behavior-contract.md` — D-LLM-022 ~ D-LLM-026 behavior authority boundary
- `conversation-capability-contract.md` — D-LLM-015 ~ D-LLM-021 conversation capability submodel rules
- `llm-adapter-contract.md` — D-LLM-001 ~ D-LLM-014 provider adaptation and routing rules
- `spec/platform/kernel/ai-scope-contract.md` — P-AISC-001 ~ P-AISC-005 AIScopeRef identity contract
- `spec/runtime/kernel/scheduling-contract.md` — K-SCHED-001 ~ K-SCHED-007 scheduling judgement contract
