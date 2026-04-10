# Conversation Capability Contract

> Authority: Desktop Kernel
>
> Umbrella: This contract is a submodel of `AIConfig` / `AISnapshot` as defined in `ai-profile-config-contract.md` (D-AIPC-010). The rules below remain normative but their owner semantics are subordinate to the three-tier AI configuration authority (D-AIPC-001).

## Scope

定义 AI / Agent Chat / Runtime Config 共用的 conversation capability selection、projection、agent overlay、execution snapshot 与 host bootstrap authority。

本契约中的四层 authority 在 `AIProfile / AIConfig / AISnapshot` 体系（D-AIPC-001）下作为 conversation-capability submodel 保留，不作为独立 peer authority 与三段式并列。具体映射见 D-AIPC-010。

Agent chat 的行为语义 owner 不在本文件。本契约只允许 capability surface 消费
`agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）产出的
`resolvedTurnMode`、`resolvedExperiencePolicy`、`resolvedBeatPlan`，以及
`agent-chat-beat-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）产出的 resolved
beat/action outputs。selection、projection、overlay、snapshot 或 bootstrap
builder 不得重定义 delayed beat、pending invalidation、modality action envelope、
model-generated modality prompt payload、或这些 behavior truths。

## D-LLM-015 — Authority Map And Bootstrap Home

Desktop 侧 conversation capability authority 固定拆分为四层：

- `ConversationCapabilitySelectionStore`：唯一可持久化的 selection truth
- `ConversationCapabilityProjection`：只读 app-facing projection
- `AgentEffectiveCapabilityResolution`：agent chat 的 capability overlay。`text.generate` 决定 send readiness；`image.generate` 仅作为可选 media capability truth 暴露，不得反向阻断基础发送。
- `ConversationExecutionSnapshot`：每次 turn/job 固化的执行证据

Desktop host bootstrap 是 conversation capability shared builder 的唯一 authority home：

- AI Chat、Agent Chat、Runtime Config 必须消费同一 builder 结果，不得各自重算 route truth。
- builder 允许输入固定为：
  - `SelectionStore.selectedBindings[capability]`
  - `runtime.route.resolve(...)`
  - `runtime.route.checkHealth(...)`
  - `runtime.route.describe(...)`
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

## D-LLM-018 — Agent Effective Capability Resolution

`AgentEffectiveCapabilityResolution` 依赖：

- `ConversationCapabilityProjection(capability='text.generate')`
- `ConversationCapabilityProjection(capability='image.generate')`

Agent chat 总是在 desktop 本地执行，不需要后端路由决策。
`data-api.core.agent.chat.route.resolve` 已移除（Realm v1 不拥有 agent chat 路由 authority）。

`reason` 固定为封闭枚举，且只表达 agent chat 的基础可发送性：

- `projection_unavailable`
- `route_unresolved`
- `ok`

优先级固定为：

1. `projection_unavailable`
2. `route_unresolved`
3. `ok`

`ready=true` 仅当：

- `text.generate` projection `supported=true`
- `resolvedBinding` 存在

同时满足时才允许成立。

`image.generate` 对 Agent chat 是可选 capability。

- `imageProjection` 可以为 `null`
- `imageReady` 必须仅由 `image.generate` projection 是否 `supported=true` 且 `resolvedBinding` 存在决定
- `imageReady=false` 不得改变 `reason`，也不得把已经可发送的 Agent chat 降级成 `ready=false`
- Agent chat settings / submit / provider 若消费图片能力，必须统一读取这一份 `imageProjection` / `imageReady` truth，不得自行从 `runtimeFields` 或 UI 局部状态重算一份 image route truth
- `explicit-media` 等 turn-mode 分类只来自
  `agent-chat-behavior-contract.md`（`D-LLM-024`）；capability overlay 不得把某个
  turn mode 升格为新的 route truth、image gate truth、或 video-generation admission
- `imageReady=true` 或未来 voice/video workflow projection healthy 只表达 execution
  readiness；resolved modality action 是否存在、其 relation 是什么、以及
  `promptPayload` 是什么，固定由 `agent-chat-beat-action-contract.md` 拥有，capability
  layer 不得从 healthy projection 反推 action existence
- `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v` projection healthy 同样只表达
  execution readiness；某个 richer workflow 是否被 admit、属于哪种 workflow type、
  使用什么 voice identity、以及 workflow result 如何回到当前 thread，固定由
  `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）拥有，capability
  layer 不得从 healthy projection 反推 workflow semantics
- `audio.synthesize` 或 `voice_workflow.*` projection healthy 同样只表达 execution
  readiness；某个 resolved `voice` action 是否进入 agent chat voice executor、是否形成
  playback-ready outcome，固定由 `agent-chat-voice-executor-contract.md`
  （`D-LLM-034` ~ `D-LLM-039`）拥有，capability layer 不得从 healthy projection 反推
  executor success truth
- `audio.transcribe`、`audio.synthesize`、或 `voice_workflow.*` projection healthy 也不表达
  broader voice session 已被 admit；explicit entry / exit、same-thread continuity、
  admitted listening modes、interruption、以及 transcript / caption rules 固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有，capability layer
  不得从 healthy projection 反推 session semantics

## D-LLM-019 — Conversation Execution Snapshot

`ConversationExecutionSnapshot` 只记录单次 turn/job 的执行证据，不得回写为全局 route truth。

- `executionId` 必须是 ULID
- snapshot 必须固化本次执行消费的 capability、selection evidence、resolved binding evidence 与 agent overlay evidence
- snapshot 可以引用 projection 结果，但不得替代 `SelectionStore` 或 `ConversationCapabilityProjection` 成为新的 owner
- snapshot 若携带 `resolvedTurnMode`、`resolvedExperiencePolicy`、
  `resolvedBeatPlan` 的 execution evidence，也只能作为对
  `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-025`）的只读引用或副本；
  snapshot 不得成为 behavior resolution 的平行 owner
- snapshot 若携带 delayed beat、pending beat invalidation、resolved modality
  action、或 `promptPayload` evidence，也只能作为对
  `agent-chat-beat-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）的只读引用或副本；
  snapshot 不得成为 beat/action resolution 的平行 owner
- snapshot 若携带 richer voice workflow admission、workflow type、voice identity /
  `VoiceReference`、preset/custom voice selection、或 workflow return-path evidence，
  也只能作为对 `agent-chat-voice-workflow-contract.md`
  （`D-LLM-047` ~ `D-LLM-052`）的只读引用或副本；snapshot 不得成为 richer voice
  workflow product semantics 的平行 owner
- snapshot 若携带 agent chat voice executor、playback-ready speech artifact、或 voice
  playback outcome evidence，也只能作为对
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）的只读引用或副本；
  snapshot 不得成为 voice executor product semantics 的平行 owner

thread-level `routeSnapshot` 不再是允许的规范 contract。

## D-LLM-020 — Voice Workflow Capability Semantics

`voice_workflow.tts_v2v` 与 `voice_workflow.tts_t2v` 在 Desktop projection 中必须与 `audio.synthesize` 保持独立 capability key、独立 selected binding、独立 resolved binding、独立 health、独立 describe metadata。

- `audio.synthesize` healthy 不得自动使 `voice_workflow.*` projection `supported=true`
- workflow capability 缺独立 binding/metadata/compatibility proof 时必须映射为 `binding_unresolved`、`route_unhealthy`、`metadata_missing` 或 `capability_unsupported`
- Runtime Config、AI/Agent setup、submit path 都必须消费同一 workflow projection，不得在某一消费点把 workflow 当作 `audio.synthesize` 的隐式附属面

## D-LLM-021 — RuntimeFields And Runtime Config Boundary

`runtimeFields` 的 route-related 字段在 Phase 1 退化为 execution projection / transient input，不再是 route owner。

- Runtime Config 的角色是 authority editor：只编辑 SelectionStore/default refs
- Runtime Config 不得持久化 resolved binding、health、metadata 或 projection reason
- AI / Agent submit path 只允许消费 `ConversationCapabilityProjection` 与 `ConversationExecutionSnapshot`；不得重新从可写 `runtimeFields` 拼装 capability truth
- AI / Agent submit path 若还需要 `resolvedTurnMode`、`resolvedExperiencePolicy`、
  `resolvedBeatPlan`，必须消费
  `agent-chat-behavior-contract.md` 定义的 behavior outputs；不得经由
  `runtimeFields` 再派生一份平行 behavior truth
- AI / Agent submit path 若还需要 delayed beat、pending invalidation、resolved
  modality action、或 model-generated modality prompt payload，必须消费
  `agent-chat-beat-action-contract.md` 定义的 resolved beat/action outputs；不得经由
  capability health、metadata、`runtimeFields`、或 connector/model 默认值派生一份
  平行 beat/action truth
- AI / Agent submit path 若还需要 richer voice workflow admission、workflow type、
  agent chat voice identity / `VoiceReference`、preset/custom voice selection、或
  workflow return-path 决策，必须消费
  `agent-chat-voice-workflow-contract.md` 定义的 outputs；不得经由 capability health、
  `runtimeFields`、voice list、voice asset inventory、或 connector/model 默认值派生
  一份平行 workflow truth
- AI / Agent submit path 若还需要 agent chat voice executor 决策、`audio.synthesize`
  首包 playback outcome、或 playback-ready speech artifact evidence，必须消费
  `agent-chat-voice-executor-contract.md` 定义的 outputs；不得经由 capability health、
  `runtimeFields`、voice list、或 connector/model 默认值派生一份平行 voice executor
  truth
- AI / Agent submit path 若还需要 broader voice session 决策、listening-mode
  session semantics、或 transcript/caption reveal boundary，必须消费
  `agent-chat-voice-session-contract.md` 定义的 outputs；不得经由 capability health、
  `runtimeFields`、capture state、或 UI local state 派生一份平行 session truth
