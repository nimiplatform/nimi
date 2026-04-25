# Agent Chat Message Action Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中单条 assistant message 与统一 post-turn action 的产品语义
authority。Live2D companion substrate continuation 之后，model-facing output wire
truth 由 runtime APML 契约拥有；本文件只拥有 APML 被 runtime validated / projected
之后，Desktop 如何消费 resolved message/action 语义。

本契约只拥有以下 message/action truths：

- resolved message/action semantics after runtime APML projection
- model-generated modality prompt semantics
- immediate post-turn action semantics
- unified image / voice action relation semantics

本契约不拥有 capability binding、state persistence mechanics、stream lifecycle、或 runtime
voice/media workflow truth。execution engine、scheduler、timer、bridge、notification、
modality helpers 只能消费 resolved message/action outputs，不得重算、补造、覆盖、或静默修正这些
product semantics。
model-facing APML output truth 固定由
`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`（`K-AGCORE-044` ~
`K-AGCORE-047`）拥有；strict JSON message-action envelope 不再允许作为
model-facing authority、迁移兼容、或 recovery path，只能在 APML validation /
projection 之后作为内部 typed projection transport / persistence serialization。
deferred continuation / follow-up continuation truth 固定由
`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`（`K-AGCORE-040` ~ `K-AGCORE-043`）
拥有；Desktop 不再把 delayed continuation 当作 message action。

## D-LLM-027 — Canonical Message-Action Authority Home

Desktop agent chat 的 canonical message-action owner 固定为本文件。

本 authority 固定拥有以下 resolved message/action output truth：

- single assistant message envelope semantics
- unified immediate modality action semantics
- model-generated modality prompt payload semantics
- immediate post-turn action semantics

adjacent authority 边界固定为：

- `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
  （`K-AGCORE-044` ~ `K-AGCORE-047`）拥有 model-facing APML output wire /
  APML-to-runtime projection / post-turn action vs HookIntent split truth
- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）继续拥有
  `resolvedTurnMode` 与 `resolvedExperiencePolicy` 的 generic behavior truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  capability selection / projection / execution snapshot truth，而不是某个 image /
  voice / video action 是否存在
- `state-contract.md` 继续拥有 projection、hydration、persistence mechanics，而不是 message
  或 action 是否成立
- `streaming-consumption-contract.md` 继续拥有 delivery lifecycle、cancel、retry、
  timeout projection，而不是 message/action existence truth
- `.nimi/spec/runtime/kernel/voice-contract.md` 继续拥有 runtime voice workflow / asset /
  job semantics，而不是 desktop voice product action truth
- `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`
  继续拥有 deferred continuation / follow-up continuation 的 runtime-owned admission
  与 pending truth

若任一 consumer 需要 message/action 相关决策，必须先读取同一份 resolved message/action
outputs；不得从 prompt runtime internals、thread metadata、runtime fields、timer
state、scheduler queues、或 modality-specific helper state 再派生一份 parallel truth。

## D-LLM-028 — Single-Message Envelope Semantics

Desktop agent chat 的单次 LLM 结构化输出固定为单个 assistant message，而不是同 turn 多个
text beat。

resolved envelope 最小字段固定为：

- `schemaId`
- `message`
- `actions`

其中 `message` 最小字段固定为：

- `messageId`
- `text`

固定约束：

- 每个 assistant turn 恰有一个 resolved `message`
- 同一 assistant turn 内不得存在第二条 text message、tail beat、delayed beat、或任何等价
  的多段文本 delivery truth
- 缺失合法 `messageId` / `text` 时必须 fail-close
- 当前或历史实现若仍停留在 multi-beat / tail text path，不构成 authority，后续 alignment
  必须向本 contract 收敛

## D-LLM-029 — Unified Modality Action Envelope

image、voice action 在 Desktop product semantics 中共享一份统一的 immediate action
contract；不得为不同 action 各自定义平行 product trigger truth。`video` 保持
deferred，除非后续 mounted authority 明确 admission。

每个 resolved action 至少必须能表达：

- `actionId`
- `actionIndex`
- `actionCount`
- `modality`（封闭枚举：`image` | `voice`）
- `operation`
- `promptPayload`
- `sourceMessageId`
- `deliveryCoupling`

固定约束：

- `actionId` 在同一 assistant turn 内必须唯一
- `actionIndex` 必须从 `0` 开始连续递增，`actionCount` 必须与实际 action 数量一致
- `sourceMessageId` 必须引用当前 turn 的 resolved `message.messageId`
- `deliveryCoupling` 只允许 `after-message` 或 `with-message`
- capability projection / runtime workflow readiness 只决定 action 能否被执行，不决定 action
  是否存在；未被 resolve 的 action 不得因 capability healthy 而被补造出来

## D-LLM-030 — Model-Generated Prompt Payload Semantics

`promptPayload` 是 model-generated modality prompt 的 canonical product output。它属于
message-action contract truth，而不是 image/voice helper 的局部实现细节。`video`
prompt payload remains deferred with video action admission.

固定语义：

- action prompt payload 必须由 model-planned resolved output 提供；执行 helper 不得再用
  keyword detector、template heuristic、provider default text、或 UI local state 合成一份
  substitute prompt
- `promptPayload` 必须保持 typed、可审计、且与 action envelope 同步固化；consumer 可以
  做 schema validation，但不得在 validation 通过后擅自改写其 product intent
- prompt payload 缺失 required discriminator、typed fields、或 modality-required shape
  时必须 fail-close；不得伪造空 prompt、兜底 prompt、或猜测 prompt 参数
- user-authored text、thread context、experience policy 可以参与 model planning，但一旦
  resolved prompt payload 被产出，canonical execution input 就固定为该 payload

## D-LLM-031 — Immediate Post-Turn Action Boundary

本契约中的 `action` 只覆盖 APML 被 runtime validation / projection 后，在当前 assistant
turn 提交后立即执行的 post-turn modality actions。deferred continuation 不再属于
message-action contract。

固定语义：

- admitted `modality` 固定为 `image` / `voice`
- action execution starts only after the current assistant turn reaches its
  admitted message commit point or explicitly declared `with-message` coupling
- prompt payload must be typed and modality-matched; missing or invalid payload
  must fail-close
- delayed continuation, background wake, or follow-up assistant turn must not be
  encoded as a desktop `action`; those semantics belong to runtime-owned
  `HookIntent`
- `video` product action remains deferred and must not be accepted by Desktop
  shipped-path parsers until a later packet admits video execution and consumer
  semantics

## D-LLM-032 — Message/Action Relation And Consumer Boundary

同一 assistant turn 可以同时包含单条 text message 与 modality actions。本契约拥有这些输出之间的
product relation truth；执行层只消费。

固定约束：

- message 与 action 的 relation 必须在 resolved outputs 中显式可恢复；不得在 scheduler、
  timer、stream consumer、或 modality executor 中事后猜测
- execution engine、scheduler、timer、bridge、notification、image helper、voice helper、
  video helper 只能消费 resolved message/action outputs；不得决定是否存在
  deferred continuation、是否发起 modality action、或 action prompt 是什么
- 当前或历史实现若仍停留在 heuristic image trigger、timer-owned text continuation、或
  multi-beat commit，不构成 authority；后续 alignment 必须向本契约收敛

## D-LLM-033 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- proactive contact semantics
- wake-word / background continuation
- connected-app actions
- camera / screenshare

具体约束：

- deferred continuation semantics 不得被解释为 proactive contact authorization
- admitted `voice` action envelope 不等于 broader voice execution 已完成产品落地；
  `video` action 仍保持 deferred；
  admitted `voice` action 也不等于 richer voice workflow semantics 已被 admit；
  `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`、agent chat voice identity /
  `VoiceReference`、preset/custom voice selection、以及 packet-bounded clone/design
  trigger semantics 固定由 `agent-chat-voice-workflow-contract.md`
  （`D-LLM-047` ~ `D-LLM-052`）拥有；
  admitted `voice` action 的 executor / playback product semantics 固定由
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）拥有；
  admitted `voice` action envelope 也不等于 broader voice session semantics 已被 admit；
  explicit entry / exit、same-anchor continuity、admitted listening modes、
  interruption、以及 transcript / caption rules 固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有
- 若 downstream 需要新增 richer assistant behavior surface，必须先落新的 admitted
  desktop kernel authority；不得扩写 timer、scheduler、prompt runtime、notification、
  bridge、或 modality helper 作为替代 owner
- admitted Desktop `voice` message actions do not by themselves own companion
  voice playback, lipsync, or PresentationTimeline truth
- any assistant voice action that participates in Live2D companion speech must
  be coupled to runtime-owned timeline projection admitted by `K-AGCORE-051`
- Desktop may carry model-planned voice action intent and prompt payload, but it
  must not synthesize voice timing, lipsync frames, or Avatar mouth parameter
  values from chat text
- `deliveryCoupling=with-message` may express product intent to coordinate text
  and voice, but actual timing remains runtime timeline truth
- if runtime timeline projection is unavailable, Desktop must not claim
  synchronized companion voice/lipsync success; it may only execute the already
  admitted voice action semantics governed by the voice executor/session
  contracts

## Fact Sources

- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — D-LLM-022 ~ D-LLM-026
  adjacent behavior authority
- `.nimi/spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `.nimi/spec/desktop/kernel/state-contract.md` — projection / persistence boundary
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md` — delivery lifecycle /
  cancel / retry boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime voice workflow boundary
- `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` — model-facing APML
  wire / APML-to-runtime projection / post-turn action vs HookIntent split
- `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md` — runtime-owned
  deferred continuation / HookIntent boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — agent chat
  richer voice workflow / voice identity boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-executor-contract.md` — agent chat
  voice executor / playback outcome boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-session-contract.md` — agent chat
  broader voice session boundary
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-behavior.ts` —
  current resolved message/action vocabulary evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-orchestration.ts` —
  current agent local chat execution / action wiring evidence
