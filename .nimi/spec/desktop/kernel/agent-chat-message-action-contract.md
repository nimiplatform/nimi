# Agent Chat Message Action Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中单条 assistant message 与统一 `actions[]` 的产品语义 authority。

本契约只拥有以下 message/action truths：

- structured message-action envelope semantics
- model-generated modality prompt semantics
- `follow-up-turn` action semantics
- unified media / voice / video action relation semantics

本契约不拥有 capability binding、state persistence mechanics、stream lifecycle、或 runtime
voice/media workflow truth。execution engine、scheduler、timer、bridge、notification、
modality helpers 只能消费 resolved message/action outputs，不得重算、补造、覆盖、或静默修正这些
product semantics。

## D-LLM-027 — Canonical Message-Action Authority Home

Desktop agent chat 的 canonical message-action owner 固定为本文件。

本 authority 固定拥有以下 resolved message/action output truth：

- single assistant message envelope semantics
- unified modality action envelope semantics
- model-generated modality prompt payload semantics
- follow-up-turn scheduling semantics

adjacent authority 边界固定为：

- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）继续拥有
  `resolvedTurnMode` 与 `resolvedExperiencePolicy` 的 generic behavior truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  capability selection / projection / execution snapshot truth，而不是某个 image /
  voice / video / follow-up-turn action 是否存在
- `state-contract.md` 继续拥有 projection、hydration、persistence mechanics，而不是 message
  或 action 是否成立
- `streaming-consumption-contract.md` 继续拥有 delivery lifecycle、cancel、retry、
  timeout projection，而不是 message/action existence truth
- `.nimi/spec/runtime/kernel/voice-contract.md` 继续拥有 runtime voice workflow / asset /
  job semantics，而不是 desktop voice product action truth

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

## D-LLM-029 — Unified Modality And Follow-Up Action Envelope

image、voice、video、follow-up-turn action 在 Desktop product semantics 中共享一份统一的
action envelope contract；不得为四种 action 各自定义平行 product trigger truth。

每个 resolved action 至少必须能表达：

- `actionId`
- `actionIndex`
- `actionCount`
- `modality`（封闭枚举：`image` | `voice` | `video` | `follow-up-turn`）
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
message-action contract truth，而不是 image/voice/video helper 的局部实现细节。

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

## D-LLM-031 — Follow-Up Turn Semantics

`follow-up-turn` 是当前 assistant turn 在 message-action outputs 中显式 admit 的后续 assistant
turn action unit。它不是 scheduler/timer 自行推断出的 continuation，也不是 host-owned
proactive contact。follow-up chain 可以递归展开，但每个 turn 仍然只 admit 一个
`follow-up-turn` action。

固定语义：

- `follow-up-turn` 的 admitted `operation` 固定为 `assistant.turn.schedule`
- `follow-up-turn.promptPayload` 必须是 typed shape：
  - `kind: "follow-up-turn"`
  - `promptText`
  - `delayMs`
- 每个 assistant turn 最多一个 `follow-up-turn` action
- follow-up 必须在当前 turn 成功提交后，创建新的 assistant turn / message / trace；不得回写为
  同一 turn 的第二条文本消息
- follow-up turn 自己返回的 `actions[]` 继续生效；其中若再次 admit `follow-up-turn`，则形成同一
  thread-bound follow-up chain
- 同一 follow-up chain 默认最大自动轮次固定为 `8`
- 同一 thread 任一时刻最多只允许一个 pending follow-up delay；新的合法 continuation 只能替换
  当前 thread 上最近一次 pending follow-up
- 同一 thread 收到新的用户消息时，pending follow-up 必须取消，且该 chain 不得继续扩展
- pending follow-up 只拥有 process-local admission；app restart 后不得恢复旧 pending chain
- 缺失合法 `promptText`、`delayMs`、`sourceMessageId` 时必须 fail-close
- follow-up-turn 仍属于当前 thread continuity；它不得借道升级成 automation、
  background wake-up、或 proactive contact admission

## D-LLM-032 — Message/Action Relation And Consumer Boundary

同一 assistant turn 可以同时包含单条 text message 与 modality actions。本契约拥有这些输出之间的
product relation truth；执行层只消费。

固定约束：

- message 与 action 的 relation 必须在 resolved outputs 中显式可恢复；不得在 scheduler、
  timer、stream consumer、或 modality executor 中事后猜测
- execution engine、scheduler、timer、bridge、notification、image helper、voice helper、
  video helper 只能消费 resolved message/action outputs；不得决定是否存在
  `follow-up-turn`、是否发起 modality action、或 action prompt 是什么
- 当前或历史实现若仍停留在 heuristic image trigger、timer-owned text continuation、或
  multi-beat commit，不构成 authority；后续 alignment 必须向本契约收敛

## D-LLM-033 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- proactive contact semantics
- wake-word / background continuation
- connected-app actions
- camera / screenshare

具体约束：

- `follow-up-turn` semantics 不得被解释为 proactive contact authorization
- admitted `voice` / `video` action envelope 不等于 voice/video execution 已完成产品落地；
  admitted `voice` action 也不等于 richer voice workflow semantics 已被 admit；
  `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`、agent chat voice identity /
  `VoiceReference`、preset/custom voice selection、以及 packet-bounded clone/design
  trigger semantics 固定由 `agent-chat-voice-workflow-contract.md`
  （`D-LLM-047` ~ `D-LLM-052`）拥有；
  admitted `voice` action 的 executor / playback product semantics 固定由
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）拥有；
  admitted `voice` action envelope 也不等于 broader voice session semantics 已被 admit；
  explicit entry / exit、same-thread continuity、admitted listening modes、
  interruption、以及 transcript / caption rules 固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有
- 若 downstream 需要新增 richer assistant behavior surface，必须先落新的 admitted
  desktop kernel authority；不得扩写 timer、scheduler、prompt runtime、notification、
  bridge、或 modality helper 作为替代 owner

## Fact Sources

- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — D-LLM-022 ~ D-LLM-026
  adjacent behavior authority
- `.nimi/spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `.nimi/spec/desktop/kernel/state-contract.md` — projection / persistence boundary
- `.nimi/spec/desktop/kernel/streaming-consumption-contract.md` — delivery lifecycle /
  cancel / retry boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime voice workflow boundary
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
