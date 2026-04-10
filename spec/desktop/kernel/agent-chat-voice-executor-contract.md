# Agent Chat Voice Executor Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 resolved `voice` action 如何成为可执行、可播放语音结果的
产品语义 authority。

本契约只拥有以下 voice executor truths：

- resolved `voice` action consumption semantics
- first-packet `audio.synthesize` execution semantics
- playback-ready speech artifact outcome semantics
- agent chat voice executor defer boundary

本契约不拥有 `voice` action existence truth、`promptPayload` existence truth、generic
capability projection truth、runtime voice workflow truth、state persistence mechanics、或
voice workflow / voice identity truth、voice session / conversation mode truth。

`agent-chat-beat-action-contract.md`（`D-LLM-030` ~ `D-LLM-033`）继续拥有 `voice`
action envelope 与 model-generated prompt payload truth；`llm-adapter-contract.md`
（`D-LLM-005`）继续拥有 runtime-aligned TTS route/API surface；`spec/runtime/kernel/voice-contract.md`
继续拥有 `voice_workflow.*` 与 voice asset lifecycle truth；
`agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer
voice workflow、voice identity、preset/custom voice selection、以及 workflow
return-path truth。voice executor、
playback helper、scheduler、notification、runtime media job 只能消费这些上游 resolved
truth，不得重新定义一份 parallel product owner。

## D-LLM-034 — Canonical Voice Executor Authority Home

Desktop agent chat 的 canonical voice executor owner 固定为本文件。

本 authority 固定拥有以下 product outputs：

- 当前 assistant turn 中某个 resolved `voice` action 是否进入 agent chat voice executor
- 首包 executor 选择的 product meaning 是否为 `audio.synthesize` playback
- agent chat 对 voice execution 的最小成功结果应是什么
- 哪些 voice-related surfaces 仍然保持 deferred

adjacent authority 边界固定为：

- `agent-chat-beat-action-contract.md`（`D-LLM-030` ~ `D-LLM-033`）继续拥有
  resolved `voice` action existence、relation、以及 `promptPayload` truth
- `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer
  voice workflow admission、voice identity / `VoiceReference`、preset/custom voice
  selection、以及 packet-bounded clone/design trigger truth
- `llm-adapter-contract.md`（`D-LLM-005`）继续拥有 `runtime.media.tts.*` 与
  `audio.synthesize` route/API truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  capability selection/projection/execution snapshot truth，而不是 voice action
  是否存在或 playback outcome 应如何被 product 化
- `spec/runtime/kernel/voice-contract.md`（`K-VOICE-*`）继续拥有
  `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`、preset/custom voice discovery、
  voice asset 与 scenario job truth

若任一 consumer 需要 agent chat voice executor 决策，必须先读取同一份 resolved
`voice` action 与 capability projection；不得从 route health、voice list、Forge host
wiring、playback helper local state、或 runtime media job metadata 再派生一份 product
truth。

## D-LLM-035 — Resolved Voice Action Consumption Boundary

agent chat voice executor 只消费已经在 beat-action envelope 中被 resolve 的
`modality: voice` action。

固定约束：

- 未被 resolve 的 `voice` action 不得因 `audio.synthesize` healthy、存在 preset voice、
  或 playback helper ready 而被补造出来
- executor 是否开始，必须以 resolved `voice` action 为前提；capability readiness 只决定
  可执行性，不决定 action existence
- executor 只允许消费 model-generated `promptPayload`；不得用 UI local text、regex、
  keyword heuristic、provider default text、或 helper-owned template 重新合成 prompt
- 若 resolved `voice` action 缺 relation、缺 modality-required payload shape、或与当前
  assistant turn 无法建立合法关联，必须 fail-close，不得静默降级为普通 text reply

## D-LLM-036 — First-Packet Execution Path

agent chat voice executor 的首包 execution semantics 固定为：

- 只允许 text-to-speech style playback outcome
- execution path 固定消费 `audio.synthesize`
- 不得借道升级成 `voice_workflow.tts_v2v` 或 `voice_workflow.tts_t2v`

固定约束：

- executor 必须先读取 capability-scoped `audio.synthesize` projection / resolved
  binding，再经 `runtime.media.tts.synthesize` 执行
- `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v` 即使 projection healthy，也不得在首包
  代替 `audio.synthesize` 成为 executor path
- 首包不得把 preset/custom voice discovery、voice asset selection、workflow metadata、
  或 scenario job lifecycle 升格为 agent chat voice executor 的 required truth
- 缺合法 `audio.synthesize` binding、route-resolved model、或 runtime synthesize result 时，
  executor 必须 fail-close；不得伪造成功播放、空 artifact、或 guessed fallback voice

## D-LLM-037 — Playback-Ready Artifact Outcome

agent chat voice executor 的最小成功 product outcome 固定为：

- 一个与 source `voice` action 可关联的 playback-ready speech artifact outcome

固定约束：

- 成功结果必须可恢复到 source assistant turn / beat / action relation；不得在播放层丢失
  source action identity
- 成功结果必须是 renderer 可播放的 cached speech artifact outcome；仅有原始 runtime bytes
  但无法形成 playback-ready result 时，不得宣告 product success
- artifact outcome 必须保留合法 mime / uri 等播放所需字段；缺 required playback fields
  时必须 fail-close
- playback helper 可以负责 transport、cache、player lifecycle 与 replay mechanics，但不拥有
  “什么算一次 agent chat voice success” 的 product truth

## D-LLM-038 — Model-Generated Execution Input Boundary

agent chat voice executor 只允许把 resolved `promptPayload` 作为 canonical execution
input truth。

固定语义：

- executor 可以对 resolved payload 做 schema validation，但 validation 通过后不得擅自改写
  product intent
- executor 若需要把 payload 映射到 `runtime.media.tts.synthesize` 请求字段，映射必须是
  typed、可审计、且不得引入新的 planner-owned text truth
- 用户文本、thread context、experience policy、agent characteristic 都只能在 model
  planning 阶段影响 voice action；一旦 resolved payload 已固化，executor 输入就固定为该
  payload
- executor 不得从 voice list、provider metadata、playback state、或 runtime errors
  反向改写 resolved payload 为另一份 guessed request

## D-LLM-039 — Non-Owners And Remaining Deferred Scope

以下内容不由本契约拥有，不得由本契约或其 consumers 借道重算或偷渡 admit：

- richer voice workflow semantics
- agent chat voice identity / `VoiceReference` semantics
- preset/custom voice selection semantics
- packet-bounded clone / design trigger semantics
- broader voice session mode
- background / proactive voice continuation

具体约束：

- richer workflow / voice identity truth 若已被 admit，固定由
  `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）拥有，而不是本契约
- 首包 voice executor semantics 不得被解释为 agent chat 已拥有持续 voice session、
  push-to-talk / hands-free listening mode、wake-word、或后台 continuation admission；
  broader session semantics 若已被 admit，固定由
  `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）拥有，而不是本契约
- Forge host wiring、runtime route describe、voice list UI、playback helper、scheduler、
  bridge、notification 都不是 voice executor product owner
- 若 downstream 需要 richer voice behavior surface，必须先落新的 admitted desktop
  kernel authority；不得扩写本契约或上游 helper 作为替代 owner

## Fact Sources

- `spec/desktop/kernel/agent-chat-beat-action-contract.md` — resolved voice
  action and prompt payload boundary
- `spec/desktop/kernel/llm-adapter-contract.md` — runtime-aligned
  `audio.synthesize` route/API surface
- `spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `spec/runtime/kernel/voice-contract.md` — runtime voice workflow / voice
  asset boundary
- `spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — richer voice
  workflow / voice identity boundary
- `spec/desktop/kernel/agent-chat-voice-session-contract.md` — broader voice
  session boundary
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-media.ts`
  — desktop TTS synthesize bridge and route evidence
- `apps/desktop/src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-profiles.ts`
  — cached speech artifact playback evidence
- `apps/forge/src/shell/renderer/infra/bootstrap/forge-runtime-host.ts` — Forge
  host capability wiring evidence only
- `nimi-coding/.local/**` — local preflight evidence for the narrow first
  voice executor packet (non-authoritative supporting material only)
