# Agent Avatar Surface Contract

> Authority: Desktop Kernel

## Scope

定义 Desktop agent chat 中 avatar transient surface 的产品语义 authority。

本契约只拥有以下 avatar surface truths：

- current-anchor / current-surface `AvatarInteractionState`
- voice / message / lifecycle inputs 如何被归一化为 avatar 可消费信号
- chat shell 与 reusable `kit/features/avatar` 之间的语义 landing
- 哪些 avatar 语义仍然保持 surface-local，而不能上推为 runtime truth

本契约不拥有 runtime persistent `AgentPresentationProfile`、message/action envelope truth、
voice workflow / `VoiceReference` truth、broader voice session truth、或具体 renderer backend /
asset packaging truth。`.nimi/spec/runtime/kernel/agent-presentation-contract.md`
（`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent presentation truth；
`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
（`K-AGCORE-036` ~ `K-AGCORE-039`）继续拥有 runtime-owned transient turn /
presentation seam 与 current emotion projection；
`agent-chat-message-action-contract.md`、`agent-chat-voice-session-contract.md`、
`agent-chat-voice-workflow-contract.md` 继续拥有 message / voice 上游语义 truth；kit avatar
module 只消费本契约定义的 normalized surface semantics，不得反向成为 Desktop product owner。

## D-LLM-053 — Canonical Avatar Surface Authority Home

Desktop agent chat 的 canonical avatar transient surface owner 固定为本文件。

本 authority 固定拥有以下 product outputs：

- 当前 conversation anchor / surface 上 avatar 是否进入 `idle` / `thinking` / `listening` /
  `speaking` / `transitioning` 之类的交互阶段
- 当前 avatar emotion / action / attention cue 的 product meaning 是什么
- 上游 voice / message / lifecycle evidence 如何被降解为统一 avatar interaction signal
- chat shell 如何把这些 signals 提供给 reusable avatar stage，而不再私有化 avatar semantics

adjacent authority 边界固定为：

- `.nimi/spec/runtime/kernel/agent-presentation-contract.md`
  （`K-AGCORE-022` ~ `K-AGCORE-026`）继续拥有 persistent avatar profile / default voice truth
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
  （`K-AGCORE-036` ~ `K-AGCORE-039`）继续拥有 `runtime.agent.turn.*` /
  `runtime.agent.presentation.*` / `runtime.agent.state.emotion_changed`
  的 runtime-owned transient projection truth
- `agent-chat-behavior-contract.md`（`D-LLM-022` ~ `D-LLM-026b`）继续拥有 generic behavior truth
- `agent-chat-message-action-contract.md`（`D-LLM-027` ~ `D-LLM-033`）继续拥有 message/action truth
- `agent-chat-voice-session-contract.md`（`D-LLM-040` ~ `D-LLM-046`）继续拥有 broader voice session truth
- `agent-chat-voice-workflow-contract.md`（`D-LLM-047` ~ `D-LLM-052`）继续拥有 richer voice workflow / identity truth
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
  agent profile truth
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

## D-LLM-059 — Desktop Local Avatar Resource Registry Boundary

Desktop may own a local avatar resource registry for agent avatar rendering under
desktop-local storage.

The admitted registry truth is limited to desktop-local records such as:

- local `resource_id`
- resource `kind` (`vrm` or `live2d`)
- import-normalized storage location under `{nimi_data_dir}`
- desktop-local import status, validation status, and lightweight display metadata

Fixed rules:

- registry truth is desktop-local only; it must not be promoted into runtime canonical
  `AgentPresentationProfile` truth by default
- imported avatar assets must not remain product-truth pointers to Downloads or other
  arbitrary external folders once import succeeds
- registry records may carry desktop-oriented metadata needed for import management,
  but they must not silently become a second runtime-owned presentation profile schema
- renderer-local cache handles, temporary object URLs, or ad hoc fallback file paths
  must not become the canonical local resource key

## D-LLM-060 — Agent Local Avatar Binding Boundary

Desktop may bind a local avatar resource to a specific `agentId` for desktop-local
agent chat rendering.

The admitted binding truth is limited to:

- binding record identity
- bound `agentId`
- referenced local avatar `resource_id`
- desktop-local status and update timestamps

Fixed rules:

- the binding is desktop-local surface truth, not runtime-owned agent identity truth
- a local binding may override runtime presentation for desktop rendering, but it does
  not mutate runtime persistent agent presentation by default
- local binding must remain explicitly per-agent; renderer code must not infer or reuse
  one agent's local avatar binding for another agent
- absence of a local binding must fail back to the canonical precedence contract
  instead of fabricating a remembered local override

## D-LLM-061 — Avatar Render Precedence Contract

Desktop agent avatar rendering must resolve avatar presentation in the following
canonical order:

1. explicit desktop-local avatar binding override
2. runtime-owned `AgentPresentationProfile`
3. ordinary avatar fallback

Fixed rules:

- this precedence must be owned canonically here; rail components, shell adapters,
  view-model helpers, and renderer helpers must not each invent their own override order
- desktop-local binding only changes render selection; it does not become new runtime
  truth or change broader agent-chat behavior semantics
- fallback image/avatar routes remain valid only when neither desktop-local binding nor
  runtime presentation yields an admitted live-avatar presentation

## D-LLM-062 — Desktop Local Import Scope And Storage Boundary

Desktop settings/import surfaces may import:

- a VRM file
- a Live2D runtime directory or admitted manifest root

Fixed rules:

- imported resources must be normalized under desktop-owned storage rooted at
  `{nimi_data_dir}` before they become admitted local avatar resources
- import authority remains desktop-local and must not silently imply runtime canonical
  support for Live2D, VRM package management, or cross-app resource portability
- import/admission of a local `live2d` resource record only authorizes desktop-local
  storage and binding semantics; renderer/runtime support still requires separate
  admitted implementation
- desktop-local import UX, storage lifecycle, and binding mutation may consume this
  contract, but `kit/features/avatar` remains a consumer of resolved presentation inputs
  rather than an owner of import or storage truth

## D-LLM-062a — Desktop-Local Live2D Viewport Boundary

When avatar render resolution selects a desktop-local bound resource with
`kind: live2d`, desktop owns the first shipped desktop agent chat Live2D
viewport lifecycle for the active avatar-stage surface.

Fixed rules:

- desktop may ship the first concrete Live2D viewport implementation locally while
  consuming the admitted reusable stage semantics from `kit/features/avatar`
- the desktop-local Live2D viewport is a renderer/backend consume boundary only; it
  must not become a second owner of persistent presentation truth, local binding truth,
  or generic chat behavior truth
- desktop owns Live2D runtime loading, stage lifecycle, and load-fail handling for the
  active desktop avatar-stage surface; runtime does not own those responsibilities by
  default
- a resolved `live2d` presentation must dispatch to a Live2D backend path rather than
  probing the VRM viewport first or treating the asset as a generic file attachment
- desktop-local viewport lifecycle must remain surface-local and teardown deterministically
  on invalid bounds, agent switch, thread switch, or surface close

## D-LLM-062b — Live2D First-Wave Parity, Fallback, And Stop Line

The first admitted Live2D render wave is intentionally narrower than generic avatar or
future VRM interaction scope.

Fixed rules:

- first-wave Live2D support is accepted only when desktop can render a bound `live2d`
  resource in the active desktop avatar-stage surface with readable `idle` and
  `speaking` states
- deterministic fail-close is required when the bound Live2D asset is invalid, missing,
  or the desktop-local runtime support is unavailable; renderer code must not leave a
  blank half-loaded stage, pseudo-success poster, or undefined mixed-backend state
- when a desktop-local `live2d` binding fails to yield an admitted live presentation,
  desktop must continue the canonical render precedence contract instead of inventing a
  special fallback order; the binding path fails closed first, then desktop continues to
  runtime `AgentPresentationProfile`, and only then to ordinary avatar fallback if
  runtime presentation also does not yield an admitted live-avatar presentation
- first-wave parity does not admit pointer interaction parity, click / poke reactions,
  camera choreography, renderer-baseline redesign, richer motion packs, or authoring
  workflows
- Live2D Wave 1 must remain an agent-presence surface rather than widening into a raw
  Cubism model viewer or backend-specific inspection tool

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

Desktop agent chat surface organizes its visual truth as a fixed four-layer stack
and separates persistable cosmetic preferences from transient interaction truth.

The admitted layer stack is, from bottom to top:

1. app-native glass base layer — the desktop app's established in-window glass
   aesthetic; it is an app-internal visual, not a transparent passthrough to the
   host desktop
2. optional in-app backdrop mask layer — sourced from the admitted per-agent
   backdrop binding (see `desktop_agent_backdrop_store`); the mask image is an
   in-app asset imported by the user, not a desktop wallpaper projection;
   defaults to fully transparent when absent
3. avatar layer — Live2D / VRM / fallback viewport owned by this contract,
   rendered as an app-internal avatar/stage consume layer. For the admitted
   desktop obstacle-aware transcript-flow line, this layer may influence
   transcript width only through the single shell-owned occupancy rectangle
   defined by `D-SHELL-034`; this contract does not own transcript geometry,
   admitted occupancy rectangle truth, or transcript reflow policy. No parallel
   overlay-only fallback mode remains admitted for that desktop line.
4. component layer — chat shell interactive widgets (nav, transcript, composer,
   contacts rail); the chat domain occupies the full middle area between the
   left navigation and the right contacts rail, not a sub-column beside the
   avatar

Fixed rules:

- layer 0–2 must not capture pointer events above what layer 3 requires to
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
  runtime, or mod public surface until a separate authority admits it
- placement persistence and transform transience together must not invent
  camera choreography, cross-thread avatar synchronization, or standalone
  editor surface; those remain deferred per `D-LLM-058`

## Fact Sources

- `.nimi/spec/runtime/kernel/agent-presentation-contract.md` — runtime persistent presentation truth and non-owner boundary
- `.nimi/spec/desktop/kernel/agent-chat-behavior-contract.md` — generic behavior / experience semantics
- `.nimi/spec/desktop/kernel/agent-chat-message-action-contract.md` — message/action envelope semantics
- `.nimi/spec/desktop/kernel/agent-chat-voice-session-contract.md` — broader voice session semantics
- `.nimi/spec/desktop/kernel/agent-chat-voice-workflow-contract.md` — richer workflow / voice identity semantics
- `.nimi/spec/platform/kernel/kit-contract.md` — reusable `kit/features/avatar` admission and ownership hardcut
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/design.md` — topic-local avatar landing rationale
- `.nimi/local/report/ongoing/2026-04-17-desktop-agent-local-avatar-resource-binding/design.md` — desktop-local avatar resource registry / binding authority rationale
- `.nimi/local/report/proposal/2026-04-17-desktop-agent-live2d-render-integration/design.md` — Live2D backend admission, fallback, and ownership rationale
- `.nimi/local/report/closed/2026-04-17-desktop-agent-vrm-pointer-interaction/design.md` — stage-local pointer Wave 1 rationale now superseded by app-level attention redesign
- `.nimi/local/report/ongoing/2026-04-19-desktop-app-level-avatar-attention-context/design.md` — app-level attention projection redesign rationale
