# Conversation Capability Contract

> Authority: Desktop Kernel
>
> Umbrella: This contract is a submodel of `AIConfig` / `AISnapshot` as defined in `ai-profile-config-contract.md` (D-AIPC-010). The rules below remain normative but their owner semantics are subordinate to the three-tier AI configuration authority (D-AIPC-001).

## Scope

定义 AI / Agent Chat / Runtime Config 共用的 conversation capability selection、projection、agent overlay、execution snapshot 与 host bootstrap authority。

本契约中的四层 authority 在 `AIProfile / AIConfig / AISnapshot` 体系（D-AIPC-001）下作为 conversation-capability submodel 保留，不作为独立 peer authority 与三段式并列。具体映射见 D-AIPC-010。

Agent Chat orchestration、turn planning、message/action semantics、voice workflow、
media execution、prompt/context assembly、and execution evidence are Runtime-owned.
This contract only exposes capability selection / projection needed by Desktop
presentation surfaces. Selection, projection, overlay, snapshot, or bootstrap
builder must not redefine Agent Chat execution truth, message/action truth,
voice workflow truth, Runtime Agent turn truth, or Runtime-owned conversation
anchor truth.

## D-LLM-015 — Authority Map And Bootstrap Home

Desktop 侧 conversation capability authority 固定拆分为四层：

- `ConversationCapabilitySelectionStore`：唯一可持久化的 selection truth
- `ConversationCapabilityProjection`：只读 app-facing projection
- Agent Chat capability truth：已从本 overlay 切出（见 D-LLM-018 carve-out）。Agent Chat 的 binding/readiness truth 是 Runtime Agent AI Config（K-AGCORE-144~150）；`text.generate` readiness 决定 send readiness，`image.generate` readiness 仅作为可选 media capability truth 暴露，不得反向阻断基础发送。
- `ConversationExecutionSnapshot`：每次 turn/job 固化的执行证据

Desktop host bootstrap 是 conversation capability shared builder 的唯一 authority home：

- AI Chat、Agent Chat、Runtime Config 必须消费同一 builder 结果，不得各自重算 route truth。
- Desktop runtime bootstrap 在 runtime SDK client materialize 后必须注册唯一的
  `ConversationCapabilityRouteRuntime` 到 shared builder；bootstrap teardown /
  rebootstrap 前必须清空该注册。生产路径不得只在测试或局部 consumer 中注入
  resolver，否则已有 `selectedBindings` 会被误投影为 `binding_unresolved`。
- builder 允许输入固定为：
  - `SelectionStore.selectedBindings[capability]`
  - `runtime.route.listOptions(...)` 产生的 capability-scoped option truth（仅用于
    将持久化 binding hydrate 成当前 runtime-owned local/cloud route identity；
    不得作为 metadata 或 health truth）
  - `runtime.route.resolve(...)`
  - `runtime.route.checkHealth(...)`
  - `runtime.route.describe(...)`
- Desktop builder 必须通过 SDK route facade 消费上述 logical operation；不得在
  Desktop renderer/host 内实现 model-root normalization、local engine inference、
  warm candidate selection、resolved binding assembly、或 source/model resolution
  作为 execution route truth。
- Desktop host 的 Phase 1 `runtime.route.describe(...)` facade 只能消费 Runtime
  route describe logical operation 的 typed result。若 transport 通过
  scenario route-describe probe 与 `x-nimi-route-describe-result` response metadata
  承载结果，Desktop 只能解码并校验 typed result；不得根据 provider、model
  label、local/cloud、endpoint 或 UI state 伪造 `supportsThinking` / multimodal /
  workflow metadata。
- builder 不得读取或恢复以下真相：
  - thread `routeSnapshot`
  - provider / route kind / local-cloud heuristic
  - writable `runtimeFields` route key
  - connector 默认模型回填
  - page/thread metadata 中遗留 route truth

capability builder / projection 只证明 route 是否可解析且可执行；不得因为 image、
voice、video capability healthy 或 metadata 完整，就推断某个 modality action 已被
admit，或反向补造 delayed beat / prompt payload truth。

## D-LLM-016 — Selection Store Semantics

`ConversationCapabilitySelectionStore` 只允许持久化：

- `selectedBindings`

`selectedBindings` 的 capability key 语义固定为：

- key 缺失：表示该 capability 没有显式用户选择；projection 不得假定存在 sendable route
- `value = null`：表示该 capability 被显式清空/禁用；builder 不得回退到 default ref、provider 默认模型或 `audio.synthesize` 兼容路径
- `value` 为对象：必须是与 capability 匹配的 typed binding reference；schema 非法、capability 不匹配、或引用已失效时必须 fail-close

store codec / migration 不得把 key 缺失与 `null` 互相折叠；presence bit 必须可恢复。

本规则未允许的字段不得进入 SelectionStore；Desktop 不得持久化 resolved binding、health、metadata、reasoning support、multimodal support 或 passive asset path truth。

## D-LLM-016a — Memory Embedding Config Non-Owner Boundary

`ConversationCapabilitySelectionStore`、`ConversationCapabilityProjection`、
以及 `ConversationExecutionSnapshot`
不得吸收 memory embedding live config 或 runtime memory bank truth。

固定边界：

- editable memory embedding config 不属于 `selectedBindings`
- memory embedding source 的 user intent 不得被编码成普通 conversation
  capability selection truth
- resolved memory embedding state、bank bind result、bank migration / rebuild /
  cutover state 也不属于 conversation capability projection truth
- `text.embed` 或其他 embedding-related route truth 若被 runtime memory path
  消费，也不使 Desktop conversation capability submodel 自动成为 memory
  embedding config owner

## D-LLM-017 — Conversation Capability Projection

`ConversationCapabilityProjection` 是 shared builder 的唯一 app-facing read model，最小字段固定为：

- `capability`
- `selectedBinding`
- `resolvedBinding`
- `health`
- `metadata`
- `supported: boolean`
- `reasonCode: ConversationCapabilityReasonCode | null`

`ConversationCapabilityReasonCode` 固定为封闭枚举：

- `selection_missing`
- `selection_cleared`
- `binding_unresolved`
- `route_unhealthy`
- `metadata_missing`
- `capability_unsupported`
- `host_denied`

producer -> projection 映射规则固定为：

- `selectedBindings` 缺 key 且最终无法形成规范允许的 resolved route -> `selection_missing`
- `selectedBindings[capability] === null` -> `selection_cleared`
- selected binding schema 非法、capability 不匹配、binding 已失效、或 `runtime.route.resolve(...)` 失败/空结果 -> `binding_unresolved`
- `runtime.route.checkHealth(...)` 声明 unavailable / unhealthy -> `route_unhealthy`
- `runtime.route.describe(...)` 缺失 typed metadata、或 typed metadata discriminator/枚举/字段类型非法 -> `metadata_missing`
- runtime truth 明确声明该 canonical capability 当前不被支持 -> `capability_unsupported`
- host-owned capability gate 明确拒绝 app-facing 成功路径 -> `host_denied`

优先级固定为：

1. `host_denied`
2. `selection_cleared`
3. `selection_missing`
4. `capability_unsupported`
5. `binding_unresolved`
6. `route_unhealthy`
7. `metadata_missing`

`ConversationCapabilityProjection.reasonCode` 不得暴露 producer 原始字符串；上游 reason code 只能先映射到上述封闭枚举，再进入 stable surface。

`supported=true` 的前置条件固定为：

- selection 语义已解析完成
- `resolvedBinding` 可用
- `health` 未声明 unavailable / unhealthy
- `metadata` 已按 `K-RPC-017` 提供所需 typed result

任一条件不满足时必须 fail-close 为 `supported=false`；不得静默生成 sendable route。

## D-LLM-018 — Agent Chat Capability Truth Carve-Out

Agent Chat capability truth is carved out of the Desktop conversation
capability overlay. The committed binding and readiness truth for Agent Chat
is Runtime Agent AI Config and its readiness projection
(`K-AGCORE-144`~`K-AGCORE-150`), consumed through the admitted
RuntimeAgentService / SDK ai-config surface.

固定规则：

- Desktop Agent Chat 的可发送性与图片能力状态只允许消费 Runtime Agent AI Config
  readiness projection（`ready` / `not_configured` / `unavailable` 与
  typed reason codes）；`ConversationCapabilitySelectionStore`、
  `ConversationCapabilityProjection`、`runtimeFields`、UI 局部状态都不再是
  Agent Chat 的 binding/readiness truth 来源。
- Desktop 的模型配置界面在 Agent Chat 语境下是 Runtime Agent AI Config 的
  编辑器：写入必须经 admitted ai-config mutation surface（含
  revision 乐观并发），不得持久化平行的 agent chat route truth。
- Agent Chat turn 提交不携带 execution binding payload（K-AGCORE-147）。
- readiness `ready` 只表示 Runtime 报告可用 capability route。Desktop 不得
  据此推断 Agent Chat action 存在、prompt payload 合法、workflow 已 admit、
  或 voice playback/session 语义成功。
- Agent Chat message/action/workflow/session 决策必须以 Runtime-owned Agent
  Chat projection/output evidence 到达；Desktop 投影不得制造这些决策。
- `data-api.core.agent.chat.route.resolve` 已移除（Realm v1 不拥有 agent
  chat 路由 authority）。
- 本契约其余规则（D-LLM-015~017、D-LLM-019~021）继续管辖非 Agent Chat 的
  通用 app AI 消费（AI Chat、Runtime Config 的普通 capability 面）。

`AgentEffectiveCapabilityResolution` 作为 Desktop-owned agent chat capability
overlay 已退役；其历史语义由本 carve-out 取代。

## D-LLM-019 — Conversation Execution Snapshot

`ConversationExecutionSnapshot` 只记录单次 turn/job 的执行证据，不得回写为全局 route truth。

- `executionId` 必须是 ULID
- snapshot 必须固化本次执行消费的 capability、selection evidence、resolved binding evidence 与 agent overlay evidence
- snapshot 可以引用 projection 结果，但不得替代 `SelectionStore` 或 `ConversationCapabilityProjection` 成为新的 owner
- snapshot 若携带 Runtime Agent Chat turn、message/action、workflow、voice、
  presentation, or failure evidence, those slices remain Runtime-owned
  projection evidence. Desktop must not create or reinterpret them as local
  execution truth.
- snapshot 若携带 deferred continuation / `HookIntent` proposal、admission、或 outcome
  evidence，也只能作为对 `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`
  的只读引用或副本；snapshot 不得成为 deferred continuation product semantics 的平行 owner

thread-level `routeSnapshot` 不再是允许的规范 contract。

## D-LLM-020 — Voice Workflow Capability Semantics

`voice_workflow.voice_clone` 与 `voice_workflow.voice_design` intent 归属 Runtime Agent AI Config；Runtime voice owns workflow execution/artifact projection。Desktop projection 只能消费 Runtime/SDK readiness 与结果，不得生成 voice 或独立决定 workflow model/provider。

- `audio.synthesize` healthy 不得自动使 `voice_workflow.*` projection `supported=true`
- workflow capability 缺独立 binding/metadata/compatibility proof 时必须映射为 `binding_unresolved`、`route_unhealthy`、`metadata_missing` 或 `capability_unsupported`
- Runtime Config、AI/Agent setup、submit path 都必须消费同一 Runtime Agent AI Config / Runtime voice workflow projection，不得在某一消费点把 workflow 当作 `audio.synthesize` 的隐式附属面

## D-LLM-021 — RuntimeFields And Runtime Config Boundary

`runtimeFields` 的 route-related 字段在 Phase 1 退化为 execution projection / transient input，不再是 route owner。

- Runtime Config 的角色是 authority editor：只编辑 SelectionStore/default refs
- Runtime Config 不得持久化 resolved binding、health、metadata 或 projection reason
- Runtime Config 不得承载 Desktop-host-owned Runtime Local Agent memory embedding truth；Agent Center 的 embedding intent must go through Runtime Agent AI Config, while resolved profile、bind success、bank identity、migration readiness、cutover completion remain Runtime memory / RuntimeCognitionService projections.
- Runtime Config 对 runtime memory resolved state、bank availability、bind / rebuild / cutover readiness 的读取只消费 admitted typed host/runtime boundary；renderer-local form state、private loopback HTTP、本地资产启发式或 `canonical-bind` 类 convenience endpoint 不构成正式产品 contract。
- AI / Agent submit path 只允许消费 `ConversationCapabilityProjection` 与 `ConversationExecutionSnapshot`；不得重新从可写 `runtimeFields` 拼装 capability truth
- AI / Agent submit path must submit typed user intent through admitted SDK /
  Runtime Agent surfaces and then consume Runtime-owned turn / message /
  action / presentation projections. It must not derive behavior, action, or
  prompt truth from `runtimeFields`.
- AI / Agent submit path 若还需要 deferred continuation / `HookIntent` proposal、
  admission、或 outcome 决策，必须消费
  `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md` 定义的 runtime-owned outputs；
  不得经由 capability health、`runtimeFields`、scheduler queues、或 UI local state
  派生一份平行 deferred continuation truth
- AI / Agent submit path must not use capability health, metadata,
  `runtimeFields`, voice lists, voice assets, capture state, or UI local state
  to derive Agent Chat workflow, voice executor, broader voice session, or
  transcript/caption semantics. Those are Runtime-owned projection/output truth
  for Desktop.

## D-LLM-022 Agent Center Runtime Agent AI Config Consumer Boundary

Agent Center product UI for Agent Chat belongs to Kit Agent Center after
`kit.features.agent-center` admission. Desktop may place the Kit surface and
provide typed host adapters, but the model/readiness editor inside Agent Center
must read and mutate Runtime Agent AI Config with `expected_revision`.
Desktop generic AIConfig settings remain outside Agent Center.

Desktop diagnostics for Agent Chat may display route/model/provider identity
only when Runtime projects it as accepted turn/config projection; otherwise the
diagnostic field is absent. Desktop AIConfig, conversation capability bindings,
route cache, `runtimeFields`, and `AISnapshot` are not Agent Chat AI consume
truth.

Agent Chat `audio.synthesize` and `voice_workflow.*` intent are Runtime Agent
AI Config-owned. Desktop conversation capability `audio.synthesize` or voice
workflow capability state must not be reinterpreted as Runtime Agent audio
binding truth, generation policy, or workflow ownership.
