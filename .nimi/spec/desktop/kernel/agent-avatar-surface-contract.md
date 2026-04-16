# Agent Avatar Surface Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 avatar transient surface 的产品语义 authority。

本契约只拥有以下 avatar surface truths：

- current-thread / current-surface `AvatarInteractionState`
- voice / message / lifecycle inputs 如何被归一化为 avatar 可消费信号
- chat shell 与 reusable `kit/features/avatar` 之间的语义 landing
- 哪些 avatar 语义仍然保持 surface-local，而不能上推为 runtime truth

本契约不拥有 runtime persistent `AgentPresentationProfile`、message/action envelope truth、
voice workflow / `VoiceReference` truth、broader voice session truth、或具体 renderer backend /
asset packaging truth。`.nimi/spec/runtime/kernel/agent-presentation-contract.md`
（`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent presentation truth；
`agent-chat-message-action-contract.md`、`agent-chat-voice-session-contract.md`、
`agent-chat-voice-workflow-contract.md` 继续拥有 message / voice 上游语义 truth；kit avatar
module 只消费本契约定义的 normalized surface semantics，不得反向成为 Desktop product owner。

## D-LLM-053 — Canonical Avatar Surface Authority Home

Desktop agent chat 的 canonical avatar transient surface owner 固定为本文件。

本 authority 固定拥有以下 product outputs：

- 当前 thread / surface 上 avatar 是否进入 `idle` / `thinking` / `listening` /
  `speaking` / `transitioning` 之类的交互阶段
- 当前 avatar emotion / action / attention cue 的 product meaning 是什么
- 上游 voice / message / lifecycle evidence 如何被降解为统一 avatar interaction signal
- chat shell 如何把这些 signals 提供给 reusable avatar stage，而不再私有化 avatar semantics

adjacent authority 边界固定为：

- `.nimi/spec/runtime/kernel/agent-presentation-contract.md`
  （`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent avatar profile / default voice truth
- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026b`）继续拥有 generic behavior truth
- `agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 message/action truth
- `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）继续拥有 broader voice session truth
- `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer voice workflow / identity truth
- `kit/features/avatar` 只消费 normalized avatar surface inputs；不得提升为 Desktop semantic owner

## D-LLM-054 — AvatarInteractionState Boundary

`AvatarInteractionState` 是 current-thread / current-surface 的 transient state，不是 runtime
canonical truth。

最小 admitted surface 必须能表达：

- `phase`
- optional `emotion`
- optional `actionCue`
- optional `attentionTarget`
- optional `visemeId`
- optional `amplitude`

固定约束：

- 该 state 必须始终可恢复到当前 thread、当前 surface instance、以及当前 agent projection relation
- 它可以由多个上游信号归一化而成，但归一化后只能作为 transient surface truth 使用
- renderer-local interpolation、physics、blend-shape implementation detail 可以继续存在，但不得冒充 canonical `AvatarInteractionState`
- 缺少合法 thread/surface/agent relation 时必须 fail-close；不得猜测一份 active avatar state

## D-LLM-055 — Signal Normalization Boundary

Avatar surface 只能消费已 admitted 的上游 semantic evidence，并在 Desktop 边界内归一化。

允许的上游 signal family 包括：

- behavior / turn posture outputs
- message-action / follow-up execution lifecycle
- voice session listening / speaking lifecycle
- voice workflow progress / return-path continuity
- runtime lifecycle / autonomy projection evidence

固定约束：

- normalization 必须先消费上游 admitted truth，再生成 avatar-specific signal；不得在 avatar path 上重判上游语义
- `visemeId` / `amplitude` 之类的 speech-local cues 只能表达当前 surface animation input，不得倒写成 runtime-owned voice or agent truth
- downstream avatar stage、chat rail、shell-local animator、或 playback helper 都不得各自再派生第二套 phase / emotion / attention truth

## D-LLM-056 — Chat Landing And Reusable Consumer Boundary

Desktop agent chat 是 avatar surface 的首个 consumer，但不是 avatar semantics 的私有 owner。

固定语义：

- chat shell 必须通过 reusable `kit/features/avatar` surface 消费 normalized presentation +
  interaction inputs；不得在 chat 私有组件内重新定义一套 avatar semantic contract
- Desktop 仍然拥有 placement、permissions、thread continuity、和 shell orchestration
  truth；kit avatar module 只拥有 reusable renderer/headless contract
- right-rail、inline stage、popover stage、或 future multi-surface placement 可以不同，
  但它们必须消费同一份 `AvatarInteractionState` authority

## D-LLM-057 — Surface Scope And Persistence Boundary

Avatar surface truth 默认只属于当前 renderer surface，不自动升级为 cross-thread 或
cross-session persistence truth。

固定约束：

- surface close、thread change、agent switch、或 permission loss 时，avatar interaction state
  必须 deterministic teardown 或重建；不得静默沿用上一 surface 的 active cues
- 当前 admitted route 不允许把 avatar interaction snapshots 直接持久化为 runtime-owned
  agent profile truth
- app 若需要持久化 avatar placement 或 cosmetic preferences，必须与本契约中的 transient
  interaction state 明确分层

## D-LLM-058 — Deferred Scope And Non-Owners

以下内容在当前 landing 中保持显式 deferred，不得由本契约或其 consumers 借道 admit：

- standalone avatar editor / authoring workflow
- background avatar continuation
- camera choreography truth
- renderer-specific physics or mocap protocol truth
- cross-thread avatar stage synchronization

具体约束：

- static image rail、voice meter、playback helper、或 renderer implementation evidence 都不是 avatar surface semantic owner
- runtime presentation profile、voice workflow inventory、或 app-local animation library 都不得被误写成本契约的 truth source
- 若 downstream 需要更宽的 avatar product surface，必须先落新的 admitted desktop kernel authority；不得扩写本契约或 kit module 作为替代 owner

## Fact Sources

- `.nimi/spec/runtime/kernel/agent-presentation-contract.md` — runtime persistent presentation truth and non-owner boundary
- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — generic behavior / experience semantics
- `.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md` — message/action envelope semantics
- `.nimi/spec/desktop/kernel/agent-chat-voice-session-contract.md` — broader voice session semantics
- `.nimi/spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — richer workflow / voice identity semantics
- `.nimi/spec/platform/kernel/kit-contract.md` — reusable `kit/features/avatar` admission and ownership hardcut
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/design.md` — topic-local avatar landing rationale
