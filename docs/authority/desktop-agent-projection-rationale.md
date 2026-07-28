> 本文为 rationale/历史散文，非规范权威；规范 = `.nimi/spec/desktop/agent-projection.authority.yaml`。下文保留的 `Contract`、`Authority`、`MUST` 和旧 Rule ID 标题均为历史标签，不能覆盖或扩展 canonical authority。

# Desktop Agent Projection Rationale

## Preserved source: Agent Chat Projection Contract

# Agent Chat Projection Contract

> Historical owner label: Desktop Kernel

## Scope

Desktop Agent Chat is now a presentation and interaction projection surface only.

Runtime owns Agent Chat orchestration, prompt/context assembly, turn planning,
model-facing output validation, Runtime Agent execution, voice workflow
execution, media execution, memory policy, runtime-owned conversation anchors,
and execution evidence.

Desktop owns only:

- shell placement and visible UI affordances for Agent Chat
- user input capture and explicit user actions before they are submitted to the
  admitted SDK / Runtime Agent surface
- rendering of Runtime / SDK Agent Chat projections, events, candidates,
  presentation timelines, and failure states
- renderer-local ephemeral UI state such as focus, scroll, transient composer
  text, popovers, pending attachments, and visible panel state
- Avatar / Live2D / VRM presentation handoff as defined by the avatar units in
  `.nimi/spec/desktop/agent-projection.authority.yaml`, without owning
  Agent Chat execution truth

Desktop must not own:

- Agent Chat orchestration or local conversation provider execution
- prompt assembly, context packing, continuity digest injection, or turn plan
  resolution
- model-facing APML / message-action / JSON output wire truth
- resolved assistant message/action existence truth
- direct `runtime.ai.executeScenario`, Runtime media output generation, or
  Runtime voice workflow execution paths from Desktop Agent Chat
- voice executor, richer voice workflow, voice session, transcript/caption
  product semantics, or voice identity truth
- `AISnapshot` execution truth or capability materialization truth
- canonical agent identity, memory, autonomy, lifecycle, transcript/history, or
  conversation-anchor truth

## D-LLM-022 — Desktop Agent Chat Projection Authority

Desktop Agent Chat's canonical Desktop owner is
`.nimi/spec/desktop/agent-projection.authority.yaml`; this section only explains
that owner boundary.

Fixed rules:

- Desktop must submit Agent Chat user intent through admitted SDK / Runtime
  Agent APIs.
- Desktop must consume Runtime-owned `runtime.agent.*`,
  `runtime.agent.turn.*`, `runtime.agent.presentation.*`, and related SDK
  projections as read/projection truth.
- Desktop may render local fallback UI for unavailable Runtime projections, but
  those states must remain explicit failure / unavailable states.
- Desktop must not synthesize successful assistant turns, actions, voice
  playback, workflow completion, or memory writes when Runtime has not produced
  the corresponding projection.
- Desktop may render the closed read-only `AgentTurnContextSummary`: typed
  ready/state/reason, versions and hashes, safe refs/hashes, lane ids/status and
  counts, budget/truncation, transcript/memory/media/tool counts, and route
  digest only. Unknown/partial schema or enum fails closed.
- Desktop must reject raw source/world/core/closure, prompt/lane/transcript
  text, private memory, packet/proof, provider payload, credential, tool
  arguments/results, or free-form context maps.
- `realmProfileContext`, anchor/profile metadata, and source display metadata
  are presentation inputs only and must not influence LocalAgent source or
  model context authority.

- AUTHORITY-RELATION subject=desktop action=consume-status object=localagent-context value=bounded-only polarity=require
- AUTHORITY-RELATION subject=realmprofilecontext action=influence object=localagent-source-authority value=denied polarity=forbid

## D-LLM-023 — No Desktop Orchestration Owner

Desktop must not keep a renderer-local Agent Chat orchestration stack.

Forbidden Desktop-owned surfaces include:

- `chat-agent-orchestration*`
- `chat-agent-turn-plan`
- `chat-nimi-execution-engine*`
- Desktop Agent Chat `executeScenario` wrappers
- Desktop Agent Chat direct Runtime media output / workflow invocation helpers
- renderer-local voice workflow executors
- renderer-local AI message/action planners

If a future UI helper needs to transform projection data for display, it must be
named and structured as a projection/view-model helper and must not call Runtime
execution APIs directly.

Desktop must not assemble LocalAgent prompts/context, attach
`realmProfileContext`, profile/anchor metadata, source/world data, memory, lane
text/order, roles, tool schemas, or execution bindings to a turn. It submits
typed current-user intent only; Runtime owns the context compiler.

- AUTHORITY-RELATION subject=desktop action=assemble object=localagent-prompts value=denied polarity=forbid
- AUTHORITY-RELATION subject=realmprofilecontext action=influence object=localagent-turn-context-authority value=denied polarity=forbid

## D-LLM-024 — Message, Action, And Voice Projection Boundary

Agent Chat message/action/voice semantics are Runtime-owned.

Desktop may:

- display Runtime-projected assistant messages and action states
- display Runtime-projected media / voice / workflow progress
- expose user controls that submit typed user intent
- expose explicit user controls to request Runtime-owned voice rendering/replay
  for a committed assistant message
- invoke admitted Runtime SDK speech-to-text projection only for explicit user
  voice input capture before submitting text intent to Runtime Agent Chat
- map Runtime failure reason codes to user-facing copy

Desktop may not:

- decide whether an assistant action exists
- invent model-generated prompt payloads
- choose between text, image, voice, or voice workflow execution paths
- turn capability readiness into action admission
- turn runtime job acceptance into product success
- autoplay assistant voice in Desktop Agent Chat
- derive transcript reveal, caption, or voice-session semantics from local
  capture / playback helper state
- treat `realmProfileContext`, anchor/profile metadata, source display fields,
  or a bounded `AgentTurnContextSummary` as model-facing source/context

- AUTHORITY-RELATION subject=realmprofilecontext action=influence object=localagent-source-authority value=denied polarity=forbid
- AUTHORITY-RELATION subject=realmprofilecontext action=influence object=localagent-turn-context-authority value=denied polarity=forbid

## D-LLM-024a — Desktop Manual Voice Playback

Desktop Agent Chat voice output is click-to-play by default.

Fixed rules:

- `runtime.agent.turn.message_committed` must render text without automatically
  starting assistant voice playback.
- A user play action may request Runtime to render voice for the committed
  message/turn or replay an existing Runtime-owned generated voice artifact.
- Desktop must not call provider TTS, local speech engines, or app-level REST
  bypasses directly from Agent Chat.
- Desktop stop for replayed/completed audio is local playback stop only. If the
  underlying Runtime turn is still active, the UI must expose interruption as a
  separate Runtime-owned cancel/interrupt action.
- Missing TTS model, unhealthy route, or unavailable voice reference must remain
  text-only/unavailable UI. Desktop must not synthesize pseudo voice success.

## D-LLM-025 — Presentation Failure Semantics

When Runtime Agent Chat projection is missing, disabled, invalid, or rejected,
Desktop must fail closed as a presentation surface.

Required behavior:

- show unavailable / failed / pending states from Runtime reason codes
- keep user-entered composer text in memory while the current renderer session is
  active, without promising restart recovery
- avoid pseudo-success assistant messages, pseudo audio playback, pseudo
  workflow completion, pseudo memory writes, and silent fallback model routes
- keep renderer-local telemetry and diagnostics below product truth

## D-LLM-025a — Local Persistence Remediation Boundary

Desktop Agent Chat local persistence, when present during the D3 migration, is
limited to renderer UI state and a disposable projection cache.

Fixed rules:

- Desktop local persistence must not become canonical Agent Chat transcript,
  message, action, turn, beat, conversation-anchor, lifecycle, or history truth.
- Desktop local persistence must not author assistant greetings, successful
  assistant turns, message/action existence, prompt traces, turn traces, or
  projection rebuild output as product truth.
- Desktop local persistence must not provide offline Agent Chat transcript
  recovery. When Runtime is unavailable, Desktop may preserve in-memory display
  state for the current renderer session, but it must not reconstruct Agent Chat
  history from Desktop storage after restart.
- Desktop must not persist Agent Chat drafts. Composer text is transient
  renderer state only and is allowed to be lost on reload or restart.
- Desktop must not admit Agent Chat rename or archive conversation semantics.
  Agent Chat exposes a single active Runtime conversation per runtime source
  snapshot / LocalAgent projection; any
  display title is derived projection text, not user-authored conversation
  metadata.
- Runtime-owned session snapshots and `runtime.agent.turn.*` /
  `runtime.agent.presentation.*` projections are the replay source for Agent
  Chat transcript and presentation state.
- No steady-state Desktop `chat_agent_*` store, bridge client, or Tauri command
  family is admitted after cutover. Historical Desktop projection rows are not
  a product recovery source; restart recovery must come from Runtime / SDK
  session projection.
- The only steady-state Desktop persistence admitted here is non-transcript UI
  state such as focus, scroll, popover, and transient panel state.

## D-LLM-107 — Agent Chat Store Retirement Requirements

The Desktop `chat_agent_*` projection-cache store is retired. Desktop must not
register `chat_agent_*` Tauri commands, expose a `chatAgentStoreClient`, or own
SQLite schema for Agent Chat transcript/message/turn recovery.

Store retirement requirements:

- Runtime / SDK can list the calling app's Agent Chat conversation summaries
  without reading Desktop SQLite.
- Runtime / SDK can recover a selected conversation through
  `ConversationAnchor` plus `GetPublicChatSessionSnapshot`, including
  Runtime-owned transcript replay envelope fields for stable message identity,
  timestamps, status, and kind.
- Runtime / SDK must own any future close / delete / clear policy for
  user-visible conversation history. Desktop must not implement this as a
  local-only delete once Runtime-owned transcript replay is active.
- Runtime / SDK must own any future message-level delete / redact policy for
  Agent Chat messages before Desktop exposes those actions.
- Agent Chat draft persistence is not a product requirement. Runtime / SDK must
  not add an Agent Chat draft surface to replace the retired Desktop draft
  behavior.
- Agent Chat rename, archive, and multi-conversation session management are not
  product requirements. Runtime / SDK should expose one active conversation per
  CharacterSourceRefV3/v3 provenance / LocalAgent projection unless a later
  product decision admits multiple conversations.
- Desktop submit paths use in-memory optimistic projection only; committed user
  and assistant transcript state replays from Runtime session snapshots or
  `runtime.agent.turn.*` / `runtime.agent.presentation.*` projections.

No offline Agent Chat transcript product is admitted. If Runtime is unavailable,
Desktop may preserve only the current renderer-session in-memory display state;
after reload or restart, it must fail closed until Runtime / SDK projection is
available.

### Ordinary Nimi Chat Session Boundary

Ordinary Nimi Chat is distinct from Desktop Agent Chat.

Agent Chat is Runtime Agent lifecycle projection. Ordinary Nimi Chat is an app
product feature that consumes Runtime AI execution and SDK AI session-loop
developer-experience primitives.

Fixed rules:

- Desktop may own ordinary Nimi Chat product session persistence for
  app-specific `thread`, `message`, and `draft` records when the product does
  not require Realm cloud/cross-device/social truth.
- The Desktop `chat_ai_*` Tauri command family may remain admitted only as this
  ordinary Nimi Chat local product session store. It must not be reused for
  Agent Chat transcript, Runtime Agent turn, action, voice, memory, lifecycle,
  or conversation-anchor recovery.
- Ordinary Nimi Chat persistence must not store provider/model routing,
  fallback policy, capability readiness, Runtime job authority, canonical
  memory, permission grants, audit events, or app lifecycle truth.
- Ordinary Nimi Chat execution must consume admitted Runtime / SDK public
  surfaces for AI execution, route/readiness projection, streaming, structured
  output, and scheduling checks.
- Reusable turn-loop, stream assembly, local tool-loop, structured-output, and
  mock/test transport helpers must be promoted to SDK DX surfaces when another
  app needs the same behavior. Desktop keeps only product-specific session
  policy, UI wiring, and local product persistence.
- If ordinary Nimi Chat becomes cloud canonical, social, account-scoped,
  cross-device, or multi-user product truth, ownership must move to Realm or
  another admitted product authority before Desktop syncs or commits it.
- If ordinary Nimi Chat needs canonical memory or knowledge commits, those
  commits must go through admitted Cognition / Runtime memory policy surfaces;
  Desktop session persistence and SDK loop helpers may only stage or preview
  candidates.

This rule is a non-equivalence boundary: the presence of a chat UI, token
stream, local conversation history, or tool loop does not make the feature
Runtime Agent Chat.

## D-LLM-026 — Adjacent Authority Boundaries

Adjacent owner boundaries are fixed:

- `.nimi/spec/runtime/agent-service.authority.yaml` owns live
  Runtime Agent execution, agent lifecycle, memory policy, conversation
  continuity, transient turn / presentation projection, and agent events.
- `.nimi/spec/runtime/agent-participation.authority.yaml` owns
  participation profiles, prompt assembly policy, execution owner axes, output
  candidates, and canonical Agent Chat reference posture.
- `.nimi/spec/runtime/agent-participation.authority.yaml` owns model-facing
  Agent output wire validation and APML projection.
- `.nimi/spec/runtime/agent-participation.authority.yaml` owns Runtime
  Agent presentation stream families and projection envelopes.
- `.nimi/spec/runtime/model-catalog.authority.yaml` owns runtime voice workflow,
  `VoiceReference`, `VoiceAsset`, and scenario job truth.
- the avatar units in
  `.nimi/spec/desktop/agent-projection.authority.yaml` own only
  Desktop-to-Avatar presentation handoff and transient visual surface cues.
- `.nimi/spec/desktop/ai-consumption.authority.yaml` owns only
  Desktop stream consumption mechanics, cancellation display, and retry UX.
- `.nimi/spec/desktop/shell-runtime.authority.yaml` owns only Desktop UI state
  persistence mechanics, not Agent Chat execution truth.
- Ordinary Nimi Chat product session persistence is governed by `D-LLM-107`;
  it is not evidence that Desktop may own Agent Chat or Runtime AI authority.

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/runtime/model-catalog.authority.yaml`
- `.nimi/spec/desktop/agent-projection.authority.yaml`
- `.nimi/spec/desktop/ai-consumption.authority.yaml`

## Preserved source: Conversation Capability Contract

# Conversation Capability Contract

> Historical owner label: Desktop Kernel
>
> Historical umbrella: this prose was a submodel of `AIConfig` / `AISnapshot`.
> Current semantics are admitted only when present in
> `.nimi/spec/desktop/agent-projection.authority.yaml` or the directly owning
> canonical authority.

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

Desktop host bootstrap 是 conversation capability shared builder 的唯一实现 home：

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
  evidence，也只能作为对 `.nimi/spec/runtime/agent-participation.authority.yaml`
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
  `.nimi/spec/runtime/agent-participation.authority.yaml` 定义的 runtime-owned outputs；
  不得经由 capability health、`runtimeFields`、scheduler queues、或 UI local state
  派生一份平行 deferred continuation truth
- AI / Agent submit path must not use capability health, metadata,
  `runtimeFields`, voice lists, voice assets, capture state, or UI local state
  to derive Agent Chat workflow, voice executor, broader voice session, or
  transcript/caption semantics. Those are Runtime-owned projection/output truth
  for Desktop.

## D-LLM-021a — Agent Center Runtime Agent AI Config Consumer Boundary

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

## Preserved source: Agent Avatar Surface Contract

# Agent Avatar Surface Contract

> Historical owner label: Desktop Kernel

## Scope

定义 Desktop agent chat 中 avatar transient surface 的产品语义 authority。

本契约只拥有以下 avatar surface truths：

- current-anchor / current-surface `AvatarInteractionState`
- voice / message / lifecycle inputs 如何被归一化为 avatar 可消费信号
- chat shell 与 reusable `kit/features/avatar` 之间的语义 landing
- 哪些 avatar 语义仍然保持 surface-local，而不能上推为 runtime truth

本契约不拥有 runtime persistent `AgentPresentationProfile`、message/action envelope truth、
voice workflow / `VoiceReference` truth、broader voice session truth、或具体 renderer backend /
asset packaging truth。`.nimi/spec/runtime/agent-participation.authority.yaml`
（`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent presentation truth；
`.nimi/spec/runtime/agent-participation.authority.yaml`
（`K-AGCORE-036` ~ `K-AGCORE-039`）继续拥有 runtime-owned transient turn /
presentation seam 与 current emotion projection；
Runtime Agent Chat / Voice projections continue to own message / action / voice
upstream semantic truth. `.nimi/spec/desktop/agent-projection.authority.yaml`
中的 Agent Chat units 只拥有 Desktop Agent Chat presentation/projection boundaries；
kit avatar module 只消费本契约定义的
normalized surface semantics，不得反向成为 Desktop product owner。

## D-LLM-053 — Canonical Avatar Surface Authority Home

Desktop agent chat 的 canonical avatar transient surface / bridge authority
属于 `.nimi/spec/desktop/agent-projection.authority.yaml`；本节仅保留其历史说明。

本 authority 固定拥有以下 product outputs：

- 当前 conversation anchor / surface 上 avatar 是否进入 `idle` / `thinking` / `listening` /
  `speaking` / `transitioning` 之类的交互阶段
- 当前 avatar emotion / action / attention cue 的 product meaning 是什么
- 上游 voice / message / lifecycle evidence 如何被降解为统一 avatar interaction signal
- chat shell 如何把这些 signals 提供给 reusable avatar stage 与 `apps/avatar`
  launch/handoff consume，而不再私有化 avatar semantics

固定 owner cut：

- `apps/avatar/**` 是 first-party avatar carrier owner；Live2D / VRM carrier
  execution、avatar-app shell、carrier bootstrap、以及 desktop-selected launch
  context intake 由 avatar app 拥有
- desktop 只拥有 chat shell bridge / handoff / orchestration semantics；
  decommissioned desktop-local carrier residue 若仍保留在源码中，也必须保持
  unreachable，不再构成 admitted owner boundary
- desktop 不得再把自身呈现为 future long-term avatar carrier home，也不得要求
  avatar app normal boot 静默自举默认 agent

adjacent authority 边界固定为：

- `.nimi/spec/runtime/agent-participation.authority.yaml`
  （`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent avatar profile / default voice truth
- `.nimi/spec/runtime/agent-participation.authority.yaml`
  （`K-AGCORE-036` ~ `K-AGCORE-039`）继续拥有 `runtime.agent.turn.*` /
  `runtime.agent.presentation.*` / `runtime.agent.state.emotion_changed`
  的 runtime-owned transient projection truth
- `.nimi/spec/desktop/agent-projection.authority.yaml` 中的
  `D-LLM-022` ~ `D-LLM-026` 继续拥有 Desktop Agent Chat presentation/projection
  boundary；Runtime Agent / Voice contracts
  own upstream behavior, message/action, workflow, and session truth
- `kit/features/avatar` 只消费 normalized avatar surface inputs；不得提升为 Desktop semantic owner

## D-LLM-054 — AvatarInteractionState Boundary

`AvatarInteractionState` 是 current-anchor / current-surface 的 transient state，不是 runtime
canonical truth。

最小 admitted surface 必须能表达：

- `phase`
- optional `emotion`
- optional `actionCue`
- optional `attentionTarget`
- optional `visemeId`
- optional `amplitude`

固定约束：

- 该 state 必须始终可恢复到当前 `conversation_anchor_id`、当前 surface instance、以及当前 agent projection relation
- 同一 desktop app 允许多个 avatar surface instances 并存；每个 instance
  必须绑定一个显式 `{ agent_id, conversation_anchor_id, surface_instance_id }`
  三元组，且不同 instance 间不得共享 `AvatarInteractionState`
- `surface_instance_id` 是 desktop app-local identity，只用于当前 app 内的
  `AvatarInteractionState` scoping；它不是 runtime-owned 字段，也不得进入
  `runtime.agent.*` event payload
- 多个 surface instances 可以订阅同一 `agent_id + conversation_anchor_id`
  的 runtime projection；surface-level routing 仍由 app 自己负责
- 它可以由多个上游信号归一化而成，但归一化后只能作为 transient surface truth 使用
- renderer-local interpolation、physics、blend-shape implementation detail 可以继续存在，但不得冒充 canonical `AvatarInteractionState`
- 缺少合法 conversation-anchor / surface / agent relation 时必须 fail-close；不得猜测一份 active avatar state

## D-LLM-055 — Signal Normalization Boundary

Avatar surface 只能消费已 admitted 的上游 semantic evidence，并在 Desktop 边界内归一化。

允许的上游 signal family 包括：

- behavior / turn posture outputs
- runtime-owned turn / presentation projections
- runtime-owned emotion projection
- message-action execution lifecycle
- voice session listening / speaking lifecycle
- voice workflow progress / return-path continuity
- runtime lifecycle / autonomy projection evidence

固定约束：

- normalization 必须先消费上游 admitted truth，再生成 avatar-specific signal；不得在 avatar path 上重判上游语义
- avatar surface 可把 runtime-owned `current_emotion` 归一化为 surface-local
  interaction emotion，但不得反向改写 runtime emotion truth
- `visemeId` / `amplitude` 之类的 speech-local cues 只能表达当前 surface animation input，不得倒写成 runtime-owned voice or agent truth
- downstream avatar stage、chat rail、shell-local animator、或 playback helper 都不得各自再派生第二套 phase / emotion / attention truth

## D-LLM-056 — Chat Landing And Reusable Consumer Boundary

Desktop agent chat 是 avatar surface 的首个 consumer，但不是 avatar semantics 的私有 owner。

固定语义：

- chat shell 必须通过 reusable `kit/features/avatar` surface 消费 normalized presentation +
  interaction inputs；不得在 chat 私有组件内重新定义一套 avatar semantic contract
- Desktop 仍然拥有 placement、permissions、conversation continuity、和 shell orchestration
  truth；kit avatar module 只拥有 reusable renderer/headless contract
- right-rail、inline stage、popover stage、或 future multi-surface placement 可以不同，
  但它们必须消费同一份 `AvatarInteractionState` authority

## D-LLM-057 — Surface Scope And Persistence Boundary

Avatar surface truth 默认只属于当前 renderer surface，不自动升级为 cross-anchor 或
cross-session persistence truth。

固定约束：

- surface close、anchor change、agent switch、或 permission loss 时，avatar interaction state
  必须 deterministic teardown 或重建；不得静默沿用上一 surface 的 active cues
- 当前 admitted route 不允许把 avatar interaction snapshots 直接持久化为 runtime-owned
  LocalAgent profile truth
- app 若需要持久化 avatar placement 或 cosmetic preferences，必须与本契约中的 transient
  interaction state 明确分层

## D-LLM-058 — Deferred Scope And Non-Owners

以下内容在当前 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- standalone avatar editor / authoring workflow
- background avatar continuation
- camera choreography truth
- renderer-specific physics or mocap protocol truth
- cross-anchor avatar stage synchronization

具体约束：

- static image rail、voice meter、playback helper、或 renderer implementation evidence 都不是 avatar surface semantic owner
- runtime presentation profile、voice workflow inventory、或 app-local animation library 都不得被误写成本契约的 truth source
- 若 downstream 需要更宽的 avatar product surface，必须先落新的 admitted desktop kernel authority；不得扩写本契约或 kit module 作为替代 owner

## D-LLM-059 — Desktop Local Avatar Carrier Decommission Boundary

After desktop-local avatar carrier decommission, desktop no longer owns a local
avatar carrier registry, carrier import path, renderer/backend path, package
descriptor, backend capability profile, or per-agent binding truth as an
admitted first-party carrier line.

This rule does not prohibit the `D-LLM-099..103` opaque private local Avatar
asset controls in `.nimi/spec/desktop/agent-projection.authority.yaml`.
Desktop may help a
user select/import/remove a private local Live2D / VRM asset ref, but that ref
is configuration evidence only. It is not a carrier registry row, package
descriptor, backend resolver, or launch-ready proof.

Fixed rules:

- desktop must not present a desktop-local `resource_id`, imported VRM/Live2D
  asset record, local asset-read path, or backend route as current avatar
  carrier truth
- stale desktop-local avatar registry code, if retained on disk for bounded
  source-history reasons, must remain unreachable from the shipped desktop
  product path
- renderer helpers, shell view models, and Tauri command registration must fail
  closed rather than silently reviving desktop-local avatar storage or carrier
  loading

## D-LLM-060 — No Desktop-Local Avatar Binding Authority

Desktop no longer binds a local avatar resource to an `agentId` as active avatar
render selection truth.

Fixed rules:

- desktop must not ship or expose a per-agent local avatar binding workflow
- desktop must not override runtime presentation or `apps/avatar` carrier
  selection through local desktop-only binding state
- missing avatar launch / handoff context must fail closed; desktop must not
  recreate a remembered local binding as fallback behavior

## D-LLM-061 — Desktop Avatar Carrier Precedence Stop Line

Desktop no longer owns a local avatar render precedence contract.

Fixed rules:

- desktop shell surfaces must not resolve avatar rendering in a local order such
  as binding override -> runtime profile -> fallback image as an active carrier
  policy
- `apps/avatar` is the only first-party carrier line for Live2D / VRM execution
- desktop may still render ordinary static chat avatars or other non-live shell
  decoration, but those surfaces must not be represented as a co-equal carrier
  route

## D-LLM-062 — Retained Non-Carrier Shell Scope

Desktop-local avatar carrier decommission does not remove every desktop-local cosmetic surface. The remaining
admitted desktop-local scope is narrow shell-owned configuration that does not
constitute avatar carrier truth.

Admitted retained scope:

- per-agent in-app backdrop binding for chat atmosphere
- surface-local placement preference for desktop shell chrome where separately
  admitted
- explicit avatar-app launcher / handoff affordances owned by desktop shell
- read-only desktop session-link inventory that consumes avatar-published live
  instance projection without promoting desktop-local truth

Fixed rules:

- retained shell scope must not import, bind, load, or render a desktop-local
  Live2D / VRM carrier path
- retained shell scope must not mutate runtime presentation truth or avatar-app
  carrier truth
- desktop may request bounded live-instance operations such as explicit reveal,
  retarget, or close only over admitted `avatar_instance_id` identity; avatar
  app remains the execution owner and missing targets must fail closed
- any future attempt to reintroduce desktop-local live-avatar execution requires
  a new admitted desktop kernel authority; it cannot reuse the retired Pack 4
  residue line

## D-LLM-063 — App Attention To Avatar Projection Boundary

Desktop agent avatar surfaces may consume shell-owned app-level attention, but
the avatar surface owns the projection from that upstream attention into avatar
consume semantics.

The admitted avatar-side projection output is limited to:

- active attention presence for the current app viewport
- continuous attention presence strength for soft entry / exit degrade
- normalized app-level attention vector
- bounded escalation into `attentionTarget: 'pointer'` and subtle head / eye
  attention bias

Fixed rules:

- raw app viewport attention intake remains owned by `ui-shell-contract.md`;
  avatar surfaces must not reopen a second DOM pointer owner at card or
  viewport level for the same canonical interaction line
- avatar projection may narrow app attention into a bounded interaction object
  for reusable consume, but it must not smuggle raw pointer coordinates,
  viewport bounds, or shell-owned lifecycle events into runtime-owned
  `AgentPresentationProfile` truth or generic chat interaction-summary truth
- avatar projection must remain one normalized surface contract shared across
  current chat avatar placements and future backend consume; renderer backends
  must not fork their own semantic attention owner
- surface teardown, thread switch, agent switch, or loss of valid shell
  attention input must deterministically clear active projected attention truth

## D-LLM-064 — Avatar Attention Precedence, Bounds, And Stop Line

Avatar attention projection must preserve readability as an agent-presence
surface rather than widen into model-viewer behavior.

Canonical precedence order is:

1. active surface validity and fail-closed consume rules
2. speaking / listening phase truth and lip-sync readability
3. app-attention-derived head / eye bias
4. idle breathing / ambient motion

Fixed rules:

- app-level attention may bias gaze or head direction, but it must not override
  speaking / listening phase truth or make lip-sync unreadable
- attention degrade must return the surface smoothly to idle or voice-led
  behavior; attention cues must not latch as persistent state
- attention-derived movement must remain subtle and bounded; unrestricted body
  rotation, unrestricted bone manipulation, or free camera responses are not
  admitted
- the following remain explicitly deferred: click / poke reactions,
  drag-to-rotate behavior, orbit camera or camera choreography, model-inspector
  style manipulation, and runtime ownership of pointer / gaze truth

## D-LLM-069 — Surface Layer Stacking And Placement / Transform Persistence

Desktop agent chat surface organizes its visual truth as a fixed three-layer stack
and separates persistable cosmetic preferences from transient interaction truth.

The admitted layer stack is, from bottom to top:

1. app-native glass base layer — the desktop app's established in-window glass
   aesthetic; it is an app-internal visual, not a transparent passthrough to the
   host desktop
2. optional in-app backdrop mask layer — sourced from the admitted per-agent
   backdrop binding (see `desktop_agent_backdrop_store`); the mask image is an
   in-app asset imported by the user, not a desktop wallpaper projection;
   defaults to fully transparent when absent
3. component layer — chat shell interactive widgets (nav, transcript, composer,
   relationship rail); the chat domain occupies the full middle area between the
   left navigation and the right relationship rail, not a sub-column beside the
   avatar

Fixed rules:

- layer 0–1 must not capture pointer events above what layer 2 requires to
  remain interactive; layer composition is a rendering concern and does not
  become a second owner of interaction semantics
- layer 1 strictly consumes the admitted per-agent backdrop binding; it does
  not introduce a parallel backdrop truth
- renderer-local viewport bounds, preferred footprint, or visual footprint
  heuristics must not be promoted into admitted occupancy rectangle truth;
  transcript width carve remains limited to the shell-owned single right-dock
  rectangle and the shell-owned flowing taxonomy admitted on the desktop spec
  path
- avatar placement (`CanonicalConversationAnchoredSurfacePlacement`) is
  admitted as a per-target cosmetic preference that may be persisted in
  desktop-local storage (renderer-local key) with a canonical default of
  `right-center`; it must not be promoted into runtime-owned presentation truth
- avatar transform (`{ x, y, scale }` and optional `rotate`) is admitted as
  strict surface-local transient state that must deterministically reset on
  surface teardown, thread switch, agent switch, or permission loss, in keeping
  with `D-LLM-057`
- script / debug overrides may mutate avatar transform through a single
  renderer-local channel (currently the admitted debug override); this channel
  remains a non-stable surface contract and must not be exposed through SDK,
  runtime, or public app surface until a separate authority admits it
- placement persistence and transform transience together must not invent
  camera choreography, cross-thread avatar synchronization, or standalone
  editor surface; those remain deferred per `D-LLM-058`

## D-LLM-070 — Desktop-To-Avatar Demo Acceptance Boundary

Desktop owns cross-app demo acceptance only as launcher/orchestrator evidence,
not as Avatar carrier execution proof.

Current first-30-second Desktop-to-Avatar acceptance must prove the following
on current active code, not by citing historical process artifacts:

- Desktop selects a target and invokes the admitted Avatar launch path with
  explicit `agent_id` and optional `avatar_instance_id`; Desktop does not
  pre-create or pass conversation anchors for the default Avatar launch path
- the target relation remains explicit and does not fall back to same-agent
  conversation guessing, desktop-local avatar binding, or runtime-default agent
  truth
- the acceptance run distinguishes real runtime/SDK handoff evidence from
  explicit fixture/mock evidence; fixture evidence may support regression
  checks but cannot close real demo acceptance
- missing launch context, missing agent id, stale live instance identity, or
  unavailable runtime path must fail closed
  instead of reporting demo success
- Desktop-to-Avatar handoff must not transmit raw JWT, refresh token,
  `subject_user_id`, account id, user id, Realm base URL, shared auth session
  material, or any app-local login bootstrap hint
- Desktop-rendered Live2D smoke evidence may validate Desktop chat renderer
  behavior, but it cannot close `apps/avatar` carrier WebGL/canvas proof

Out of scope for this acceptance boundary unless a later authority admits it:

- Phase 2 voice output, lipsync, `avatar.speak.*`, `avatar.lipsync.frame`, or a
  shared `PresentationTimeline`
- broad SDK/platform Event API semantics
- desktop-local Live2D/VRM carrier revival
- closed 2026-04-20 demo checklist as active product proof

## D-LLM-071 — Desktop Companion App Event Convention

Desktop owns only bounded shell-local companion event convention for launcher,
handoff, and chat-shell cues. This convention is downstream of runtime-owned
`runtime.agent.*` projection and upstream of Avatar app-local consume; it is not
a platform event broker.

Admitted desktop-local companion event names:

- `desktop.chat.message.send`
- `desktop.chat.message.receive`
- `desktop.avatar.launch.requested`
- `desktop.avatar.launch.failed`
- `desktop.avatar.handoff.completed`
- `desktop.avatar.handoff.failed`
- `desktop.avatar.instance.reveal_requested`
- `desktop.avatar.instance.close_requested`

Fixed rules:

- every desktop-to-avatar launch event must resolve to explicit `agent_id` and
  optional `avatar_instance_id` before leaving Desktop shell ownership
- Desktop owns launch intent only. Avatar / Runtime / SDK own account
  projection, agent authorization, visual package descriptor resolution, and
  conversation context for the default Avatar app path.
- Desktop app events may be used as first-party UI cues, but they must not
  replace `runtime.agent.turn.*`, `runtime.agent.presentation.*`,
  `runtime.agent.state.*`, or `runtime.agent.hook.*` projection truth
- Desktop must not publish wildcard subscriptions, cancellable before-events,
  SDK-owned app event APIs, or a general `desktop.*` broker from this
  convention
- Desktop may request bounded live-instance operations by
  `avatar_instance_id`; Avatar remains execution owner and missing/stale
  targets must fail closed
- app-local event payloads must not mint runtime-owned fields or infer
  continuity from same-agent traffic
- unsupported desktop companion events must be ignored with observable
  diagnostics or rejected at the sender boundary; they must not silently become
  product success

## D-LLM-072 — Desktop Avatar Launch Intent

Desktop owns only the user action that launches Avatar. Default Avatar launch
is not a Desktop-owned scoped runtime binding. Avatar is a Runtime-admitted
local first-party app (`nimi.avatar`) and resolves account, agent, package,
data, and conversation context through Runtime / SDK authority.

Fixed rules:

- Desktop default Avatar launch payload may contain only `agent_id`, optional
  `avatar_instance_id`, and optional non-authoritative `launch_source`.
- Desktop must not call `runtime.agent.anchors.open` or pass
  `conversation_anchor_id` as a default Avatar launch precondition.
- Desktop must not pass visual package id/path/descriptor, account id, user id,
  `subject_user_id`, Realm URL, access token, refresh token, raw JWT, shared
  auth payload, or auth UX route in Avatar launch context.
- `agent_id` is launch intent only; Avatar / Runtime must validate access
  before private data or visual package descriptor loads.
- Avatar owns first-party runtime bootstrap orchestration, including redacted
  account projection, Runtime-mediated broker/service use, agent validation, visual package
  descriptor resolution, and Avatar-owned conversation context.
- Desktop may request bounded live-instance reveal/close operations by
  `avatar_instance_id`, but it must not treat those operations as proof of
  account, binding, package, or conversation authority.

## D-LLM-105 — `start_with_chat` Auto-Launch Gate

Desktop uses a single implementation gate that decides whether opening Agent
Chat for a LocalAgent auto-launches Avatar. Canonical authority for
`launch_mode='start_with_chat'` actuation remains
`.nimi/spec/desktop/agent-projection.authority.yaml`. The gate produces a launch
*intent* and is adjacent to the historical D-LLM-072 payload description.

Actuation scope:

- the gate evaluates on **each Agent-Chat-open event** for the selected
  LocalAgent. It is per-open, not per-app-session; switching conversation
  anchor or reopening Agent Chat re-evaluates the gate.
- per-open evaluation does not by itself cause repeated spawning; double-spawn
  prevention is owned by the instance-policy arbitration in D-LLM-106, not by a
  separate session-scoped suppression.
- the gate fires only for the `Agent Chat open` entry. The explicit setup-launch
  and explicit quick-launch entries remain user-action launches and do not route
  through this gate.

The gate's admitted condition set is closed and pinned. Avatar auto-launch is
permitted **only when all eight of the following are true**:

1. user is logged in;
2. selected target is a LocalAgent, not a bare PersonaCharacter source;
3. conversation anchor exists;
4. local Avatar asset is selected and valid;
5. backend capability posture is valid;
6. Runtime projection is authorized;
7. `launch_mode='start_with_chat'`;
8. instance policy can be resolved safely.

Fixed rules:

- the gate MUST evaluate all eight conditions on every Agent-Chat-open event for
  the selected LocalAgent before any `start_with_chat` launch intent is emitted.
- the gate MUST NOT emit a launch intent when any one of the eight conditions is
  false; a single failed condition fails the whole gate closed.
- a failed gate MUST resolve to a typed non-launch outcome consistent with the
  fail-closed configuration state `D-LLM-083` in
  `.nimi/spec/desktop/agent-projection.authority.yaml`; it MUST NOT
  degrade to a guessed launch, a remembered local
  binding, idle-motion success, or a static carrier proxy.
- the gate MUST be the single actuation authority for `start_with_chat`. No
  other Desktop surface, lifecycle hook, effect, or companion-event handler may
  emit a `start_with_chat` auto-launch intent outside this gate.
- the gate MUST NOT auto-launch Avatar globally on Nimi start, and MUST NOT
  auto-launch from Nimi Chat, Human Chat, Group Chat, standalone relationship
  management, Explore, or Apps. Auto-launch is exclusively a per-LocalAgent Agent Chat posture and is
  never applied to every source materialization.
- the gate MUST NOT widen the launch payload. A passed gate emits only the
  D-LLM-072 payload (`agent_id`, optional `avatar_instance_id`, optional
  non-authoritative `launch_source`); the configuration record MUST NOT be
  copied into the launch payload.
- condition 6 (`Runtime projection is authorized`) MUST be a typed authorization
  result, not inferred from the presence of a configuration record or from
  prior same-agent traffic.

## D-LLM-106 — Instance-Policy Launch Arbitration

Every Avatar launch decision — both explicit-launch entries and the
`start_with_chat` gate of D-LLM-105 — MUST branch on the configured
`avatar_instance_policy`. The policy is the launch-time arbitration authority
for whether a launch reuses, creates, or defers an Avatar instance. The allowed
policies are `reuse_active_instance`, `launch_new_instance`, and
`require_user_selection`; the default is `reuse_active_instance`.

Per-policy launch-time behavior:

- `reuse_active_instance` — the launch decision MUST reuse an active Avatar
  instance for the same `{ LocalAgent, conversation anchor }` when one exists,
  and otherwise launch exactly one. Under this policy a single Agent-Chat-open
  event MUST NOT produce a second instance for the same target.
- `launch_new_instance` — a new instance is admitted only for explicit user
  launch actions. When combined with `start_with_chat`, the launch decision MUST
  apply a repeated-spawn guard so that a single Agent-Chat-open event spawns at
  most one new instance; re-evaluation of D-LLM-105 on the same open event MUST
  NOT spawn additional instances.
- `require_user_selection` — when more than one valid instance/asset launch
  posture exists, the launch decision MUST present a user selection and MUST NOT
  auto-resolve; it launches only after the user chooses.

Fixed rules:

- the launch decision MUST NOT ignore `avatar_instance_policy` or hardcode a
  single behavior; the three policies MUST produce three distinct launch-time
  outcomes.
- instance-conflict (a launch target collides with an existing live instance in
  a way the active policy cannot resolve) MUST fail closed to a typed product
  state. It MUST NOT silently reuse, silently spawn a duplicate, or report
  launch success.
- anchor-unavailable (no resolvable conversation anchor at launch time) MUST
  fail closed to a typed product state and MUST NOT be substituted with a
  guessed or remembered anchor, consistent with D-LLM-054 and D-LLM-072.
- the repeated-spawn guard is a launch-decision concern; it MUST NOT be
  implemented as Desktop-local carrier process ownership and MUST NOT promote
  Desktop into an Avatar instance lifecycle owner. Avatar remains the execution
  owner; Desktop arbitrates only the launch intent.
- arbitration MUST preserve D-LLM-054 multi-instance identity: each launched or
  reused instance remains bound to an explicit
  `{ agent_id, conversation_anchor_id, surface_instance_id }` triple, and the
  product surface MUST keep each visible instance attributable to its LocalAgent
  so the user can identify, reveal, and close it.

## Fact Sources

- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime persistent presentation truth and non-owner boundary
- `.nimi/spec/runtime/agent-participation.authority.yaml` — conversation continuity anchor truth
- `.nimi/spec/runtime/agent-participation.authority.yaml` — transient turn, presentation, emotion, and timeline projection truth
- `.nimi/spec/desktop/agent-projection.authority.yaml` — Desktop Agent Chat presentation/projection boundary
- `.nimi/spec/runtime/agent-service.authority.yaml` — Runtime Agent execution and presentation projection authority
- `.nimi/spec/runtime/model-catalog.authority.yaml` — Runtime voice workflow / asset semantics
- `.nimi/spec/platform/ui-design-system.authority.yaml` — reusable `kit/features/avatar` admission and ownership hardcut
- `docs/spec/avatar-domain-index.md` — Avatar first-party authority map
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Avatar shell launch, fail-closed, and foreground companion UX boundary
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Avatar carrier visual proof requirements
- `.nimi/spec/runtime/agent-participation.authority.yaml` — core substrate reader guide and correspondence matrix
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — reader guide and first-30-second demo correspondence

## D-LLM-078a Cross-Reference — Configuration

The avatar-configuration units in
`.nimi/spec/desktop/agent-projection.authority.yaml` own the Agent Chat
Settings Avatar configuration product surface.

This contract continues to own transient avatar surface and handoff semantics.
The configuration contract must not reopen Desktop-local carrier registry,
per-agent avatar binding truth, or launch payload widening prohibited by
D-LLM-059 through D-LLM-072.

## Preserved source: Agent Avatar Configuration Contract

# Agent Avatar Configuration Contract

> Historical owner label: retired Desktop Kernel host-transport boundary

## Scope

This contract is retained only to mark the Desktop-owned Agent Center avatar
configuration schema as retired.

Desktop no longer owns an Agent Center local config schema, app-local
Live2D/VRM/background import store, reusable resource-management command
surface, preview assembly, or selection persistence.

Current owner split:

- Runtime `AgentPresentationProfile` owns avatar ref, background ref, default
  voice, and avatar autoplay selection truth.
- Kit Shell standard `agent-center` capability owns host-local asset bytes,
  validation, local asset URL serving, Live2D adapter asset-scoped sidecar
  association, and scoped resource removal.
- Avatar owns Agent Center preview-service rendering, carrier visual proof,
  backend readiness, calibration effects, and launch payload truth.
- Desktop owns Agent Center placement, scoped Runtime/SDK adapter attachment,
  app chrome, copy namespace, and real app evidence hooks only.

## D-LLM-078 Retired Avatar Configuration Authority Home

Desktop may place Kit Agent Center for avatar/background selection and review.
It must not persist Agent Center avatar/background/default-voice/autoplay
selection, local asset refs, Live2D adapter sidecar refs, launch policy,
debug profile, generated motion policy, or background selection in a
Desktop-owned config record.

Import completion writes selection through Runtime
`SetAgentPresentationProfile`. Reusable import, validation, local asset URL
serving, and resource cleanup belong to Kit Shell standard `agent-center`
operations.

## D-LLM-079 Retired Configuration Record

The former Desktop-owned Agent Center avatar configuration record is retired
without replacement.
The retired fields are not migrated:

- `local_avatar_asset_ref`
- `live2d_adapter_manifest_source`
- `live2d_adapter_manifest_ref`
- `live2d_calibration_ref`
- `avatar_instance_policy`
- `backend_kind`
- `backend_capability_profile_ref`
- `generated_motion_provider_policy`
- `launch_mode`
- `debug_profile`
- `local_history`
- `ui.last_section`

The following remain forbidden as Desktop Agent Center configuration truth:

- package descriptors, package paths, package bytes, launch-local asset ids, or
  raw asset bytes
- account/session/auth material
- scoped avatar binding ids or carrier registry ids
- raw APML, MCP/A2A, delegated provider, Desktop app, or business payloads
- backend command strings intended for Avatar execution
- raw Live2D adapter manifest payloads, absolute source paths, compatibility
  tiers, Avatar diagnostic truth, calibration payloads/values, model digests,
  preview artifact refs, render scale, target FPS, performance policy, and
  expression inventory

## D-LLM-080 Launch Payload Hard Cut

Desktop configuration must not widen Avatar launch payload. Avatar launch and
carrier readiness remain Avatar/Runtime-owned.

## D-LLM-081 Resolver Ownership

Resolver ownership is single-cut:

- Runtime `AgentPresentationProfile` owns selected refs.
- Kit Shell owns host-local Agent Center asset custody and local URL serving.
- Avatar owns preview, materialization, backend readiness, calibration, and
  carrier proof.
- Desktop owns placement and evidence hooks only.

Desktop must not implement a second Avatar backend file resolver, local carrier
registry, per-agent local avatar binding truth, or Agent Center resource store.

## D-LLM-082 Retired Debug Override Reconciliation

The former Desktop Agent Center avatar configuration record no longer exposes
renderer-local debug override policy. Any debug or calibration surface must
remain outside Agent Center product UI unless a separate Runtime/Avatar
authority admits it.

## D-LLM-083 Fail-Closed Configuration State

The retired Desktop configuration record cannot be used to manufacture a
ready-looking Agent Center state. Desktop must fail closed when Runtime
presentation refs, Kit Shell custody resolution, or Avatar preview-service
evidence is unavailable.

## D-LLM-099 Avatar Local Asset Control Surface Boundary

Desktop may expose local Avatar asset controls only by placing Kit Agent
Center. The controls use Kit Shell standard `agent-center` operations and
Runtime `AgentPresentationProfile` writes.

Desktop must not create:

- a browser-reachable Avatar-local install endpoint
- a Petdex-style local driver protocol
- a Desktop-owned package install daemon
- a direct filesystem activation path outside the admitted Kit Shell custody
  flow
- an Agent Center package inventory surface

## D-LLM-100 Opaque Ref Storage

Desktop must not store Agent Center opaque refs as Desktop configuration truth.
Opaque refs are either Runtime presentation refs or Kit Shell custody refs.

## D-LLM-101 Acquisition And Import UX

Desktop may initiate private local Live2D/VRM import only through Kit Agent
Center and Kit Shell standard `agent-center` operations. Remote marketplace
acquisition surfaces remain retired.

## D-LLM-102 Readiness And Failure UX

Desktop readiness UX must fail closed when Runtime profile refs do not resolve
through Kit Shell or Avatar preview evidence is missing. Desktop must not
translate missing evidence into idle motion, static carrier success, local
binding success, or launch-ready status.

## D-LLM-103 Launch Payload And Resolver Hard Cut

Selection refs are Runtime profile truth, host-local asset custody belongs to
Kit Shell, and preview/render evidence belongs to Avatar. Desktop must not copy
those fields into launch payloads or app-local carrier truth.

## D-LLM-104 Live2D Calibration Ref Boundary

Desktop must not render or maintain a Live2D calibration or debug-control
surface inside Agent Center. Any future calibration effect must go through an
admitted Runtime/SDK/Avatar projection, never through Desktop launch handoff or
app-local carrier truth.

## Traceability

- `.nimi/spec/platform/ui-design-system.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/runtime/model-catalog.authority.yaml`
- `.nimi/spec/avatar/embodiment-surface.authority.yaml`
- `.nimi/spec/sdks/feature-clients.authority.yaml`

## Delegation Control Projection

Desktop may display Runtime-owned delegated approval, diagnostic, and redacted
replay projections through the typed SDK control surface. It may submit an
approval or rejection decision, but it does not configure providers, activate a
protocol adapter, execute a delegated capability, or resume an approved request.

MCP, A2A, and their provider, transport, tool-registry, execution, and readiness
contracts remain unavailable until separately admitted by canonical Runtime
authority. Desktop therefore exposes no command, argument, credential,
transport, provider-mutation, or debug-execution control that could reactivate
those deferred contracts.

## Preserved source: Companion Participation Control Surface Contract

# Companion Participation Control Surface Contract

> Owner Domain: `D-LLM-*`

This contract defines Desktop-owned companion participation controls and
projection surfaces for Avatar companion/persona and Desktop companion panels.

## D-LLM-094 Desktop Consumer Boundary

Desktop may display companion participation projection and expose bounded
controls through SDK/Runtime typed methods. Desktop does not own participation
execution, prompt assembly, provider/model routing, memory/cognition writes,
Runtime queue truth, or domain commit.

## D-LLM-095 Control Semantics

Desktop controls may submit or display only through `runtime.companionParticipation`
typed SDK methods:

- explicit user trigger requests
- cancellation/interrupt requests
- replay open requests

Controls must carry typed refs only: `agent_id`, `surface_kind`, `profile_ref`,
`conversation_anchor_ref`, `room_orchestration_ref`, `domain_context_ref`, or
`debug_probe_ref` as applicable.

Avatar debug/probe participation remains Runtime/Avatar-owned. Desktop may
display typed projection state when surfaced by SDK/Runtime, but it must not own
or run a Desktop debug/probe workbench.

## D-LLM-096 Persona Boundary

Desktop may route Avatar companion/persona controls only as typed companion
participation controls. Persona/package variants remain Avatar configuration
and must not create a separate product, app, Runtime facade, prompt path, or
execution owner.

## D-LLM-097 Refusal And Recovery UX

Desktop must render Runtime refusal, blocked, failed, canceled, and missing
evidence states as explicit product states. It must not create a local reply,
retry through a private provider route, or hide the refusal behind a fake
success state.

## D-LLM-098 No Private Scheduler

Desktop companion participation surfaces must not create app-local schedulers,
room queues, fairness budgets, timeout budgets, or queue-status truth for
Runtime participation.

## Preserved source: Realm Group Agent Participation Surface Contract

# Realm Group Agent Participation Surface Contract

> Historical owner label: Desktop Kernel

## Scope

This contract owns the Desktop/Web product surface boundary for Realm Group
Agent Participation. It defines controls, projections, and hardcut gates for
group agent participation while consuming SDK, Runtime, and Realm authority.
Desktop and Web do not own agent execution, prompt assembly, provider/model
routing, memory policy, same-room orchestration, or Realm GROUP message commit.

## D-LLM-088 — Surface Authority Home

Desktop/Web may present Realm Group Agent Participation controls and status for
Realm `GROUP` threads only as consumers of:

- SDK contract `S-RUNTIME-221` through `S-RUNTIME-226`
- Realm product contract `R-CHAT-008` through `R-CHAT-014`
- Runtime consumer contract `K-AGCORE-119` through `K-AGCORE-124`
- Runtime room orchestration `realm_group` row and overlay under
  `K-AGCORE-107` through `K-AGCORE-118`

Desktop/Web must not define app-local group agent execution, local AI adapters,
prompt builders, provider/model routing, memory policy, reply queue truth, or
same-room scheduler authority.

## D-LLM-089 — Control Surface Inputs

Desktop/Web controls may initiate mention, explicit user action, admitted
automation display, or product-disabled posture only through typed SDK/Realm
references. Controls must pass group thread, membership snapshot, agent slot,
trigger event, read cursor, optional reply target, and room orchestration
references without exposing raw prompt payloads, provider/model hints, direct
commit handles, or unbounded transcript dumps.

## D-LLM-090 — Candidate, Commit, And Read Surface Split

Desktop/Web may render Runtime `REALM_GROUP_MESSAGE_CANDIDATE` status and Realm
committed `GROUP` messages, but must preserve the owner split. Runtime candidate
output is not a committed message, and Realm authenticated commit/read/sync
truth is not Runtime execution success. Desktop/Web must not synthesize commit
success from candidate output or write GROUP transcript truth locally.

## D-LLM-091 — Queue Status And Refusal Projection

Desktop/Web may display queued, running, refused, cancelled, timed-out, and
candidate states only from typed Runtime `runtime.agent.*` projection and Realm
read/sync truth. Desktop/Web must not create a public
`runtime.orchestration.*` product namespace, local queue store, or semantic
status truth for same-room orchestration.

## D-LLM-092 — Hardcut Gates

Desktop/Web implementation must fail closed on:

- public prompt assembly for group agent execution
- provider/model selection
- local memory/capability/concurrency verdicts
- group-local same-room queue, fairness, budget, cancellation, or timeout truth
- `GROUP_LIMITED` as a capability enum
- Runtime direct Realm GROUP commit
- direct Realm REST bypass where SDK/Realm typed calls are required
- raw Tauri IPC or local adapter paths that bypass SDK and Runtime authority

## D-LLM-093 — Implementation Status

This contract freezes the consumer hardcut plan only. It does not require
Desktop/Web implementation changes, SDK generated client changes, Runtime
implementation changes, proto changes, or Realm backend changes. Future
implementation admissions must cite this contract and prove no app-local
participation execution truth is introduced.

## Traceability

- `.nimi/spec/sdks/realm-consumer.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
