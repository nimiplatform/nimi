# Agent Chat Voice Session Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 broader voice session 的产品语义 authority。

本契约只拥有以下 voice session truths：

- explicit user-triggered voice session entry / exit semantics
- same-thread text / voice continuity semantics
- admitted listening-mode semantics
- interruption / barge-in semantics
- transcript / caption visibility and persistence semantics
- current allow / deny boundary for tools, media actions, and app actions

本契约不拥有 resolved `voice` action existence truth、`promptPayload` truth、
`audio.synthesize` playback truth、capability route truth、runtime voice workflow
truth、richer voice workflow / voice identity truth、state persistence mechanics、或
background / proactive continuation truth。
`agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 `voice`
action envelope 与 model-generated prompt payload truth；
`agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）继续拥有 resolved
`voice` action 的 playback-ready artifact outcome truth；
`agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer
voice workflow admission、voice identity / `VoiceReference`、preset/custom voice
selection、以及 workflow return-path truth；
`conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
`audio.synthesize`、`audio.transcribe`、`voice_workflow.*` 的 readiness truth；
`llm-adapter-contract.md`（`D-LLM-005`）继续拥有 runtime-aligned TTS / STT route 和 API
surface；`.nimi/spec/runtime/kernel/voice-contract.md` 继续拥有 `voice_workflow.*` 与 voice
asset lifecycle truth。

voice session shell、capture plumbing、STT consumer、scheduler、notification、bridge、
playback helper、或 current UI wording 只能消费这些上游 resolved truth；不得重算、
补造、或覆盖 broader voice session product semantics。

## D-LLM-040 — Canonical Voice Session Authority Home

Desktop agent chat 的 canonical broader voice session owner 固定为本文件。

本 authority 固定拥有以下 product outputs：

- 当前 thread 是否进入一个 explicit user-triggered voice session
- 该 session 的 start / active / exit product meaning 是什么
- live voice use 与同 thread text continuity 如何共存
- 当前 admitted listening mode 是什么
- 哪些 richer live-assistant voice surfaces 仍然保持 deferred

adjacent authority 边界固定为：

- `agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 resolved
  `voice` action existence、relation、以及 `promptPayload` truth
- `agent-chat-voice-executor-contract.md`（`D-LLM-034` ~ `D-LLM-039`）继续拥有 resolved
  `voice` action 如何成为 playback-ready speech artifact outcome 的 truth
- `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer
  workflow admission、voice identity / `VoiceReference`、preset/custom voice
  selection、以及 workflow result return-path truth
- `conversation-capability-contract.md`（`D-LLM-015` ~ `D-LLM-021`）继续拥有
  `audio.synthesize`、`audio.transcribe`、`voice_workflow.*` projection / snapshot truth，
  而不是 session product meaning
- `llm-adapter-contract.md`（`D-LLM-005`）继续拥有 runtime-aligned TTS / STT route 和 API
  truth
- `.nimi/spec/runtime/kernel/voice-contract.md`（`K-VOICE-*`）继续拥有
  `voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`、preset/custom voice discovery、voice
  asset 与 scenario job truth

若任一 consumer 需要 broader voice session 决策，必须先读取同一份 desktop-owned
session semantics；不得从 capability readiness、voice list、capture state、playback
helper、scheduler、UI copy、或 runtime media metadata 再派生一份 parallel product
truth。

## D-LLM-041 — Explicit Session Entry / Exit And Same-Thread Continuity

broader voice session 的当前 entry semantics 固定为 explicit user-triggered。

固定语义：

- voice session 只能由当前 thread 内的明确用户交互进入；不得由 route readiness、
  resolved delayed beat、notification、heartbeat、timer、或 background wake 自动触发
- voice session 属于当前 thread continuity；不得在当前 admitted route 中被解释为独立 thread、独立
  assistant mode、或绕开既有 text / beat continuity 的平行 session
- 进入 session 后，text turn、voice playback beat、以及后续 voice input 仍属于同一
  conversation continuity surface；session 不得抹除 source thread / turn / beat relation
- exit 必须是显式 user action、明确 session teardown signal、或 host-level deterministic
  stop reason；capture / playback helper 不得无限保持 session "stays on" 的 implied truth
- 若 entry / exit evidence 不合法、不可恢复、或无法绑定到当前 thread，必须 fail-close；
  不得伪造 active session

当前 admitted voice session route 仍不承认 background continuation、
lock-screen continuation、proactive re-contact、或 wake-word 恢复。

## D-LLM-042 — Admitted Listening Mode Boundary

当前 admitted listening modes 固定为：

- `push-to-talk`
- foreground `hands-free`

固定约束：

- 用户仍然必须通过明确 user action 进入 voice session；session active 不等于
  wake-word、background listening、或 lock-screen continuation 已被 admit
- `push-to-talk` 继续要求明确按住 / 按下说话动作触发输入 capture
- foreground `hands-free` 允许在当前 foreground active session 内不依赖按住 / 按下
  手势持续进入下一轮 listening，但它不等于 wake-word、background reopen、或 lock-screen
  continuation
- `audio.transcribe` healthy、capture plumbing ready、或 current shell 能显示 microphone
  state，不得被解释为 wake-word 或 background continuation 已被 admit
- 若 downstream 需要 wake-word、background continuation、或更宽的 always-on voice
  surface，必须先由新的 admitted desktop kernel authority 显式落地；不得扩写本契约或
  helper surface 作为替代 owner

## D-LLM-043 — Interruption / Barge-In Semantics

当前 admitted broader voice session route 明确承认 interruption / barge-in product semantics，
但 scope 仅限当前 thread 内的 foreground session。

固定语义：

- 当 session 处于 foreground active 状态时，新的用户 voice input 可以中断当前正在
  output 的 agent voice playback 或等待中的 capture cycle
- interruption / barge-in 只表达 foreground session 内的 turn ownership切换；它不等于
  background continuation、auto re-entry、或 proactive contact authorization
- playback helper、stream transport、capture driver、或 voice executor 只能记录
  interrupted / stopped lifecycle evidence；不得自行为 session 创造另一份 barge-in
  truth
- 若 interruption evidence 缺失、冲突、或无法绑定到当前 foreground session，必须
  fail-close 为 stop / no-continue，而不是 guessed auto-resume

## D-LLM-044 — Transcript / Caption Visibility And Persistence

broader voice session 对 transcript / caption 的当前 product semantics 固定为：

- transcript / caption 可以存在并被持久化为同 thread conversation evidence
- transcript reveal 必须是 explicit user-visible rule，不得默认因为 session active 就
  自动暴露全部 transcript
- live caption 与 persisted transcript 属于同一 desktop product authority boundary；它们
  的 visibility / reveal semantics 由本契约定义，不由 playback helper、capture helper、
  UI local component state、或 runtime transcribe result 拥有

固定约束：

- transcript / caption 必须可恢复到当前 thread / turn / beat / session relation；不得
  变成 detached inspection artifact
- transcript 是否 reveal、何时 reveal、以及 reveal 后如何继续保持 thread evidence，
  必须遵循同一份 desktop session rule；consumer 不得各自重算一份 hidden / shown truth
- 缺合法 relation、缺 required transcript fields、或无法稳定绑定当前 thread 时必须
  fail-close；不得用空 transcript、guessed transcript、或 helper-owned fallback 文本宣告
  success

## D-LLM-045 — Deferred Scope And Non-Owners

以下内容在本次 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- wake-word
- background / lock-screen continuation
- connected app actions inside voice session
- camera / screenshare inside voice session
- custom voice authoring / cloning

具体约束：

- current UI wording、host snapshot、sidebar toggle、capture helper、STT plumbing、
  capability readiness、scheduler、bridge、notification 都不是 broader voice session
  product owner
- richer workflow / voice identity semantics 若已被 admit，固定由
  `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）拥有，而不是本契约
- admitted broader voice session 不等于 richer live-assistant voice 已全面落地；当前 route
  只承认 explicit entry、same-thread continuity、admitted foreground listening modes、
  interruption、以及 transcript / caption rules
- 若 downstream 需要 richer voice surface，必须先落新的 admitted desktop kernel
  authority；不得扩写本契约、voice executor、capability contract、或 runtime workflow
  contract 作为替代 owner

## D-LLM-046 — Foreground Hands-Free Lifecycle Boundary

foreground `hands-free` 只在已经显式进入的当前 foreground voice session 内被 admit。

固定语义：

- `hands-free` 必须由明确 user action 开启；route readiness、wake detector、
  silence detector、scheduler、heartbeat、notification、或 capture helper 都不得自行把
  session 提升为 `hands-free`
- 在当前 foreground active session 内，`hands-free` 可以通过 end-of-utterance /
  silence-style turn cycling 继续等待下一次用户语音输入；这只表达同一 foreground session
  内的持续 listening，不等于 wake-word 或 idle-after-stop 的 auto re-entry
- 一旦 active thread 改变、app 失去 foreground、screen 锁定、host suspend、microphone
  permission 丢失、或 explicit exit 发生，`hands-free` 必须 deterministic teardown 或降级为
  non-listening；不得静默继续在 background 保持 listening
- 若 lifecycle evidence 缺失、冲突、或无法稳定绑定当前 foreground session，必须
  fail-close 为 stop / no-continue，而不是 guessed continue

## Fact Sources

- `.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md` — resolved voice
  action / prompt payload boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-executor-contract.md` — resolved voice
  playback / artifact outcome boundary
- `.nimi/spec/desktop/kernel/conversation-capability-contract.md` — capability
  projection / execution snapshot boundary
- `.nimi/spec/desktop/kernel/llm-adapter-contract.md` — runtime-aligned TTS / STT
  route and API boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime voice workflow / voice
  asset boundary
- `.nimi/spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — richer voice
  workflow / voice identity boundary
- `apps/desktop/src/shell/renderer/features/chat/chat-human-adapter.tsx` —
  current stale "voice session mode stays on" wording evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-human-canonical-components.tsx`
  — current transcript reveal surface evidence
- `apps/desktop/src/shell/renderer/features/chat/chat-mode-host-types.ts` —
  host transcript / stage shell evidence
- `.local/**` — local preflight evidence for broader voice session
  admission and defer decisions (non-authoritative supporting material only)
