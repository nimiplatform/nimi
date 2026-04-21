# Agent Chat Voice Workflow Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 richer voice workflow、voice identity、以及 workflow
result return path 的产品语义 authority。

本契约只拥有以下 voice workflow truths：

- agent chat admitted richer voice workflow semantics
- agent chat voice identity / `VoiceReference` product semantics
- preset/custom voice selection semantics when used by agent chat
- packet-bounded clone / design trigger semantics
- workflow job / asset / projected playback return semantics back into the
  current conversation anchor
- agent chat voice workflow defer boundary

本契约不拥有 resolved `voice` action existence truth、`promptPayload` truth、narrow
`audio.synthesize` playback truth、broader voice session truth、generic
capability projection truth、runtime voice workflow / scenario job / `VoiceAsset`
schema truth、或 state persistence mechanics。
`agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 resolved
`voice` action envelope 与 model-generated prompt payload truth；
`agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）继续拥有 narrow
`audio.synthesize` first-packet playback truth；
`agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）继续拥有 broader
voice session truth；`conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）
继续拥有 `voice_workflow.*` readiness truth；`llm-adapter-contract.md`
（`D-LLM-005`）继续拥有 runtime-aligned voice route/API truth；
`agent-avatar-surface-contract.md`（`D-LLM-053` ~ `D-LLM-058`）继续拥有 richer workflow
signals 如何变成 avatar transient surface cues 的 truth；
`.nimi/spec/runtime/kernel/voice-contract.md`（`K-VOICE-*`）继续拥有 `voice_workflow.tts_v2v`、
`voice_workflow.tts_t2v`、`VoiceReference`、`VoiceAsset`、scenario job lifecycle、
`ListPresetVoices`、以及 `ListVoiceAssets` 的 runtime canonical truth。

workflow helper、voice picker、scenario poller、asset store、playback helper、scheduler、
bridge、notification、UI wording、或 live workflow validation 只能消费这些上游 truth；
不得重算、补造、或覆盖 desktop richer voice workflow product semantics。

## D-LLM-047 — Canonical Voice Workflow Authority Home

Desktop agent chat 的 canonical richer voice workflow owner 固定为本文件。

本 authority 固定拥有以下 product outputs：

- 当前 agent chat `voice` action / workflow intent 是否进入 richer voice workflow
  semantics，而不是 narrow `audio.synthesize` playback semantics
- admitted workflow path 属于 `voice_workflow.tts_v2v` 还是
  `voice_workflow.tts_t2v`
- 当前 conversation anchor 中使用的 voice identity / `VoiceReference` product meaning 是什么
- preset/custom voice selection 与 packet-bounded clone / design trigger 的
  desktop product meaning 是什么
- workflow 结果如何回到当前 conversation anchor continuity
- 哪些 richer voice surfaces 仍然保持 deferred

adjacent authority 边界固定为：

- `agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 resolved
  `voice` action existence、relation、`operation`、以及 `promptPayload` truth
- `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）继续拥有 narrow
  `audio.synthesize` first-packet playback-ready artifact outcome truth
- `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）继续拥有 explicit
  voice session entry / exit、same-anchor live continuity、listening mode、
  interruption、以及 transcript / caption truth
- `agent-avatar-surface-contract.md`（`D-LLM-053` ~ `D-LLM-058`）继续拥有 workflow
  progress / return-path 如何映射为 avatar surface cues 的 truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  `voice_workflow.*` selection / projection / execution snapshot truth，而不是 workflow
  product meaning
- `llm-adapter-contract.md`（`D-LLM-005`）继续拥有 runtime-aligned voice route/API
  truth，而不是 richer workflow semantics
- `.nimi/spec/runtime/kernel/voice-contract.md`（`K-VOICE-*`）继续拥有 workflow type、
  `VoiceReference` schema、`VoiceAsset` schema、scenario job、以及 discovery channel
  truth，而不是 desktop current-anchor product meaning

若任一 consumer 需要 richer voice workflow 决策，必须先读取同一份 desktop-owned
workflow semantics；不得从 capability health、voice list、voice asset inventory、
scenario job metadata、playback helper local state、或 provider/model defaults 再派生
一份 parallel product truth。

## D-LLM-048 — Workflow Admission And Workflow-Type Boundary

agent chat richer voice workflow 只允许在当前 conversation anchor 内被显式 admit；不得由 route
readiness、voice inventory、或 narrow playback helper readiness 反推成立。

固定语义：

- richer workflow route 只有在 resolved `voice` action 或等价 typed workflow intent
  明确表达 workflow semantics 时才可成立；`audio.synthesize` healthy、
  `voice_workflow.*` healthy、存在 custom voice、或 runtime 已支持场景 job 都不构成
  workflow admission
- 当前首包 admitted workflow type 固定为：
  - `voice_workflow.tts_v2v`
  - `voice_workflow.tts_t2v`
- 每个 admitted richer workflow intent 必须与一个 capability key 和一个 workflow type
  一一对应；不得同时声明两种 workflow type，也不得把 `audio.synthesize` 结果静默升级为
  workflow success
- `voice_workflow.tts_v2v` 在 desktop product meaning 中表达“当前 conversation anchor 内通过参考语音
  / 音频驱动 voice creation”
- `voice_workflow.tts_t2v` 在 desktop product meaning 中表达“当前 conversation anchor 内通过文本设计
  / 指令驱动 voice creation”
- resolved `promptPayload` 或等价 typed workflow input 若无法与所声明的 workflow type
  建立合法对应，必须 fail-close；不得靠 provider heuristic、helper template、或 guessed
  field 补齐
- 当前 admitted route 只覆盖 foreground current-anchor continuity；不得借道升级成
  wake-word、background / lock-screen continuation、或 proactive voice contact

## D-LLM-049 — Voice Identity / VoiceReference Semantics

当 agent chat richer voice workflow 需要消费或产出 voice identity 时，Desktop 的
canonical product meaning 固定为 `VoiceReference`-compatible voice identity。

固定约束：

- Desktop 不得发明第四种 local-only voice identity source；admitted voice identity
  source 只能与 runtime `K-VOICE-003` 对齐为：
  - `preset_voice_id`
  - `voice_asset_id`
  - `provider_voice_ref`
- `preset_voice_id` 在 desktop product meaning 中表达“当前 conversation anchor 使用某个系统预置音色
  作为目标 voice identity”
- `voice_asset_id` 在 desktop product meaning 中表达“当前 conversation anchor 使用某个已存在或刚由
  admitted workflow 产出的 user-scoped custom voice asset”
- `provider_voice_ref` 只能在 runtime 已返回 authoritative ref、或 runtime-owned
  discovery 已提供稳定 ref 时进入 desktop product truth；UI helper、voice picker、或
  local state 不得伪造 provider-native ref 成为产品成功语义
- voice identity 可以来自 explicit user choice、agent/profile-derived default、或
  workflow completion return path，但一旦进入 admitted workflow execution evidence，
  其 source kind 与 stable reference 必须可恢复且不得在执行中途被 helper 静默改写
- 若 voice identity provenance 不清楚、仅有 display label、或无法恢复稳定 reference，
  必须 fail-close；不得按列表顺序、provider default、或名字模糊匹配猜测一份
  `VoiceReference`

## D-LLM-050 — Preset / Custom Voice Selection And Packet-Bounded Trigger Semantics

preset/custom voice selection 在 agent chat richer voice workflow 中属于 current-anchor
execution truth，而不是 discovery list truth。

固定语义：

- `ListPresetVoices` 与 `ListVoiceAssets` 只提供候选 inventory；selection truth 只有在
  Desktop 把某个 `VoiceReference`-compatible choice 固化进当前 conversation anchor
  workflow intent /
  execution evidence 后才成立
- selection 缺失表示“当前 workflow 没有合法 voice identity selection”；不得回退到
  provider 默认 voice、`audio.synthesize` 默认音色、或 voice picker 上次临时状态
- preset/custom voice selection 既可以作为 workflow 输入，也可以作为 workflow completion
  后当前 conversation anchor 的可复用 voice identity 结果；两种情况下都必须保持同一份 stable
  `VoiceReference` meaning
- 当前首包只 admit packet-bounded clone / design trigger semantics：trigger 必须是当前
  conversation anchor 内显式 admit 的 richer workflow intent，并保持与 source turn / action 的强关联
- clone / design trigger 可以授权 Desktop 启动 runtime voice workflow / scenario job，
  但 “trigger 已被 admit” 不等于 “workflow 已成功” 或 “voice asset 已存在”
- 若 trigger 需要当前 packet 之外的 consent、ownership、policy、或跨 anchor /
  standalone voice
  library 管理 semantics，必须留给后续 authority；缺少这些 required semantics 时必须
  fail-close，而不是偷渡到 helper / UI state 中实现

## D-LLM-051 — Workflow Return Path And Current-Thread Continuity

agent chat richer voice workflow 的 admitted return path 固定属于当前 conversation
anchor continuity。

固定约束：

- workflow submit、pending、completed、failed、canceled 的 desktop product projection 必须
  能恢复到 source conversation anchor / turn / beat / action relation，以及 admitted workflow type
- runtime scenario job lifecycle、事件流、`VoiceAsset` schema、与 `VoiceReference` schema
  仍由 runtime 拥有；本契约只拥有“这些 runtime-owned outputs 如何作为当前
  conversation anchor
  product continuity 被接回 Desktop” 的 truth
- workflow completion 可以把结果接回当前 conversation anchor 为：
  - workflow status / progress evidence
  - 一个新产生或已确认可复用的 voice identity
  - 一个 projected voice playback continuation
  但不得把结果投影成 detached conversation anchor、detached asset page success、或与 source turn
  无关的伪成功 artifact
- 当 workflow completion 需要向当前 conversation anchor 暴露 projected playback outcome 时，
  本契约拥有“为什么这属于当前 conversation anchor voice continuation” 的 product meaning；transport、
  cache、player lifecycle、以及底层 artifact mechanics 仍然只是 consumer
- 若 runtime 仅返回 job accepted、partial progress、或 incomplete asset evidence，
  Desktop 必须如实保留 pending / incomplete truth；不得伪造 final success、空 playback、
  guessed `VoiceReference`、或假定 asset 已可用
- scheduler、scenario poller、voice asset store、projection helper、或 current UI wording
  都不是 workflow return-path product owner

## D-LLM-052 — Deferred Scope And Non-Owners

以下内容在当前 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- wake-word
- background / lock-screen continuation
- proactive voice outreach
- broader voice-session redesign
- connected actions inside voice workflow
- camera / screenshare inside voice workflow
- 脱离当前 conversation anchor 的 standalone custom voice management / library semantics

具体约束：

- `NIMI_LIVE_DASHSCOPE_API_KEY`、`qwen3-tts-vc`、`qwen3-tts-vd`、或 live provider
  validation 只提供 execution-readiness evidence；它们不是 desktop product authority
- capability readiness、runtime route describe metadata、`ListPresetVoices`、
  `ListVoiceAssets`、scenario jobs、voice assets、helper UI、playback/cache plumbing、
  或 projected message rendering 都不是 richer voice workflow semantic owner
- narrower `audio.synthesize` playback semantics 继续由
  `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）拥有；broader live
  voice session semantics 继续由 `agent-chat-voice-session-contract.md`
  （`D-LLM-040` ~ `D-LLM-046`）拥有
- 若 downstream 需要更宽的 voice surface，必须先落新的 admitted desktop kernel
  authority；不得扩写 runtime workflow substrate、scenario job UI、voice picker、或
  voice helper 作为替代 owner

## Fact Sources

- `.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md` — resolved voice
  action envelope / prompt payload boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-executor-contract.md` — narrow
  `audio.synthesize` playback boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-session-contract.md` — broader voice
  session boundary
- `.nimi/spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `.nimi/spec/desktop/kernel/llm-adapter-contract.md` — runtime-aligned voice route
  and API boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime workflow / `VoiceReference`
  / `VoiceAsset` / scenario job / discovery boundary
- `sdk/src/mod/runtime-route.ts` — workflow capability metadata and independent
  capability key evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-turn-plan.ts` —
  current narrow single-voice-action / `audio.synthesize` evidence only
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-orchestration.ts` —
  current narrow voice executor wiring evidence only
- `apps/desktop/src/shell/renderer/features/chat/chat-agent-continuity.ts` —
  current same-anchor projection evidence only
- `apps/desktop/src/shell/renderer/features/chat/chat-conversation-capability-settings.tsx`
  — current workflow capability settings evidence only
- `.local/**` — local preflight evidence for richer workflow /
  voice identity routing decisions (non-authoritative supporting material only)
- `.local/**` — local packet baseline and admitted-scope evidence
  for this landing (non-authoritative supporting material only)
