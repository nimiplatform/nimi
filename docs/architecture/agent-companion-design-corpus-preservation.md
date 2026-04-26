# Agent Companion Design Corpus Preservation

This document is the tracked body-level preservation artifact for the original
Agent Companion substrate design corpus. It preserves the durable design body
from the closed evidence files without making those lifecycle reports active
authority again.

Normative authority remains in `.nimi/spec/**` and admitted
`apps/**/spec/**`. This document is a reader, audit, and planning artifact.
Implementation topics must cite active spec anchors for product requirements
and use this page only for retained design memory, stop lines, and downstream
gap context.

This page does not reopen broad APML, broad Event API, wildcard broker
semantics, SDK-owned app-event emission, direct app routing, or legacy shims.

## Label Taxonomy

Each preserved body record uses these labels:

- `active_authority_pointer`: stable spec or app-local spec that owns current
  normative product truth.
- `retained_evidence`: design body retained for future audit and recovery.
- `deferred_extension_intent`: future-capable design that is not required by
  the current continuation line.
- `implementation_open`: admitted product work that remains downstream.
- `blocked`: cannot be implemented without parent manager and active-authority
  redesign.
- `superseded`: replaced by narrower or different current authority.
- `retired`: intentionally outside the current continuation line.

## Inventory Completeness

The preserved corpus covers the design families identified by the parent
manager:

| Source body | Preserved section |
| --- | --- |
| `apml-design.md` | APML wire format |
| `apml-llm-compliance.md` | APML LLM compliance |
| `activity-ontology.md` | AgentActivity ontology |
| `event-hook-contract.md` | Event and Hook contract |
| `desktop-event-spec.md` | Desktop app event convention |
| `avatar-event-spec.md` | Avatar app event convention |
| `agent-interaction-flow.md` | Agent Interaction Flow |
| `sdk-event-api.md` | SDK Event API design |
| `nimi-agent-script.md` | NimiAgentScript creator runtime |
| `presentation-timeline.md` | PresentationTimeline |
| `state-event-bus.md` | Cross-surface state projection |
| `emotion-state.md` | Emotion as first-class state |
| `dual-entry-session.md` | Dual-entry session consistency |
| `wave-6a-first-demo-script.md`, `wave-6a-operator-checklist.md` | First 30 seconds companion demo |
| Wave 6B EPP packet, audit, and closeout | Embodiment Projection Protocol |
| `local-sdk-consumer-trust-posture.md` and Wave 6C evidence | Local SDK Consumer Trust Posture |
| `spec-mounting.md` and continuation authority alignment evidence | Spec mounting |
| Avatar interaction packets plus avatar/NAS evidence | Avatar click, hover, drag, and physics interaction |
| Avatar carrier migration packets plus Live2D branch evidence | Existing Live2D asset adaptation and compatibility tiers |

## APML Wire Format

Source body: `apml-design.md`.

### Body Preserved

The original APML body defined XML-like model output as the agent-facing wire
format. Its durable design body is:

- APML is model-facing syntax. Apps should consume normalized runtime
  projection, not raw parser events.
- Public chat output uses a message envelope with user-visible text and bounded
  inline cues such as `emotion` and `activity`.
- Image and voice actions are post-turn actions with required prompt text.
- Time and event hooks propose future follow-up intent, but runtime admission
  owns scheduling truth.
- Runtime-private dialects may carry sidecar/life/canonical extraction body
  such as posture candidates, hook cancellation, memory candidates, and life
  summaries.
- Parser commit semantics must be transactional: malformed or conflicting
  model output fails closed instead of partial-success projection.
- The old design body also explored direct motion, expression, pose, lookat,
  prosody, media payload, routing, metadata, and extension namespace syntax.
  Those remain preserved as design memory, not current public APML scope.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`.
- `retained_evidence`: XML-like APML, strict grammar, one public message
  envelope, optional emotion/activity cues, image/voice actions, narrow
  time/event HookIntent proposals, runtime-private sidecar/life/canonical roots,
  and fail-closed parser/commit posture.
- `deferred_extension_intent`: richer media payloads, prosody, choreography,
  direct presentation hints, extension namespaces, and future private dialect
  growth after active authority admits them.
- `implementation_open`: parser, projection, compliance fixtures, negative
  tests, provider-neutral enforcement, typed runtime projection, and SDK/app
  consumption evidence.
- `blocked`: compound hooks, app/world event triggers, model-owned surface
  routing, notification semantics, wildcard event semantics, and extension
  namespaces as public APML.
- `superseded`: public posture/status mutation, public memory read/write tags,
  raw parser events as app contract, JSON compatibility, lenient repair, and
  prompt-only compliance as sufficient proof.
- `retired`: public `think` output, in-band model/version metadata, and public
  video action for this continuation line.

## APML LLM Compliance

Source body: `apml-llm-compliance.md`.

### Body Preserved

The compliance body treated APML as a strict model-output discipline, not a
best-effort formatting suggestion:

- Prompts must teach the bounded APML contract with a compact reference card.
- Providers may use grammar-constrained decoding or prompt constraints where
  available, but provider-specific controls cannot bypass the same parser.
- Parser acceptance, parse-error visibility, and negative fixtures are product
  evidence; valid-looking prompt examples alone are not enough.
- The compliance posture is provider-neutral and multi-model. No provider or
  model hardcoding is admitted.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`.
- `retained_evidence`: reference-card teaching, strict APML-only output,
  grammar-constrained decoding as an optional enforcement aid, parse-health
  telemetry, and fixture-based compliance proof.
- `deferred_extension_intent`: provider-specific optimization and fine-tuning
  after the common parser/projection path is proven.
- `implementation_open`: prompt module, fixture corpus, provider matrix,
  parse-error evidence, and negative compliance tests.
- `blocked`: any compliance path that accepts non-APML output or weakens parser
  rejection.
- `superseded`: JSON fallback, Markdown/prose wrappers, silent repair, and
  prompt-only compliance proof.
- `retired`: unknown-tag stripping and hidden compatibility modes.

## AgentActivity Ontology

Source body: `activity-ontology.md`.

### Body Preserved

The ontology body preserved a canonical presentation-intent vocabulary:

- Activity is presentation intent, distinct from emotion truth, direct motion
  ids, direct expression assets, and long-lived posture action families.
- The core taxonomy had three categories: emotion, interaction, and state.
- The core list had twenty items:
  `happy`, `sad`, `shy`, `angry`, `surprised`, `confused`, `excited`,
  `worried`, `embarrassed`, `neutral`, `greet`, `farewell`, `agree`,
  `disagree`, `listening`, `thinking`, `idle`, `celebrating`, `sleeping`, and
  `focused`.
- Emotion activities except `neutral` may carry intensity; interaction and
  state activities do not.
- The extended body retained ten optional `ext:` activities:
  `ext:apologetic`, `ext:proud`, `ext:lonely`, `ext:grateful`,
  `ext:acknowledging`, `ext:encouraging`, `ext:teasing`, `ext:resting`,
  `ext:playing`, and `ext:eating`.
- Custom activities were designed for `mod-<id>:<name>` namespaces with
  manifest-declared category and fallback behavior.
- Renderer mapping used metadata first, naming convention second, `Idle`
  fallback third, and no-op/log fallback last.
- Activity and posture action-family remain independent dimensions.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`,
  `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml`, and
  `apps/avatar/spec/kernel/tables/activity-mapping.yaml`.
- `retained_evidence`: the core/extended taxonomy, intensity rules, mapping
  fallback chain, prompt guidance, lifecycle duration guidance, and activity
  versus posture boundary.
- `deferred_extension_intent`: official extended activities, mod custom
  namespace admission, richer renderer mapping metadata, and backend-specific
  conventions.
- `implementation_open`: unknown-id rejection, SDK/Desktop/App consume proof,
  Avatar/NAS mapping acceptance, custom namespace posture, and negative tests.
- `blocked`: free-form model-generated activity ids without ontology admission.
- `superseded`: renderer-local activity ontology as source of truth.
- `retired`: Live2D-specific categories as platform semantics.

## Event And Hook Contract

Source body: `event-hook-contract.md`.

### Body Preserved

The original event body was broad. The durable parts are retained as a design
map while active authority remains narrower:

- Event names used `<owner>.<subject>.<action>` naming to make ownership
  explicit.
- Layers were separated into Runtime Agent, APML Parser, App Surface, and
  System. Runtime and system were platform-owned; app surface events were
  per-app conventions.
- Parser events were raw proposals; runtime projection events were admitted
  outcomes after validation and normalization.
- Typed payloads, versioning, ordering, rate tiers, and app manifests were
  treated as required for any future event system.
- Cross-layer bridging mapped APML parser output into runtime-owned
  `runtime.agent.*` projection families, then apps consumed runtime projection.
- Before-events, wildcard subscriptions, and a unified broker were part of the
  closed broad design body but are not current active authority.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`,
  `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`, and
  `.nimi/spec/runtime/kernel/app-messaging-contract.md`.
- `retained_evidence`: explicit owner naming, typed payload posture, parser to
  runtime projection bridge, app-local event conventions, rate/ordering design
  considerations, and namespace governance.
- `deferred_extension_intent`: a future general app-event broker, third-party
  app namespace registry, subscription authorization, and mod subscription
  policy.
- `implementation_open`: narrow HookIntent lifecycle implementation and typed
  runtime projection consumption where active authority already admits it.
- `blocked`: broad Event API, wildcard broker, cancellable before-events,
  SDK-owned app-event emission, hook effects into arbitrary app/media actions,
  and app-visible raw `apml.*` event streams.
- `superseded`: the closed broad event contract as current product authority.
- `retired`: lifecycle topic taxonomies as dispatchable implementation spec.

## Desktop App Event Convention

Source body: `desktop-event-spec.md`.

### Body Preserved

The desktop body enumerated a desktop-local event namespace:

- `desktop.user.*` for click, double-click, right-click, hover, leave, drag,
  typing, voice input, and idle transitions.
- `desktop.chat.*` for chat mount/unmount, message send/receive, thread
  change, and input focus changes.
- `desktop.app.*` for app start, readiness, focus, visibility, and shutdown.
- A manifest shape captured ownership, events, cross-app subscriptions, and
  rate tiers.
- Cross-app subscriptions were intended as UI coordination cues, not runtime
  ingress or platform event truth.

### Labels

- `active_authority_pointer`: `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
  and `.nimi/spec/runtime/kernel/app-messaging-contract.md`.
- `retained_evidence`: desktop shell cue taxonomy, app lifecycle convention,
  manifest posture, and first-party coordination intent.
- `deferred_extension_intent`: richer desktop namespace registry and UI cue
  coordination after app messaging authority admits it.
- `implementation_open`: shell acceptance around handoff, dual-entry, and real
  demo paths.
- `blocked`: desktop-owned runtime/app event bus and app-level REST bypass.
- `superseded`: closed `desktop.*` broad namespace as platform event truth.
- `retired`: Desktop as active avatar carrier owner.

## Avatar App Event Convention

Source body: `avatar-event-spec.md`.

### Body Preserved

The avatar body enumerated app-local avatar events:

- `avatar.user.*` for click, double-click, right-click, hover, leave, and drag.
- Avatar lifecycle and rendering events for app mount, model load/switch,
  activity start/end/cancel, motion play/complete, expression change, pose,
  lookat, lipsync frames, and speak start/chunk/end/interrupt.
- `avatar.app.*` for app start, readiness, focus, visibility, and shutdown.
- The app-local manifest described model capabilities, event rates, and
  cross-app subscriptions to desktop and runtime projection cues.
- Backend-specific renderer details stayed behind the Avatar app boundary.

### Labels

- `active_authority_pointer`: `apps/avatar/spec/kernel/avatar-event-contract.md`.
- `retained_evidence`: app-local `avatar.*` event convention, user
  interaction vocabulary, render/lipsync/speak lifecycle vocabulary, manifest
  posture, and backend boundary.
- `deferred_extension_intent`: renderer-specific event details and future
  backend branches.
- `implementation_open`: click/hover/drag physics feedback, NAS response,
  hit-region negative evidence, and voice/lipsync Phase 2 proof.
- `blocked`: Avatar-owned platform event ontology or cross-app broker
  semantics.
- `superseded`: closed broad avatar event spec where it conflicts with
  app-local active authority.
- `retired`: backend-specific event shapes as platform API.

## Agent Interaction Flow

Source body: `agent-interaction-flow.md`.

### Body Preserved

The interaction-flow body described the full companion chain:

- Runtime owns APML parsing, model execution, canonical memory, hook scheduling,
  state projection, and typed event projection.
- SDK consumes runtime truth and hides transport details.
- Desktop owns chat shell UX, launch, and handoff orchestration.
- Avatar owns Live2D/embodiment carrier behavior and app-local event handling.
- Model metadata can provide mapping data, but it does not own product truth.
- User turns flow through explicit runtime turn requests, then runtime projects
  typed state/presentation/turn events consumed by SDK, Desktop, and Avatar.
- Double-entry session consistency, interrupt propagation, multi-agent
  retargeting, rendering abstraction, and demo proof were recorded as required
  downstream evidence.

### Labels

- `active_authority_pointer`: `docs/architecture/agent-companion-core-protocol.md`
  plus the Runtime, SDK, Desktop, and Avatar anchors listed there.
- `retained_evidence`: component responsibility matrix, runtime-first flow,
  explicit SDK consume boundary, desktop handoff role, avatar carrier role, and
  e2e proof expectations.
- `deferred_extension_intent`: third-party app ecosystem policy and additional
  rendering backend abstraction.
- `implementation_open`: e2e proof across chat, voice, avatar, state,
  interruption, multi-agent retargeting, and demo paths.
- `blocked`: app-local carrier flow redefining Runtime, SDK, provider, or
  multi-app protocol truth.
- `superseded`: closed diagrams where they imply broader event/API authority
  than active specs.
- `retired`: Desktop-only carrier path as product root.

## SDK Event API Design

Source body: `sdk-event-api.md`.

### Body Preserved

The SDK body proposed a broad ergonomic event API:

- Client creation used an explicit factory rather than singleton state.
- Event handlers received a single event object with name, detail, metadata,
  cursor, and source context.
- Subscriptions, wildcard patterns, before-events, emission, reconnect, HMR,
  error handling, framework adapters, and multi-language bindings were explored.
- Agent state access combined pull and change subscriptions.
- Runtime-backed event cursor resume and explicit namespace enforcement were
  treated as required for durable consumption.

### Labels

- `active_authority_pointer`: `.nimi/spec/sdk/kernel/runtime-contract.md`.
- `retained_evidence`: explicit client creation, typed handler shape,
  reconnect posture, consumer-owned recovery, event cursor ideas, and framework
  adapter future shape.
- `deferred_extension_intent`: React/Vue/Svelte adapters, multi-language
  bindings, richer helper APIs, and HMR conveniences.
- `implementation_open`: admitted SDK consume helpers and typed
  `runtime.agent.*` coverage.
- `blocked`: wildcard event subscription, public before-event API,
  SDK-owned app-event emission, and implicit default-agent truth.
- `superseded`: full closed SDK Event API as current target.
- `retired`: `runtime.raw` compatibility aliases and default singleton agent
  shortcuts.

## NimiAgentScript Creator Runtime

Source body: `nimi-agent-script.md`.

### Body Preserved

The NAS body described an Avatar-owned creator runtime:

- Model packages carry convention-based script files under an app-local runtime
  directory.
- The runtime discovers handlers, normalizes exports, and invokes handlers for
  activity, user, speak/lipsync, lifecycle, and continuous behavior.
- Handlers consume an `AgentDataBundle` and emit app-local embodiment cues.
- Sandbox and capability RPC boundaries prevent direct Runtime, Desktop, or SDK
  writes.
- Hot reload, fallback handlers, budget enforcement, and continuous handler
  lifecycle are part of the intended product shape.

### Labels

- `active_authority_pointer`: `apps/avatar/spec/kernel/agent-script-contract.md`.
- `retained_evidence`: convention-based handler discovery, handler export
  shape, app-local capability boundary, `AgentDataBundle`, fallback behavior,
  continuous handlers, and hot-reload intent.
- `deferred_extension_intent`: VRM/3D backend APIs, richer model package
  permissions, marketplace policy, and creator distribution rules.
- `implementation_open`: discovery completeness, sandbox denial evidence,
  budgets, continuous handlers, fallback coverage, examples, and tests.
- `blocked`: NAS as Runtime or SDK truth source and app-level broker behavior.
- `superseded`: closed NAS claims that bypass Embodiment Projection Protocol
  or the app-local boundary.
- `retired`: direct Desktop/Runtime writes from NAS.

## PresentationTimeline

Source body: `presentation-timeline.md`.

### Body Preserved

The timeline body preserved production voice/lipsync design intent:

- Runtime owns presentation stream identity and timeline truth.
- Timeline events carry a stream id, timebase, offsets, durations, deadlines,
  and interrupt semantics.
- Channels include text, voice, avatar, and state. Avatar may stay a single
  channel even when it maps internally to motion/expression/lookat/pose.
- Timebase combines monotonic time with a wall-clock anchor.
- Interrupts stop future events and propagate cancellation while allowing
  controlled in-flight behavior.
- TTS audio level, lipsync data, motion coordination, activity/voice sync, and
  drift handling are downstream production concerns.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
  and `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`.
- `retained_evidence`: runtime-owned timebase, stream identity, channel model,
  offset/duration/deadline semantics, interrupt propagation, lipsync broadcast
  intent, and motion/audio coordination.
- `deferred_extension_intent`: cross-device time sync, advanced choreography,
  stream convenience SDK APIs, and backend-specific timing helpers.
- `implementation_open`: production voice playback, runtime timeline
  implementation, SDK/Desktop/Avatar consume, lipsync, drift tests, interrupt
  tests, and visual/audio acceptance.
- `blocked`: app-owned or SDK-owned canonical timeline and broad app event bus
  as a transport substitute.
- `superseded`: closed candidate object names unless re-admitted by active
  authority.
- `retired`: fixture-only or Desktop-renderer-only proof as Avatar branch
  closure.

## Cross-Surface State Projection

Source body: `state-event-bus.md`.

### Body Preserved

The state body preserved runtime projection families rather than a generic bus:

- Runtime state projection covers agent-scoped state changes such as posture,
  status, execution state, and emotion.
- Runtime turn projection covers conversation-anchor-scoped turn lifecycle,
  text deltas, committed messages, completion, failure, and interrupt.
- Runtime session projection covers snapshots for late join and recovery.
- Runtime presentation projection covers activity, motion, expression, pose,
  lookat, and related visual intent.
- APML parser events bridge into runtime projection only after validation and
  admission.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`,
  `.nimi/spec/runtime/kernel/app-messaging-contract.md`, and
  `.nimi/spec/sdk/kernel/runtime-contract.md`.
- `retained_evidence`: projection family taxonomy, APML-to-runtime bridge,
  owner cut, and explicit `agent_id` plus anchor-scoped semantics.
- `deferred_extension_intent`: broader multi-app state registry.
- `implementation_open`: durable consistency across chat, voice, avatar,
  reconnect, launch, and interrupt paths.
- `blocked`: generic wildcard state bus and app-owned default-agent truth.
- `superseded`: closed `state-event-bus` as a generic broker.
- `retired`: parser-level state events as app contract.

## Emotion As First-Class State

Source body: `emotion-state.md`.

### Body Preserved

The emotion body preserved current emotion as a runtime state projection:

- Emotion is transient runtime state, not persistent identity or profile truth.
- Emotion may be updated from admitted APML projection and consumed by Avatar,
  Desktop, SDK, and future apps through runtime projection.
- Activity, expression, and posture are separate concepts. Emotion can inform
  expression mapping but does not become renderer-local truth.
- Memory may observe emotion-derived facts only through explicit memory
  admission; transient emotion does not mutate memory directly.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
  and `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml`.
- `retained_evidence`: transient current emotion, separate activity/expression
  mapping, runtime projection owner cut, and memory boundary.
- `deferred_extension_intent`: long-term affect analytics and memory-derived
  patterns after active authority admits them.
- `implementation_open`: emotion source, decay, override, expression mapping,
  app consume, and cross-surface tests.
- `blocked`: persistent profile mutation through transient model output.
- `superseded`: renderer-local emotion as source of truth.
- `retired`: collapsing emotion into posture or persistent presentation profile.

## Dual-Entry Session Consistency

Source body: `dual-entry-session.md`.

### Body Preserved

The dual-entry body preserved session continuity requirements:

- Avatar and chat must speak through the same runtime-owned conversation anchor
  when they claim same-session continuity.
- `agent_id` alone is insufficient for continuity. `conversation_anchor_id`
  owns session identity.
- Same agent with different anchors is a different session; different agent
  always requires explicit retargeting.
- Desktop-to-Avatar launch context must carry explicit selected agent, anchor,
  and runtime context or fail closed.
- Voice and Desktop are consumers of the same anchor truth, not alternate
  continuity owners.

### Labels

- `active_authority_pointer`: `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`,
  `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`, and
  `apps/avatar/spec/kernel/app-shell-contract.md`.
- `retained_evidence`: explicit agent plus anchor identity, same-anchor
  continuity, same-agent/different-anchor distinction, launch-context
  fail-closed posture, and voice/Desktop boundary.
- `deferred_extension_intent`: multi-device and remote continuation policy.
- `implementation_open`: e2e chat, voice, avatar entry consistency, anchor
  switch, interrupt, reconnect, and negative launch proof.
- `blocked`: default-agent fallback and same-agent-as-same-session inference.
- `superseded`: closed demo-only evidence as product completeness.
- `retired`: implicit Desktop local session as Runtime continuity truth.

## First 30 Seconds Companion Demo

Source bodies: `wave-6a-first-demo-script.md`,
`wave-6a-operator-checklist.md`, and Wave 6A result evidence.

### Body Preserved

The demo body preserved a first real-path acceptance story:

- Show fail-closed negative proof before happy-path demo.
- Start Desktop, select an explicit demo agent, create or resume a real chat
  anchor, and open Avatar through Desktop handoff.
- Demonstrate same-anchor continuity and explicit multi-agent retargeting.
- Operator checks cover runtime availability, auth/session readiness, Avatar
  prestart failure, Desktop startup, Agent A handoff, same-anchor continuity,
  and Agent B retargeting.
- The demo is acceptance evidence only after upstream Runtime, SDK, Desktop,
  Avatar, APML, state, NAS, voice/lipsync, interaction, and asset topics close.

### Labels

- `active_authority_pointer`: `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
  and `apps/avatar/spec/kernel/carrier-visual-acceptance-contract.md`.
- `retained_evidence`: fail-closed first posture, explicit agent/anchor
  targeting, Desktop-to-Avatar handoff, same-anchor proof, multi-agent
  retarget proof, and operator readiness checks.
- `deferred_extension_intent`: expanded scripted showcases.
- `implementation_open`: final real-path demo after upstream product gaps close.
- `blocked`: fixture-only success, closed-topic-only proof, and demos that skip
  required upstream gaps.
- `superseded`: Wave 6A proof as final product acceptance.
- `retired`: demo as substitute for implementation acceptance.

## Embodiment Projection Protocol

Source bodies: Wave 6B EPP implementation packet, audit, and closeout.

### Body Preserved

The EPP body preserved the Avatar app-local protocol layer:

- EPP maps Runtime/SDK semantics into backend-neutral avatar embodiment cues.
- Backend branches such as Live2D, VRM, or future renderers remain explicit and
  branch-local.
- EPP is a consumer/adaptation layer, not Runtime, SDK, or provider truth.
- Downstream carrier branches can add cue mappings only without breaking the
  owner cut.

### Labels

- `active_authority_pointer`: `apps/avatar/spec/kernel/embodiment-projection-contract.md`.
- `retained_evidence`: backend-agnostic projection layer, explicit backend
  branches, app-local cue mapping, and non-owner boundary.
- `deferred_extension_intent`: new backend branches and projection cue
  extensions.
- `implementation_open`: re-audit if downstream topics add new cues, trust
  behavior, or backend branch semantics.
- `blocked`: EPP becoming platform Runtime truth or bypassing SDK/runtime
  contracts.
- `superseded`: Live2D as product root.
- `retired`: backend-specific parameter ids as platform semantics.

## Local SDK Consumer Trust Posture

Source body: `local-sdk-consumer-trust-posture.md` and Wave 6C evidence.

### Body Preserved

The trust body preserved local SDK consumer safety:

- Desktop-selected launch context and shared auth/session state are required
  before Avatar consumes runtime truth.
- SDK consumption must be runtime-backed and revalidated while running.
- Missing runtime, auth, launch context, carrier resources, or admitted schema
  fields fail closed.
- Handoff is explicit; Avatar cannot infer trust from local fixture success.

### Labels

- `active_authority_pointer`: `.nimi/spec/sdk/kernel/runtime-contract.md`,
  `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`, and
  `apps/avatar/spec/kernel/app-shell-contract.md`.
- `retained_evidence`: shared local auth/session posture, explicit selected
  agent/session/runtime context, fail-closed bootstrap, and running
  invalidation.
- `deferred_extension_intent`: broader permission and model-package trust
  policy.
- `implementation_open`: revalidation during cross-surface, state/session, and
  demo children.
- `blocked`: launch or SDK consume without explicit selected
  agent/session/runtime context.
- `superseded`: closed Wave 6C as active authority.
- `retired`: fail-open placeholder avatar bootstrap.

## Spec Mounting

Source body: `spec-mounting.md` and continuation authority-alignment evidence.

### Body Preserved

The mounting body preserved the authority split:

- Runtime kernel owns conversation anchor, turn/presentation projection,
  HookIntent, state, and APML authority.
- SDK kernel owns app-facing projection, reconnect, target, and consumer
  boundary.
- Desktop kernel owns desktop product semantics consuming runtime authority.
- `apps/avatar/spec/kernel/**` owns Avatar app shell, render, NAS, app-local
  events, and carrier behavior.
- Topic reports remain human-readable redesign rationale and audit trail only.

### Labels

- `active_authority_pointer`: `.nimi/spec/INDEX.md`,
  `.nimi/spec/runtime/kernel/index.md`, `.nimi/spec/sdk/kernel/index.md`,
  `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`, and
  `apps/avatar/spec/kernel/index.md`.
- `retained_evidence`: mounted home map, owner cut, app-local spec admission,
  and topic-as-evidence-only posture.
- `deferred_extension_intent`: additional admitted app-local spec slices when
  they do not create parallel truth.
- `implementation_open`: generated docs and spec governance checks as authority
  evolves.
- `blocked`: parallel authority in docs or ignored lifecycle reports.
- `superseded`: closed spec-mounting report as authority.
- `retired`: retired pre-cutover authority as active truth.

## Avatar Click, Hover, Drag, And Physics Interaction

Source bodies: avatar interaction packets, `avatar-event-spec.md`, and
`nimi-agent-script.md`.

### Body Preserved

The interaction body preserved the Avatar carrier interaction direction:

- Click-through and window drag are shell behavior.
- `avatar.user.*` events capture click, hover, leave, drag start/move/end, and
  related user interactions as app-local events.
- NAS handlers may react to user, activity, speak, lipsync, lifecycle, and
  continuous cues inside the Avatar boundary.
- Physics, drag-to-rotate, sway, poke reactions, and hit-region semantics are
  renderer/app-local embodiment behavior.
- Transparent regions and non-hit areas require negative/fail-closed proof.

### Labels

- `active_authority_pointer`: `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`,
  `apps/avatar/spec/kernel/app-shell-contract.md`,
  `apps/avatar/spec/kernel/avatar-event-contract.md`,
  `apps/avatar/spec/kernel/agent-script-contract.md`, and
  `apps/avatar/spec/kernel/live2d-render-contract.md`.
- `retained_evidence`: click-through, drag, app-local user event vocabulary,
  NAS response path, physics/drag feedback intent, and hit-region proof.
- `deferred_extension_intent`: richer gestures and backend-specific physics
  APIs.
- `implementation_open`: click/poke reactions, hover feedback,
  drag-to-rotate/sway, hit-region negatives, NAS response, and visual proof.
- `blocked`: runtime-owned renderer physics or app events as platform broker.
- `superseded`: closed Avatar interaction packets as implementation-complete
  proof.
- `retired`: Desktop local avatar carrier physics as current target.

## Existing Live2D Asset Adaptation And Compatibility Tiers

Source bodies: avatar carrier migration packets, Live2D branch evidence,
`activity-ontology.md`, and `nimi-agent-script.md`.

### Body Preserved

The Live2D asset body preserved a compatibility and packaging direction:

- The Avatar app is the first-party carrier; Live2D is the current backend
  branch, not the product root.
- Official Cubism runtime package layout and licensing must be respected.
- Activity-to-motion/expression mapping can use metadata override, convention,
  `Idle` fallback, and no-op/log fallback.
- Model packages can carry NAS handlers under the app-local package runtime
  convention.
- Existing asset support requires compatibility tiers, adapter manifests,
  semantic mapping, fixture assets, licensing posture, and acceptance gates.
- Asset-specific motion, expression, parameter, physics, and model ids remain
  backend branch details behind EPP/NAS.

### Labels

- `active_authority_pointer`: `apps/avatar/spec/kernel/live2d-render-contract.md`,
  `apps/avatar/spec/kernel/carrier-visual-acceptance-contract.md`, and
  `apps/avatar/spec/kernel/agent-script-contract.md`.
- `retained_evidence`: Cubism layout, licensing posture, branch-local fallback
  mapping, model package NAS convention, compatibility tier direction, and
  acceptance gate shape.
- `deferred_extension_intent`: VRM/3D/Lottie branches and marketplace
  packaging policy.
- `implementation_open`: adapter manifest, compatibility tiers, semantic
  mapping, fixture assets, licensing proof, and visual acceptance.
- `blocked`: treating arbitrary existing assets as admitted without manifest,
  license, fixture, and acceptance gates.
- `superseded`: closed asset-layout examples as complete adaptation authority.
- `retired`: redistributing official sample models or using Desktop renderer
  evidence as Avatar proof.

## Use Rule

Implementation topics may use this document to recover design intent and stop
lines. They must still cite active authority in `.nimi/spec/**` or admitted
`apps/**/spec/**` for product requirements.

If a future topic needs to implement a `blocked`, `superseded`, or `retired`
body item, it must first return to parent manager admission and active
authority alignment. It must not treat this preservation artifact as a shortcut
around the current spec owner cut.
