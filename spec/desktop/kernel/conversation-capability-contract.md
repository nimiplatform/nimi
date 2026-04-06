# Conversation Capability Contract

> Authority: Desktop Kernel

## Scope

定义 AI / Agent Chat / Runtime Config 共用的 conversation capability selection、projection、agent overlay、execution snapshot 与 host bootstrap authority。

## D-LLM-015 — Authority Map And Bootstrap Home

Desktop 侧 conversation capability authority 固定拆分为四层：

- `ConversationCapabilitySelectionStore`：唯一可持久化的 selection truth
- `ConversationCapabilityProjection`：只读 app-facing projection
- `AgentEffectiveCapabilityResolution`：`text.generate` projection 与 agent eligibility 的单一路径 overlay
- `ConversationExecutionSnapshot`：每次 turn/job 固化的执行证据

Desktop host bootstrap 是 conversation capability shared builder 的唯一 authority home：

- AI Chat、Agent Chat、Runtime Config 必须消费同一 builder 结果，不得各自重算 route truth。
- builder 允许输入固定为：
  - `SelectionStore.selectedBindings[capability]`
  - `SelectionStore.defaultRefs`
  - `runtime.route.resolve(...)`
  - `runtime.route.checkHealth(...)`
  - `runtime.route.describe(...)`
  - runtime local profile read model（仅 `defaultRefs.imageProfileRef` 被 capability 明确需要时）
- builder 不得读取或恢复以下真相：
  - thread `routeSnapshot`
  - provider / route kind / local-cloud heuristic
  - writable `runtimeFields` route key
  - connector 默认模型回填
  - page/thread metadata 中遗留 route truth

## D-LLM-016 — Selection Store Semantics

`ConversationCapabilitySelectionStore` 只允许持久化：

- `selectedBindings`
- `defaultRefs`

`defaultRefs` 在 Phase 1 只允许：

- `imageProfileRef?: RuntimeLocalProfileRef | null`

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
- `profile_ref_missing`
- `host_denied`

producer -> projection 映射规则固定为：

- `selectedBindings` 缺 key 且最终无法形成规范允许的 resolved route -> `selection_missing`
- `selectedBindings[capability] === null` -> `selection_cleared`
- selected binding schema 非法、capability 不匹配、binding 已失效、或 `runtime.route.resolve(...)` 失败/空结果 -> `binding_unresolved`
- `runtime.route.checkHealth(...)` 声明 unavailable / unhealthy -> `route_unhealthy`
- `runtime.route.describe(...)` 缺失 typed metadata、或 typed metadata discriminator/枚举/字段类型非法 -> `metadata_missing`
- runtime truth 明确声明该 canonical capability 当前不被支持 -> `capability_unsupported`
- `defaultRefs.imageProfileRef` 被 capability 明确需要但缺失、越界、或无法解析 -> `profile_ref_missing`
- host-owned capability gate 明确拒绝 app-facing 成功路径 -> `host_denied`

优先级固定为：

1. `host_denied`
2. `profile_ref_missing`
3. `selection_cleared`
4. `selection_missing`
5. `capability_unsupported`
6. `binding_unresolved`
7. `route_unhealthy`
8. `metadata_missing`

`ConversationCapabilityProjection.reasonCode` 不得暴露 producer 原始字符串；上游 reason code 只能先映射到上述封闭枚举，再进入 stable surface。

`supported=true` 的前置条件固定为：

- selection 语义已解析完成
- `resolvedBinding` 可用
- `health` 未声明 unavailable / unhealthy
- `metadata` 已按 `K-RPC-017` 提供所需 typed result

任一条件不满足时必须 fail-close 为 `supported=false`；不得静默生成 sendable route。

## D-LLM-018 — Agent Effective Capability Resolution

`AgentEffectiveCapabilityResolution` 只能由：

- `ConversationCapabilityProjection(capability='text.generate')`
- `data-api.core.agent.chat.route.resolve`

共同生成。

字段 `channel`、`sessionClass`、`providerSelectable`、`eligibility` 只能来自 host capability 返回值；Desktop 不得根据 provider、route kind、mode、local/cloud 或 `HUMAN_DIRECT` 假设自行合成。

`reason` 固定为封闭枚举：

- `projection_unavailable`
- `eligibility_denied`
- `route_unresolved`
- `ok`

优先级固定为：

1. `projection_unavailable`
2. `eligibility_denied`
3. `route_unresolved`
4. `ok`

`ready=true` 仅当：

- `text.generate` projection `supported=true`
- host eligibility payload 合法且未拒绝
- route-required host fields 完整

同时满足时才允许成立。

## D-LLM-019 — Conversation Execution Snapshot

`ConversationExecutionSnapshot` 只记录单次 turn/job 的执行证据，不得回写为全局 route truth。

- `executionId` 必须是 ULID
- snapshot 必须固化本次执行消费的 capability、selection evidence、resolved binding evidence 与 agent overlay evidence
- snapshot 可以引用 projection 结果，但不得替代 `SelectionStore` 或 `ConversationCapabilityProjection` 成为新的 owner

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
