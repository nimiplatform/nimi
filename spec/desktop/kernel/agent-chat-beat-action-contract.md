# Agent Chat Beat Action Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 model-planned delayed beat 与 modality action 的产品语义 authority。

本契约只拥有以下 beat/action truths：

- delayed beat semantics
- pending beat invalidation semantics
- structured modality action semantics
- model-generated modality prompt semantics

本契约不拥有 multi-beat ordering、turn-mode、experience-policy/settings、capability
binding、state persistence mechanics、stream lifecycle、或 runtime voice/media workflow
truth。execution engine、scheduler、timer、bridge、notification、modality helpers 只能
消费 resolved beat/action outputs，不得重算、补造、覆盖、或静默修正这些 product
semantics。

## D-LLM-027 — Canonical Beat-Action Authority Home

Desktop agent chat 的 canonical beat-action owner 固定为本文件。

本 authority 固定拥有以下 resolved beat/action output truth：

- delayed follow-up beat semantics
- pending beat invalidation semantics
- modality action envelope semantics
- model-generated modality prompt payload semantics

adjacent authority 边界固定为：

- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026`）继续拥有
  `resolvedTurnMode`、`resolvedExperiencePolicy`、`resolvedBeatPlan` 的 generic
  behavior truth，包括 ordered beat list 的基础 ordering / indexing semantics
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  capability selection / projection / execution snapshot truth，而不是某个 image /
  voice / video action 是否存在
- `state-contract.md` 继续拥有 pending entry、projection、hydration、persistence
  mechanics，而不是 pending beat 是否成立、何时失效、或 action prompt 是什么
- `streaming-consumption-contract.md` 继续拥有 delivery lifecycle、cancel、retry、
  timeout projection，而不是 delayed beat / modality action existence truth
- `spec/runtime/kernel/voice-contract.md` 继续拥有 runtime voice workflow / asset /
  job semantics，而不是 desktop voice product action truth

若任一 consumer 需要 beat/action 相关决策，必须先读取同一份 resolved beat/action
outputs；不得从 prompt runtime internals、thread metadata、runtime fields、timer
state、scheduler queues、或 modality-specific helper state 再派生一份 parallel
truth。

## D-LLM-028 — Delayed Beat Semantics

delayed beat 是 assistant turn 在同一次 behavior resolution 中被明确 admit 的
follow-up beat。它不是 scheduler/timer 自行推断出的 continuation，也不是 host-owned
proactive contact。

固定语义：

- delayed beat 必须属于某个已解析 assistant turn 的 resolved beat/action outputs
- delayed beat 若成立，必须在 execution 开始前作为 admitted resolved output 被固定；
  scheduler / timer 只能读取并执行，不得补造一个原本不存在的 delayed beat
- delayed beat 可以引用 `resolvedBeatPlan` 中既有 beat ordering truth，但本契约拥有
  "该 beat 是否为 delayed follow-up、其等待语义是什么、何时进入 pending state"
  的产品含义
- delayed beat 必须带有明确的 wait/delay instruction（例如 `delayMs`、`notBefore`
  或等价 typed pacing field）；缺失合法等待字段时必须 fail-close，不得按 guessed
  default 自动补时
- delayed beat 仍属于当前 assistant turn 的连续性语义；它不得借道升级成新 thread、
  automation、background wake-up、或 proactive contact admission

## D-LLM-029 — Pending Beat Invalidation Semantics

pending beat 是已被 resolve 但尚未开始 delivery 的 delayed beat product state。
pending beat 的 canonical invalidation rule 固定为 user reply override。

固定约束：

- 当 delayed beat 已解析但尚未 delivery 时，Desktop 可以把它投影为 pending beat
- 若用户在该 pending beat delivery 之前发送新的 user-authored turn，旧 pending
  beat 必须立刻失效；不得继续 delivery、不得静默复活、不得与新 turn 并行保留
- 旧 pending beat 若需要被替换，只能由新的 assistant turn resolution 显式产生新的
  resolved beat/action outputs；scheduler / timer / store migration 不得自行 rewrite
- state / scheduler / timer 可以记录 `pending`、`invalidated`、`delivered` 等 lifecycle
  evidence，但这些 lifecycle projection 不拥有 invalidation truth 本身
- 缺失合法 invalidation evidence 时必须 fail-close 为 "不继续 delivery"，不得把
  stale pending beat 当作仍然有效

## D-LLM-030 — Unified Modality Action Envelope

image、voice、video action 在 Desktop product semantics 中共享一份统一的 modality
action envelope contract；不得为三个 modality 各自定义平行 product trigger truth。

每个 resolved modality action 至少必须能表达：

- `actionId`
- `actionIndex`
- `actionCount`
- `modality`（封闭枚举：`image` | `voice` | `video`）
- `operation`
- `promptPayload`
- 与当前 assistant turn / beat relation 的 typed link（例如 source turn、source beat、
  delivery coupling、或等价 typed relation field）

固定约束：

- `actionId` 在同一 assistant turn 内必须唯一
- `actionIndex` 必须从 `0` 开始连续递增，`actionCount` 必须与实际 action 数量一致
- image / voice / video 的 admitted product meaning 统一来自这一个 envelope；不得让
  image helper、voice helper、video helper 各自定义 "什么时候算一个 action"
- capability projection / runtime workflow readiness 只决定 action 能否被执行，不决定
  action 是否存在；未被 resolve 的 action 不得因 capability healthy 而被补造出来
- action envelope 可以与 text beat plan 同 turn 并存；其 relation 必须来自 resolved
  beat/action outputs，而不是 delivery helper 的事后猜测

## D-LLM-031 — Model-Generated Modality Prompt Semantics

`promptPayload` 是 model-generated modality prompt 的 canonical product output。它属于
beat-action contract truth，而不是 image/voice/video helper 的局部实现细节。

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

## D-LLM-032 — Beat/Action Relation And Consumer Boundary

同一 assistant turn 可以同时包含 text beat plan、delayed follow-up beat、以及
modality action plan。本契约拥有这些输出之间的 product relation truth；执行层只消费。

固定约束：

- beat 与 action 的 relation 必须在 resolved beat/action outputs 中显式可恢复；不得在
  scheduler、timer、stream consumer、或 modality executor 中事后猜测
- 第一可见 text beat、tail beat、以及 modality action 的实际执行次序，只能在不违反
  resolved outputs 的前提下推进；consumer 不得重排来创造新的 product meaning
- execution engine、scheduler、timer、bridge、notification、image helper、voice helper、
  video helper 只能消费 resolved beat/action outputs；不得决定是否存在 delayed beat、
  是否保留 pending beat、是否发起 modality action、或 action prompt 是什么
- 当前或历史实现若仍停留在 heuristic image trigger、single-text-beat commit、或
  timer-owned continuation，不构成 authority；后续 alignment 必须向本契约收敛

## D-LLM-033 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- proactive contact semantics
- richer assistant-style expansion
- wake-word / background continuation
- connected-app actions
- camera / screenshare

具体约束：

- delayed beat semantics 不得被解释为 proactive contact authorization
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
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有；
  admitted `video` action 仍需后续独立 packet，但不得破坏本契约的一体 action envelope
- 若 downstream 需要新增 richer assistant behavior surface，必须先落新的 admitted
  desktop kernel authority；不得扩写 timer、scheduler、prompt runtime、notification、
  bridge、或 modality helper 作为替代 owner

## Fact Sources

- `spec/desktop/kernel/agent-chat-behavior-contract.md` — D-LLM-022 ~ D-LLM-026
  adjacent behavior authority
- `spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `spec/desktop/kernel/state-contract.md` — pending beat projection /
  persistence boundary
- `spec/desktop/kernel/streaming-consumption-contract.md` — delivery lifecycle /
  cancel / retry boundary
- `spec/runtime/kernel/voice-contract.md` — runtime voice workflow boundary
- `spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — agent chat
  richer voice workflow / voice identity boundary
- `spec/desktop/kernel/agent-chat-voice-executor-contract.md` — agent chat
  voice executor / playback outcome boundary
- `spec/desktop/kernel/agent-chat-voice-session-contract.md` — agent chat
  broader voice session boundary
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-behavior.ts` —
  current resolved beat vocabulary evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-behavior-resolver.ts`
  — current heuristic delayed beat planning evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-orchestration.ts` —
  current single-text-beat commit and image-helper execution evidence
- `nimi-coding/.local/**` — local preflight evidence for LLM-planned beat /
  modality authority decisions (non-authoritative supporting material only)
- `nimi-coding/.local/**` — local beat-action landing route evidence
  (non-authoritative supporting material only)
