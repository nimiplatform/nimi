# Zhiyu Local Partner Surface - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/zhiyu/local-partner-surface.authority.yaml`(runtime 产权部分见 `.nimi/spec/runtime/agent-participation.authority.yaml`)。

---

<!-- source: .nimi/spec/zhiyu/index.md -->

# Zhiyu Spec Guide

Zhiyu is a Nimi first-party bundled developer-only incubated app. This guide is
thin navigation only. Normative authority lives under `kernel/*.md` and
`kernel/tables/*.yaml`.

## Reading Order

1. `kernel/index.md`
2. `kernel/product-authority-contract.md`
3. `kernel/authority-boundary-contract.md`
4. `kernel/local-partner-center-state-contract.md`
5. `kernel/conversation-surface-contract.md`
6. `kernel/configuration-surface-contract.md`
7. `kernel/testing-contract.md`

## Authority Boundary

Zhiyu is the local partner center. Its primary conversation product targets
Desktop Agent Chat parity for local partner interaction while remaining an
independent Zhiyu app surface. It does not create partners, own Runtime Agent
execution, own memory truth, own Runtime AI config, own Avatar resource truth,
or directly consume AI provider/model routes. Zhiyu presents and operates
admitted upstream surfaces.


---

<!-- source: .nimi/spec/zhiyu/kernel/index.md -->

# Zhiyu Kernel Contracts

This directory is the formal authority for Zhiyu product behavior.

## Scope

Zhiyu is a first-party bundled developer-only incubated app that provides a
local partner center. It consumes Platform, Runtime, SDK, Kit, Desktop, Realm,
Cognition, and Avatar authority; it does not replace those owners.

## Rule IDs

Zhiyu rule IDs use `Z-<DOMAIN>-NNN`.

Allowed domains:

- `PROD`
- `AUTH`
- `STATE`
- `PARTNER`
- `CHAT`
- `CONFIG`
- `MEM`
- `AV`
- `ACT`
- `COPY`
- `DIAG`
- `GATE`
- `REL`
- `PERSIST`

## Contracts

| Contract | Rule IDs | Purpose |
| --- | --- | --- |
| `product-authority-contract.md` | `Z-PROD-*` | Product promise, release posture, non-goals |
| `authority-boundary-contract.md` | `Z-AUTH-*` | Cross-owner boundary and forbidden local truth |
| `local-partner-center-state-contract.md` | `Z-STATE-*` | Product states and transitions |
| `partner-selection-handoff-contract.md` | `Z-PARTNER-*` | Partner selection and Desktop/Realm handoff |
| `conversation-surface-contract.md` | `Z-CHAT-*` | Runtime Agent conversation consumption |
| `configuration-surface-contract.md` | `Z-CONFIG-*` | AI config and Avatar config operation surface |
| `memory-state-projection-contract.md` | `Z-MEM-*` | Read-only memory projection |
| `avatar-voice-surface-contract.md` | `Z-AV-*` | Avatar and voice posture |
| `creation-activity-contract.md` | `Z-ACT-*` | Partner activities and image hard cut |
| `main-ui-copy-contract.md` | `Z-COPY-*` | Chinese main UI copy boundary |
| `diagnostics-dev-mode-contract.md` | `Z-DIAG-*` | Developer diagnostics surface |
| `testing-contract.md` | `Z-GATE-*` | Executable test topology and acceptance gates |
| `incubation-release-contract.md` | `Z-REL-*` | Bundled developer-only release posture |
| `local-persistence-boundary-contract.md` | `Z-PERSIST-*` | Local persistence boundary |

## Tables

Typed facts live under `tables/`. The authoritative table list is checked by
`scripts/check-zhiyu-spec-kernel-consistency.mjs`.

## Priority

When conflicts occur:

1. Upstream owner specs define upstream truth.
2. Zhiyu kernel defines Zhiyu product surface and consumption requirements.
3. App implementation and tests follow this kernel.


---

<!-- source: .nimi/spec/zhiyu/kernel/authority-boundary-contract.md -->

# Zhiyu Authority Boundary Contract

## Z-AUTH-001 Upstream Consumption

Zhiyu consumes admitted upstream public surfaces from Platform, Runtime, SDK,
Kit, Desktop, Realm, Cognition, and Avatar. It must not create parallel truth
for upstream-owned concepts.

## Z-AUTH-002 Incubated First-Party Consumer

Zhiyu is an incubated first-party product consumer for Runtime Agent turn
surfaces. Those operations are first-party product/service authority, not public
App permissions and not manifest-declared scopes. A positive carrier must bind
an attested first-party Zhiyu principal to the exact Runtime Agent product
operation set through Runtime/SDK authority.

The current `local_development` provenance does not prove first-party identity:
another mutable project can declare the same display `app_id`. Therefore the
current source-development build MUST fail closed for Runtime Agent turn, voice,
artifact, memory, and AI-config operations until Runtime/Desktop admit an
attested first-party development carrier. Project approval, account session,
subject user id, manifest text, or Zhiyu-local spec clauses cannot substitute
for that carrier or for `K-AGCORE-052`.

## Z-AUTH-003 Permission And Entitlement Classification

Zhiyu's manifest permission list is empty. Account session posture,
app-private storage, mandatory AI metering, and Runtime-selected AI route
consumption are base entitlements or execution policy, not permissions.
Zhiyu-owned SQLite, media, settings, routes, cache, and exact native commands are
app-owned authority. Runtime Agent, Realm, Cognition, notification, external
file, and cross-app resources remain protected owner resources and fail closed
unless an exact first-party product carrier or an admitted public permission is
present. The complete classification is executable in
`tables/permission-posture.yaml`.

## Z-AUTH-004 Forbidden Local Ownership

Zhiyu must not own:

- partner/persona creation or profile truth
- Runtime Agent lifecycle, turns, prompt assembly, tools, queue, or session truth
- Runtime AI config truth, provider execution, routing, API key custody, or spend truth
- memory truth or direct memory writes
- Avatar resource/config truth, carrier lifecycle, or rendering truth
- voice route, audio artifact truth, playback/lipsync truth
- image generation route, provider/model truth, retry semantics, or artifact truth
- LocalAgent source snapshot/context composition, raw source/world data,
  prompt/lane/transcript text, private memory, packet/proof, provider payload,
  tool payload, or a `realmProfileContext`/profile-metadata prompt path

- AUTHORITY-RELATION subject=zhiyu action=assemble object=localagent-prompts value=denied polarity=forbid

## Z-AUTH-005 App Adapter Boundary

App-local code may adapt upstream projections to Zhiyu copy, layout, failure
mapping, and diagnostics entries. It must not become a second Runtime Agent
turn module, stream reducer, snapshot replay engine, memory writer, config
store, provider router, or Avatar resource owner.

A thin Zhiyu adapter is limited to app id, product copy, bounded product
selection,
layout placement, fail-closed reason projection, and diagnostics presentation.
`apps/zhiyu/src/shell/agent-chat/**` is admitted only as a temporary hardcut
presentation boundary for Desktop Agent Chat parity. It remains subject to
post-acceptance SDK/Kit upstream or deletion review and must not become a
parallel Runtime/SDK/Kit authority surface.

The adapter may consume only the closed, read-only Runtime/SDK
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projections. It
may map ready/blocked/truncated/failed states and typed reasons to product copy,
but unknown/partial schema, enum, state, lane, or reason fails closed and never
becomes `partner_ready`. It must not expose raw diagnostics or reconstruct
source/context from hashes, refs, counts, or profile metadata.

- AUTHORITY-RELATION subject=zhiyu action=consume-status object=localagent-source value=bounded-only polarity=require
- AUTHORITY-RELATION subject=zhiyu action=consume-status object=localagent-context value=bounded-only polarity=require

The `P-SIM-007` Zhiyu Simulator Adapter is a separate App-owned host-binding
adapter under `apps/zhiyu/src/simulator/**`. It creates one instance per
canonical renderer instance and supplies only declared projections, commands,
events, route, clock, localization, Kit, and SDK facade values. It must not
render Zhiyu UI, reconstruct this product adapter, inspect DOM, select alternate
components/styles, or expose a Simulator/host discriminator. Both production
and Simulator bindings must reach the same canonical renderer factory.

## Z-AUTH-006 Runtime AI Consumption Projection Posture

Zhiyu agent chat is a projection and edit surface of Runtime's own AI
consumption, not another app that consumes AI through Runtime. The
distinction is normative:

- Runtime executes agent turns and decides model routing against its
  committed Runtime Agent AI Config (K-AGCORE-144~150). Once the exact
  first-party carrier is admitted, Zhiyu may display turn event projections,
  edit the AI config through the closed Runtime product operation set, and
  project readiness tri-state
  (`ready` / `not_configured` / `unavailable`) with typed reason copy.
- Zhiyu must not probe, warm, cache, merge, or re-derive execution bindings,
  route readiness, or capability availability from `AIConfig` overlays,
  route projections, or app-local state. Readiness truth arrives only as the
  Runtime Agent AI Config readiness projection.
- Zhiyu must not carry execution bindings on turn requests (K-AGCORE-147).
- Zhiyu must not attach source/world/profile/prompt/context, system/developer
  roles, lane order/text, memory, tool schema, or a forged context manifest to
  turn requests. Runtime composes every LocalAgent turn.
- Source/context readiness UI consumes only `LocalAgentSourceContextStatus` and
  `AgentTurnContextSummary`; hashes/counts are display/correlation fields, not
  prompt or execution inputs.
- Zhiyu product shell must not persist app-scope AIConfig, register Electron
  AIConfig stores, call direct Runtime AI consume helpers, or keep Capability
  Studio as a product runtime path. Developer harnesses, if reintroduced, must
  live outside the product shell and outside product app-level persisted
  AIConfig.

The Simulator binding never executes a Runtime Agent turn, AI consume request,
configuration mutation, protected first-party carrier, or recovery probe. It
may return only declared host-neutral projections/results from deterministic
scenario state. Unsupported behavior stays an explicit typed unavailable
result; it cannot be implemented as a silent no-op or success-shaped mock.


---

<!-- source: .nimi/spec/zhiyu/kernel/avatar-voice-surface-contract.md -->

# Zhiyu Avatar And Voice Surface Contract

## Z-AV-001 Avatar Config And Launch

Zhiyu provides Avatar config and launch affordances for the current partner,
including Live2D/VRM import through Kit Shell standard `agent-center`
operations and selection through Runtime `AgentPresentationProfile`.
Avatar config truth, resource truth, preview rendering, carrier lifecycle, and
runtime rendering belong to Avatar/Runtime/Kit.

## Z-AV-002 Launch-Only Carrier Posture

Zhiyu v1 uses launch handoff to Avatar app or independent surface. Zhiyu does
not embed Avatar carrier runtime unless Avatar owner admits an embedded facade.

## Z-AV-003 Runtime Voice Playback And Capture Surface

Runtime voice playback is admitted for Zhiyu only through the Runtime/SDK voice
projection surface. Zhiyu may consume
`runtime.agent.presentation.voice_playback_requested` and
`runtime.agent.presentation.voice_stream_chunk_available` when those events
carry positive Runtime voice truth.

Voice input is admitted for Zhiyu only as app recording plus Runtime scenario
transcription. Zhiyu may submit recorded audio through the Runtime AI scenario
surface for `audio.transcribe` / `SpeechTranscribeScenarioSpec`, then project
the returned transcript into the composer. Runtime Agent AI Config owns the
committed transcription route; Zhiyu must not choose provider/model or carry an
execution binding on the capture request.

Zhiyu is a playback and capture orchestration surface. Zhiyu must:

- consume Runtime/SDK voice projection truth (`voice_output_mode`,
  `voice_playback_state`, chunk ordering, final replay artifact) and never select
  provider/model or run app-local TTS
- submit voice capture only through the Runtime scenario transcription surface
  and never run app-local STT or model routing
- never own durable voice cache truth; final replay bytes are read from the
  Runtime artifact service
- fail closed when Runtime voice truth is absent rather than fabricating a
  ready-looking playback state

## Z-AV-004 Voice Drift Handoff

Runtime/SDK native voice truth (positive `voice_output_mode`, separate
`voice_playback_state`, non-final-before-final chunk ordering, Runtime interrupt
truth, durable final replay artifact) is the authority for Zhiyu voice playback.
Zhiyu must fail closed when that Runtime truth is absent, simulated, or
incomplete; it must not revive deferred-looking success states or app-local
speech fallbacks.

The retired Zhiyu-local direct-daemon fixture suite is not acceptance evidence.
`product-green` requires an admitted platform fixed-service Journey plus a named
real-provider route proving native custom-`VoiceAsset` streaming with the same
final acceptance semantics. Until those checkpoints exist and execute, voice
product readiness remains unproved; source inspection, cached artifacts, and
fixture-green results must never be reported as `product-green`.

## Z-AV-005 Avatar Launch Parity Gate

If Zhiyu enables Desktop Agent Chat equivalent avatar launch behavior, the
`start_with_chat` gate, live instance policy, and public handoff evidence must
be admitted here for Zhiyu. Desktop avatar rules are provenance for migration,
not direct Zhiyu authority. Without admitted public handoff, Zhiyu must present
avatar launch as disabled/deferred with a reason code and no ready-looking local
instance fabrication.


---

<!-- source: .nimi/spec/zhiyu/kernel/configuration-surface-contract.md -->

# Zhiyu Configuration Surface Contract

## Z-CONFIG-001 AI Model Config Operation

Zhiyu must provide a user-facing placement for Kit Agent Center to view and
operate the Runtime Agent AI Config used by Runtime execution for the current
partner. Zhiyu does not own app-scope persisted `AIConfig`, provider routing,
execution, credential custody, prompt assembly, or spend truth.

The placement may display bounded source/context ready, blocked, truncated, or
failed status from `LocalAgentSourceContextStatus` and
`AgentTurnContextSummary`; these projections are read-only and are not model
configuration, prompt content, or execution bindings.

## Z-CONFIG-002 AI Config Persistence

Runtime Agent AI Config changes initiated from Zhiyu must be submitted through
Kit Agent Center typed controls and Runtime/SDK `runtime.agent.ai_config.*`
facades with `expected_revision`. Zhiyu must not persist app-scope AIConfig,
register product Electron AIConfig storage, call `ai-config.get`/`ai-config.set`,
or hardcode provider/model constants.

## Z-CONFIG-003 Avatar Config Operation

Zhiyu must provide Avatar config operations required by the local partner
center: import Live2D/VRM resources through Kit Shell standard `agent-center`
operations when a shell host is available, select Live2D/VRM through Runtime
`AgentPresentationProfile`, and launch Avatar through admitted owner facades.
Zhiyu does not own Avatar resource truth, config truth, carrier lifecycle,
preview truth, or runtime truth.

## Z-CONFIG-004 Config Boundary

Configuration surfaces must fail closed on missing upstream facade, permission,
binding, validation, or owner admission. A local UI control is not proof that
the config change is admitted or persisted.

Unknown/partial source/context summary schema, enum, state, lane, or reason is
a typed unavailable state. Configuration UI must not derive readiness from
profile metadata, raw diagnostics, hashes alone, or locally assembled context.

## Z-CONFIG-005 Retired Agent Center Local Config Bridge

The bounded Zhiyu Electron local config/import bridge is retired by the Agent
Center Avatar Kit Shell hardcut. Zhiyu must not expose
`__nimiZhiyuAgentCenterLocalConfig`, `zhiyu:agent-center-local-config`,
renderer-side local config schemas, or private `avatar.import` /
`background.import` command vocabularies.

Zhiyu consumes Kit Agent Center plus the Kit Shell standard `agent-center`
capability for host-local asset custody. Runtime `AgentPresentationProfile`
owns avatar/background/default-voice/autoplay selection truth. Web hosts without
standard shell support must fail closed for import/custody controls while
allowing admitted Runtime selection edits.

## Z-CONFIG-006 Kit Agent Center Consumer Boundary

Zhiyu consumes `kit.features.agent-center` as a partner-settings or secondary
surface. Zhiyu remains partner-first: partner selection, partner header, close
button, side-sheet chrome, and developer tools stay outside Kit Agent Center.

For LocalAgent source/context, Kit Agent Center receives only typed bounded
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` adapters. Zhiyu
must not inject raw context, prompt/profile metadata, execution bindings, a
second reducer, or a context assembler.

Zhiyu may provide:

- a scoped Runtime SDK adapter
- Kit Shell standard `agent-center` host bridge injection when available
- evidence hooks for real app acceptance

Zhiyu must not place the following inside Kit Agent Center:

- `ZhiyuAiConfigSettings`
- `AgentCenterCapabilityProbePanel`
- Capability Studio
- app-scope AIConfig store/settings/commit bridge
- direct AI consume wrappers
- `technicalSurfaces`
- `renderGatedSurface`
- app-specific `DiagnosticSurface`
- partner shell chrome or partner selection controls

The Kit Agent Center model tab is the Runtime Agent AI Config editor.
Model changes must call Runtime/SDK ai-config upsert with
`expected_revision`; stale conflicts must be visible and must not overwrite a
newer Runtime config.

Zhiyu product shell must not be an AIConfig tester or direct AI consume harness.
It must not retain Capability Studio `runRuntimeAIConsumeCapability`,
`runRuntimeSpeechSynthesize`, app-scope `NimiAIConfig`, or the
`zhiyu-agent-home` AIConfig surface. Future developer harnesses, if any, must be
separate dev-only tools outside the Zhiyu product shell and outside product
Electron AIConfig storage.

Retired local config module ownership for Zhiyu Agent Center:

| Module | Owner Decision |
| --- | --- |
| `appearance` / `avatar_asset` | Retired as Zhiyu local config. Selection truth is Runtime `AgentPresentationProfile`; asset bytes and validation are Kit Shell `agent-center` custody. |
| `local_history` | Dropped without replacement. |
| `voice.avatar_autoplay` | Retired as host-local preference. Runtime `AgentPresentationProfile.avatar_autoplay` is the single persistent home. |
| `ui.last_section` | Dropped without replacement. |

`audio.transcribe`, `audio.synthesize`, and `voice_workflow.*` intent are Runtime Agent AI
Config-owned. Zhiyu must not render app-local audio binding truth, workflow
ownership, or a playable pseudo voice artifact as Agent Center truth.


---

<!-- source: .nimi/spec/zhiyu/kernel/conversation-surface-contract.md -->

# Zhiyu Conversation Surface Contract

## Z-CHAT-001 Runtime Agent Turn Path

Zhiyu partner conversation and partner creation activities must use
`@nimiplatform/sdk/runtime` Runtime Agent client / turn runner surfaces and Kit
headless Runtime Agent projection helpers. Zhiyu must not implement raw turn
transport, event stream assembly, terminal recovery, snapshot replay, or
conversation projection reducers.

The turn surface may render/correlate only bounded
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` fields. It must
preserve typed ready/blocked/truncated/failed states, budgets/truncation, lane
ids/status/counts, and safe hashes without reading raw source/world/prompt/lane,
transcript/private-memory, packet/proof, provider/tool payload, or free-form
diagnostics.

During the Desktop Agent Chat parity hardcut, Zhiyu may host a bounded
app-local presentation implementation under `apps/zhiyu/src/shell/agent-chat/**`
until real app acceptance stabilizes and a later upstream review decides what
belongs in SDK/Kit. This boundary is presentation-only. It may adapt Zhiyu app
identity, copy, layout, local partner selection, failure projection, and
diagnostics entries, but it must not become Runtime transport truth, stream
terminal truth, snapshot replay truth, route/provider/model truth, memory truth,
avatar truth, voice/lipsync truth, or direct AI execution truth.

The bounded local parity presentation must use shared SDK/Kit state mapping and
cannot introduce a second source/context reducer, prompt assembler,
`realmProfileContext`, profile-metadata context, or execution binding.

## Z-CHAT-002 Scoped Binding

Runtime Agent turn consumption must carry Runtime-issued scoped binding such as
`ScopedRuntimeBindingAttachment`. `subjectUserId`, partner id, account session,
or Platform registry scopes are not binding proof.

If Zhiyu claims a first-party Electron host equivalence instead of binding-only
attachment, that equivalence must be admitted by Runtime/SDK authority with an
exact evidence chain and fail-closed semantics before any Runtime Agent turn,
snapshot read, interrupt, or agent event subscription uses it. A Zhiyu-local
spec clause alone cannot weaken Runtime binding requirements.

Binding proves caller admission only. It does not authorize Zhiyu to attach or
override LocalAgent context; turn requests contain typed user intent and
Runtime-owned identities only.

## Z-CHAT-003 Forbidden Direct AI Chat

In partner conversation and partner activities, Zhiyu must not use direct AI
chat helpers such as `useAppAiChatSession`, `createAppAiChatComposerAdapter`,
`streamNimiTextResponse`, `runNimiTextGenerate`, raw `sendAppMessage` to the
`runtime.agent` target, `client.writeMemory`, or `renderVoice`.

Zhiyu must also reject app-composed LocalAgent prompt/context, caller
system/developer roles, raw source/world/profile metadata, lane text/order,
memory payload, tool schema, forged context manifests, and
`realmProfileContext` attachment.

## Z-CHAT-004 Composer During Response

While the current partner is responding, the composer text area may remain
editable for draft continuity, but sending is disabled until the current turn
completes. Zhiyu v1 does not queue turns and does not allow continuous sends.

## Z-CHAT-005 Conversation Artifact Display

Runtime-owned conversation image artifacts may be displayed only as admitted
conversation artifact projection, including `runtime.agent.turn.artifact_ready`
and action projection families. Zhiyu must not request image generation, fetch
artifacts through a local seam, own retry semantics, or store artifact truth.


---

<!-- source: .nimi/spec/zhiyu/kernel/creation-activity-contract.md -->

# Zhiyu Creation Activity Contract

## Z-ACT-001 Partner Activities Use Conversation Path

Text organization, summary, drafting, and similar partner activities are
partner conversation activities. They must use Runtime Agent turn consumption,
not direct text generation helpers.

## Z-ACT-002 Image Creation Removed

Image studio, image prompt tool, image provider/model control, and app-local
image generation are removed from Zhiyu v1.

## Z-ACT-003 Image Artifact Display Exception

If Runtime local agent generates an image during conversation, Zhiyu may
display the Runtime-owned conversation artifact projection. This exception does
not admit image generation as a Zhiyu capability.


---

<!-- source: .nimi/spec/zhiyu/kernel/diagnostics-dev-mode-contract.md -->

# Zhiyu Diagnostics Dev Mode Contract

## Z-DIAG-001 Secondary Surface

Diagnostics/dev mode is a secondary developer surface under the product. It
must not define first screen or primary navigation.

## Z-DIAG-002 Owner-Aware Diagnostics

Diagnostics may expose technical truth only with owner, reason, trace, and next
step. Upstream raw truth remains owned by its domain.

## Z-DIAG-003 Diagnostics Cannot Admit Product Shape

Diagnostics, release evidence, old screenshots, old E2E, and closeout reports
cannot define product authority or override `.nimi/spec/zhiyu/**`.


---

<!-- source: .nimi/spec/zhiyu/kernel/incubation-release-contract.md -->

# Zhiyu Incubation Release Contract

## Z-REL-001 Bundled Developer-Only App

Zhiyu consumes the Platform registry entry `nimi.zhiyu` and release descriptor
`nimi.zhiyu.bundled-with-nimi`. It remains developer-only incubated until a
future admitted release posture changes that status.

## Z-REL-002 Registry Interpretation

Permission and entitlement posture is interpreted by `tables/permission-posture.yaml`.
Registry admission does not grant Zhiyu upstream ownership.

## Z-REL-003 Release Evidence Boundary

Release evidence is verification material only. It does not become product
authority and cannot override kernel contracts.


---

<!-- source: .nimi/spec/zhiyu/kernel/local-partner-center-state-contract.md -->

# Zhiyu Local Partner Center State Contract

## Z-STATE-001 Product States

Zhiyu uses the state machine in `tables/product-state-machine.yaml` as the
product state authority. The v1 state set is:

- local_service_unavailable
- no_partner
- partner_candidates_unselected
- model_config_not_ready
- partner_ready
- partner_responding
- recoverable_failure

Bounded LocalAgent source/context `ready`, `blocked`, `truncated`, and `failed`
values are upstream projection inputs mapped into this existing product state
set; they do not add a second Zhiyu state machine or new product states.

## Z-STATE-002 First Screen

The first screen must be the local partner center state, not a diagnostics
dashboard, readiness checklist, capability studio, evidence wall, or disabled
card wall.

## Z-STATE-003 State Truth

Zhiyu may present state derived from admitted upstream projections and local UI
state. It must not synthesize partner readiness, model readiness, memory state,
Runtime session state, or Avatar carrier readiness.

LocalAgent source/context state is derived only from the closed Runtime/SDK
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projections.
Ready, blocked, truncated, and failed remain distinct typed states. Unknown,
partial, malformed, unsupported, or absent-required projection state never
maps to `partner_ready`; it maps to a typed unavailable/recoverable failure.
Zhiyu must not maintain a second readiness reducer over raw source, profile,
prompt, lane, memory, proof, or diagnostics data.

In Simulator, the same canonical Zhiyu state projection receives typed mock
inputs only through the App-owned Simulator Adapter. Those inputs remain
deterministic presentation state under `P-SIM-010`: they may exercise the
existing product states and failure mappings but cannot create new state names,
relax a fail-closed transition, claim real partner/Runtime readiness, or enter
Zhiyu persistence.

## Z-STATE-004 Check Local Service

`检查本地服务` must run a real health reconnect action: probe Runtime/auth/SDK
bridge, refresh product state, and show owner-aware failure with diagnostics on
failure. It must not be a no-op button.

## Z-STATE-005 Runtime Emotion Projection

Zhiyu companion emotion state must derive only from admitted Runtime Agent
emotion ontology ids. Zhiyu must preserve the ontology id and intensity as
truth-axis evidence, derive `AvatarEmotionCue` through the Kit avatar emotion
mapping surface, and expose both axes through product evidence. Unknown emotion
ids, unknown intensity values, and neutral emotion with intensity must fail
closed into typed `emotionViolation` evidence without displaying the rejected
raw value. Non-emotion Runtime Agent activity events must not overwrite the
current companion emotion projection.


---

<!-- source: .nimi/spec/zhiyu/kernel/local-persistence-boundary-contract.md -->

# Zhiyu Local Persistence Boundary Contract

## Z-PERSIST-001 Allowed Local State

Zhiyu may persist limited product-local state such as current partner reference,
UI preferences, and diagnostics projection cache if that state is explicitly
listed in `tables/local-persistence-boundary.yaml`.

## Z-PERSIST-002 Forbidden Local Truth

Zhiyu must not persist canonical transcript, turn, session recovery, memory
truth, agent state, provider/model route, Runtime AI config truth, Avatar
resource/config truth, voice artifact truth, image artifact truth, or Runtime
snapshot truth.

Simulator scenario snapshots, module/instance/epoch ids, replay records,
logical-clock state, mock partner/conversation projections, and Simulator
operation results are also forbidden persistence inputs. They exist only in
the Simulator session and are erased by `resetScenario`.

## Z-PERSIST-003 Recovery Source

Conversation recovery and snapshot replay must come from Runtime/SDK admitted
surfaces such as public chat session snapshot, not Zhiyu local storage.

Simulator replay is Platform release/debug evidence and never a Zhiyu recovery
source. A Simulator Adapter recreates its projection from the new scenario
epoch; it does not hydrate Zhiyu storage or invoke production recovery.


---

<!-- source: .nimi/spec/zhiyu/kernel/main-ui-copy-contract.md -->

# Zhiyu Main UI Copy Contract

## Z-COPY-001 Chinese Human-Readable Main UI

Zhiyu product copy is Chinese human-readable first. Main UI copy describes the
current partner, next step, recoverable failure, and real state.

## Z-COPY-002 Engineering Terms Are Diagnostics-Only

Main UI must not expose Runtime, SDK, scope, targetRef, reasonCode,
not_admitted, fixture, gRPC, local agent ref, or similar engineering terms.
Diagnostics may show technical truth with owner, reason, and next step.

## Z-COPY-003 Copy Must Match Capability

Button labels and empty-state copy must reflect the real admitted action. If a
Desktop/Runtime/Avatar facade is unavailable, copy must present honest guidance
instead of a fake action.


---

<!-- source: .nimi/spec/zhiyu/kernel/memory-state-projection-contract.md -->

# Zhiyu Memory State Projection Contract

## Z-MEM-001 Read-Only Memory Surface

Zhiyu may show admitted memory projection, revisit continuity, and
relationship/state summaries for the current partner. Zhiyu must not own memory
truth, relationship truth, or state-summary synthesis.

## Z-MEM-002 No User Memory Write Feature

Zhiyu v1 must not expose direct memory write, edit, advanced jailbreak-style
memory write, or user-visible memory-write features. If Platform registry keeps
`memory.write.admitted`, it is not a Zhiyu user feature and must remain an
upstream non-user-visible or owner-reviewed admission.

## Z-MEM-003 Forbidden SDK Use

Zhiyu partner paths must not call SDK `writeMemory` or equivalent memory write
helpers. Memory changes, if any, are Runtime/Cognition-owned conversation
derived projection.


---

<!-- source: .nimi/spec/zhiyu/kernel/partner-selection-handoff-contract.md -->

# Zhiyu Partner Selection Handoff Contract

## Z-PARTNER-001 No Partner Creation

Zhiyu must not create local partners, local agents, PersonaCharacters,
profiles, or character materialization truth.

It also must not issue Realm source-materialization packets, obtain/replace the
Runtime challenge audience, validate/upload packets, create snapshots, or
derive LocalAgent identity from CharacterSourceRefV3, WorldCharacter,
PersonaCharacter, or profile data.

## Z-PARTNER-002 Desktop/Realm Handoff

Partner creation and profile management are Desktop/Realm-owned. When no
partner is available, Zhiyu may request the admitted Platform/Desktop
`NimiDesktopOpenIntent`:

```ts
{ kind: 'open-explore', section: 'personas', productIntent: 'select-partner' }
```

The request must go through `desktop-open.openIntent` on the Kit standard shell.
Zhiyu must not construct Desktop URLs, emit `menu-bar://open-tab`, call
Desktop-private IPC, or claim success when Desktop is not running or not ready.
If the Desktop Open capability is unavailable, copy and affordance must reflect
the real fail-closed state instead of promising a fake deep link.

This action navigates to existing partner/source selection only. It is not
Zhiyu source-materialization authority. The source-generic materialization
intent and Character/Persona action belong to Desktop `rule.nimi.desktop.product-surfaces.r006` and `rule.nimi.desktop.product-surfaces.r007` and
`realm-source-materialization-actions.yaml`.

## Z-PARTNER-003 Current Partner Projection

The current partner shown in Zhiyu must come from admitted Runtime/Realm/Desktop
projection. Zhiyu must not use brand name, fixture name, or app-local state as
partner identity truth.

Availability may be presented only from bounded
`LocalAgentSourceContextStatus` plus admitted opaque inventory/provenance.
Unknown/partial status never becomes a current or ready partner. Zhiyu stores
no raw source/profile/context cache and creates no alternate identity mapping.


---

<!-- source: .nimi/spec/zhiyu/kernel/product-authority-contract.md -->

# Zhiyu Product Authority Contract

## Z-PROD-001 Product Promise

Zhiyu is the local partner center for Nimi. Its primary product surface is the
current local partner: availability, readiness, Desktop Agent Chat parity
conversation, configuration, recoverable failure, and developer diagnostics as a
secondary surface.

## Z-PROD-002 First-Party Bundled Incubation

Zhiyu is first-party, bundled with Nimi, developer-only, and incubated. This
status permits developer diagnostics but does not lower product quality or make
diagnostics the first screen.

## Z-PROD-003 Non-Goals

Zhiyu is not:

- a partner creation tool
- Runtime Agent itself
- an AI provider/model consumer
- an AIConfig tester
- an Avatar carrier runtime
- a memory editor
- a Runtime dashboard
- a private Desktop clone or Desktop private-source dependency

Zhiyu may migrate Desktop Agent Chat product behavior and UI/UX into a bounded
app-local parity implementation when SDK/Kit upstreaming is intentionally
deferred until real app acceptance stabilizes. That migration is product parity,
not ownership of Desktop, Runtime, SDK, Kit, memory, avatar, voice, provider, or
model truth.

## Z-PROD-004 Product Authority Source

Zhiyu formal authority lives under `.nimi/spec/zhiyu/**`. Local planning files
under `.nimi/local/plans/zhiyu/**`, existing app code, old tests, screenshots,
E2E, release evidence, and closeout reports are not product authority.

Zhiyu also owns its canonical renderer factory, current
`nimi.simulator.yaml`, App-owned Simulator Adapter, and conformance fixture.
Those inputs define how current Zhiyu UI consumes a host-neutral binding; they
cannot redefine Platform `P-SIM-*`, Kit, SDK, Runtime, Realm, Desktop, or
Simulator selection/release authority.


---

<!-- source: .nimi/spec/zhiyu/kernel/testing-contract.md -->

# Zhiyu Testing Contract

## Z-GATE-001 Executable Suite Topology

Zhiyu unit, unsupervised Electron, and browser-shell tests are executable
evidence governed by the single platform topology in
`.nimi/spec/platform/kernel/tables/test-governance-policy.yaml`. Zhiyu must not
own a per-file inventory, quarantine table, or local classification vocabulary.
`pnpm check:test-inventory` fails closed when a Zhiyu test source is missing,
overlapping, or unreachable from its declared suite command.

Runtime-backed LocalAgent product acceptance is owned by the platform
fixed-service Desktop-to-Zhiyu Journey. A Zhiyu-local suite that starts a
Runtime daemon or imports SDK-internal live fixtures is retired authority and
must not be restored.

Simulator conformance is an additional ordinary Zhiyu suite reached by the
platform test topology only after its test sources and command exist. It proves
canonical factory equality, two-instance isolation, Adapter lifecycle,
deterministic fixtures, style closure, and zero real Runtime/Realm/native/
network/storage execution. It cannot claim fixed-service LocalAgent product
acceptance or replace the Desktop-to-Zhiyu Journey.

## Z-GATE-002 Current Tests Only

An active Zhiyu test is either aligned to current product authority and
executable, or removed. Delivery waves, legacy drift, evidence-only status,
quarantine, and remove-after ledgers are forbidden. Green tests remain evidence
and never become product authority.

## Z-GATE-003 Real App Acceptance

Portable Zhiyu acceptance covers only the real unsupervised Electron and browser
shell boundaries named by its command. Runtime/auth/SDK connectivity, fixed
service lifecycle, authorization, restart, and cross-app behavior require the
platform LocalAgent product Journey; neither suite may claim the other's
evidence.

## Z-GATE-004 Spec Gates Fail Closed

Spec and governance gates fail closed on domain admission drift, table-family
drift, direct AI consumption, duplicate turn reducers, config truth
localization, memory-write features, or test-topology drift.

## Z-GATE-005 Implementation Acceptance Matrix

`tables/implementation-acceptance-matrix.yaml` covers every current story,
product state, and admitted preflight decision. The matrix is an acceptance
contract; only execution through its bound gates produces evidence.

## Z-GATE-006 Real App Shell Acceptance Evidence

Product acceptance launches the real app shell through the admitted platform
fixed-service Journey and inspects DOM/CDP state, console errors, accessibility,
desktop and narrow viewport screenshots, main user-path interactions,
Runtime/auth/SDK connectivity, failure states, disabled states, long text,
Chinese readability, and button/input usability. Missing Journey checkpoints
remain unproved; unit tests, source inspection, fixture-only daemon runs,
cached evidence, and closeout notes cannot substitute for them.

## Z-GATE-007 Blocking Boundary Gates

Real app shell acceptance cannot pass while Zhiyu boundary gates fail for
config truth localization, direct image creation, local persistence truth,
direct AI consumption, duplicate turn reducers, or executable test topology.

Simulator selection additionally fails while the current Manifest, canonical
factory, production/host inventories, Adapter, conformance fixture, forbidden
effect scan, or integrated graph is unproved. App-tools produces App-source
qualification; Simulator owns final resolver, cross-App, DOM/CSS, performance,
and release qualification. Neither report substitutes for the other.


---

