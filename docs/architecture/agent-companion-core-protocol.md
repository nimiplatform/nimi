# Agent Companion Core Protocol

This guide is the tracked reader path for the Agent Companion Core Protocol and
Runtime Substrate. Normative authority remains in `.nimi/spec/**` and admitted
`apps/**/spec/**`; this page only maps the active authority surface.

The whole-substrate design memory and extension disposition register is
tracked in
[Agent Companion Design Memory Register](./agent-companion-design-memory-register.md).
Use that register for retained, deferred, blocked, superseded, and retired
extension intent; use this page for the active core reader path.

Live2D and `apps/avatar` are first-party carrier and acceptance surfaces. They
validate the chain, but they do not own Runtime, Agent, SDK, provider, or
multi-app protocol truth.

## Product Root

The product root is the Runtime/Agent/SDK/multi-app substrate:

- Runtime owns model-facing APML, parser acceptance, typed projection,
  conversation continuity, HookIntent admission, current emotion, and timeline
  truth.
- SDK consumes runtime-owned typed projections and exposes only bounded
  `runtime.agent.*` surfaces for the companion path.
- Desktop owns shell orchestration, launch/handoff, and desktop-local app-event
  convention for chat shell cues.
- First-party apps own app-local event names, shell behavior, and carrier
  projection. App-local specs cannot redefine `runtime.agent.*`.
- Providers and models are routing inputs or evidence producers, not product
  authority.

## Current Hard Cuts

- APML is the admitted model-facing wire format; raw APML is not an app-facing
  event contract.
- The active APML target is bounded: public chat admits message text with
  optional emotion/activity cues, image/voice post-turn actions, and narrow
  HookIntent proposals. The historical broad APML taxonomy is evidence only;
  direct presentation/prosody/routing/tool/memory/state/event syntax requires
  later authority before implementation.
- HookIntent is narrow. Broad Event API, wildcard broker, cancellable
  before-events, and SDK-owned app-event emission are not admitted.
- `RuntimeAppService` may carry the reserved `runtime.agent` reactive chat
  seam, but that transport is not proof of a generic cross-app event bus.
- Avatar/NAS/EPP consume Runtime and SDK truth; they do not become alternate
  Runtime or SDK authority.
- Mock and fixture paths are explicit development/test inputs only.

## APML Scope Register

This register preserves the APML scope decision in tracked docs. It is a reader
map; normative authority remains in
`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`.

| Capability | Current disposition | Product decision |
| --- | --- | --- |
| XML-like APML family | admit | Keep APML as model-facing syntax. |
| Strict APML-only model output | admit | No JSON compatibility, Markdown fences, prose wrappers, or repair. |
| Single public `<message>` envelope | admit | Public chat begins with one message root; competing public messages fail closed. |
| User-visible text | admit | Text commits only through runtime turn commit. |
| `<emotion>` | admit | Projects to runtime-owned current emotion; not renderer-local truth. |
| `<activity>` | admit | Projects to admitted AgentActivity ontology; unknown ids fail closed. |
| Activity intensity attributes | projection_only | Product semantics may exist in typed projection; not public APML syntax now. |
| `<motion>`, `<expression>`, `<lookat>`, `<pose>`, `<clear-pose>` | projection_only | Presentation semantics stay in typed `runtime.agent.presentation.*`. |
| Speech prosody tags | projection_only | Voice/lipsync/prosody belongs to PresentationTimeline/TTS typed projection work. |
| Image/voice `<action>` with prompt payload | admit | Immediate post-turn actions for image/voice only. |
| Video `<action>` | retire | Not product-required for this continuation line; future video requires authority. |
| Rich media payload children | projection_only | May become typed media/runtime fields later; current public APML admits required prompt text only. |
| `<time-hook>` relative follow-up | admit | May propose narrow Runtime-owned HookIntent. |
| `<event-hook>` user-idle/chat-ended follow-up | admit | May propose narrow Runtime-owned HookIntent only for admitted triggers. |
| Compound hooks, absolute schedules, world/app events, hook-to-media effects | blocked | Would widen HookIntent/autonomy/event semantics; requires parent redesign. |
| Public `<hook-cancel>` | supersede | Public cancellation syntax is not admitted; runtime-private cancellation remains root-specific. |
| Runtime-private hook cancellation/proposal | admit | Stays in private `<chat-track-sidecar>` / `<life-turn>` dialects. |
| Public posture/status mutation | supersede | Public chat must not mutate posture/status directly. |
| Runtime-private posture/status extraction | admit | Private APML may propose posture/status through typed validators. |
| Public memory read/write tags | supersede | Direct memory mutation is replaced by private candidates and memory services. |
| Runtime-private canonical memory candidates | admit | Private APML may emit candidates; runtime memory admission remains authoritative. |
| Life-turn summary and canonical review extraction | admit | Private root-specific dialects remain admitted; not public chat syntax. |
| `<think>` | retire | Chain-of-thought/internal reasoning must not be exposed as APML output. |
| `<tool>` | supersede | Tool invocation belongs to runtime/tooling authority, not public APML output. |
| `<surface>` routing | blocked | Direct model-owned routing would reopen cross-surface/app routing authority. |
| `<notify>` notification | blocked | Host notification/proactive contact semantics require separate authority. |
| In-band `<meta>` version/model/timestamp | retire | Dialect/root selection is runtime-owned, not model-supplied metadata. |
| `ext:` and `mod-*:` namespaces | blocked | Would admit extension/app-local syntax without mounted runtime authority. |
| Parser event stream / raw `apml.*` app consumption | supersede | Replaced by typed `runtime.agent.*` projection; diagnostics may stay runtime-internal. |
| Lenient unknown-tag stripping, auto-close, fallback repair | supersede | Malformed output must fail closed. |
| Prompt caching, grammar-constrained decoding, error-rate monitoring | admit | Admitted as provider-neutral enforcement posture only; must not weaken parser rejection. |
| Broad Event API, wildcard broker, cancellable before-events, SDK-owned app-event emission | blocked | Parent stop line; not admitted through APML. |

## Agent Interaction Flow

1. A first-party surface resolves explicit `agent_id`,
   `conversation_anchor_id`, and subject context before crossing into runtime.
2. The surface sends an admitted `runtime.agent.turn.request` or attaches to an
   existing runtime-owned `ConversationAnchor`.
3. Runtime invokes provider-neutral model execution and accepts only admitted
   APML for the target dialect.
4. Runtime validates and projects APML into typed `runtime.agent.turn.*`,
   `runtime.agent.presentation.*`, `runtime.agent.state.*`, and
   `runtime.agent.hook.*` families.
5. SDK parses these projections fail-closed and exposes bounded
   `runtime.agent.*` consume helpers.
6. Desktop and apps consume typed projections and map them to shell-local or
   carrier-local cues. App-local events such as `desktop.chat.*` and
   `avatar.*` remain downstream conventions.
7. Embodiment Projection Protocol maps runtime semantics into backend-neutral
   avatar cues before Live2D or another renderer branch executes them.

## Correspondence Matrix

| Unit | Active authority | Owner | Current disposition |
| --- | --- | --- | --- |
| APML wire format | `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` K-AGCORE-044 through K-AGCORE-047 | Runtime | Baseline active; implementation completion remains downstream. |
| APML LLM compliance | `.nimi/spec/runtime/kernel/agent-output-wire-contract.md` K-AGCORE-048 | Runtime | Baseline active; prompt-only compliance is insufficient. |
| AgentActivity ontology | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-049 and `.nimi/spec/runtime/kernel/tables/agent-activity-ontology.yaml` | Runtime | Baseline active; productization remains downstream. |
| Platform event contract | `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`, `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-050, and `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml` | Runtime | Narrow active; broad Event API is superseded/deferred. |
| App event convention | `.nimi/spec/runtime/kernel/app-messaging-contract.md` K-APP-008 through K-APP-009, `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-071, and `apps/avatar/spec/kernel/avatar-event-contract.md` | Runtime, Desktop, Avatar | Bounded active convention; no wildcard broker. |
| Desktop app events | `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-071 | Desktop | Active as shell-local cues only. |
| Avatar app events | `apps/avatar/spec/kernel/avatar-event-contract.md` | Avatar | Active app-local carrier convention. |
| Agent Interaction Flow | This guide plus runtime, SDK, Desktop, and Avatar anchors listed here | Shared by boundary | Tracked correspondence active; no new product code in this topic. |
| SDK Event API | `.nimi/spec/sdk/kernel/runtime-contract.md` S-RUNTIME-103, S-RUNTIME-106, S-RUNTIME-108 | SDK | Narrow `runtime.agent.*` consume path active; broad SDK Event API not admitted. |
| NAS boundary | `apps/avatar/spec/kernel/agent-script-contract.md` | Avatar | Active app-local creator runtime; not Runtime/SDK authority. |
| PresentationTimeline | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-051 and `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml` | Runtime | Baseline active; production voice/lipsync remains downstream. |
| Cross-surface state | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-037 through K-AGCORE-039 and `.nimi/spec/sdk/kernel/runtime-contract.md` S-RUNTIME-103 | Runtime, SDK | Active projection families; durability hardening remains downstream. |
| Emotion state | `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` K-AGCORE-038 and `.nimi/spec/runtime/kernel/tables/runtime-agent-event-projection.yaml` | Runtime | Baseline active; source/decay/override productization remains downstream. |
| Dual-entry session | `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md` K-AGCORE-033 through K-AGCORE-035 | Runtime | Active anchor truth; end-to-end consistency remains downstream. |
| Provider-neutral / multi-model posture | `.nimi/spec/runtime/kernel/model-service-contract.md`, `.nimi/spec/runtime/kernel/model-catalog-contract.md`, `.nimi/spec/runtime/kernel/nimillm-contract.md`, `.nimi/spec/runtime/kernel/multimodal-provider-contract.md`, and `.nimi/spec/sdk/kernel/runtime-contract.md` S-RUNTIME-010 through S-RUNTIME-011 | Runtime, SDK | Active posture; no provider/model hardcoding admitted. |
| Multi-app interaction protocol | `.nimi/spec/runtime/kernel/app-messaging-contract.md` K-APP-001 through K-APP-009 | Runtime | App messaging active; not a generic event broker. |
| Embodiment Projection Protocol | `apps/avatar/spec/kernel/embodiment-projection-contract.md` | Avatar | Active app-local bridge into carriers. |
| Local SDK Consumer Trust | `.nimi/spec/sdk/kernel/runtime-contract.md` S-RUNTIME-107, `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` D-LLM-070, and `apps/avatar/spec/kernel/app-shell-contract.md` | SDK, Desktop, Avatar | Active baseline; implementation evidence must stay current. |
| Spec mounting | `.nimi/spec/INDEX.md`, `.nimi/spec/runtime/kernel/index.md`, `.nimi/spec/sdk/kernel/index.md`, `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`, and `apps/avatar/spec/kernel/index.md` | Spec owners | Active anchors mounted; lifecycle topics remain evidence only. |

## Reader Path

Read in this order for companion work:

1. `.nimi/spec/runtime/kernel/agent-output-wire-contract.md`
2. `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`
3. `.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`
4. `.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`
5. `.nimi/spec/runtime/kernel/app-messaging-contract.md`
6. `.nimi/spec/sdk/kernel/runtime-contract.md`
7. `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
8. `apps/avatar/spec/kernel/index.md`
9. `docs/architecture/agent-companion-design-memory-register.md`

Lifecycle topic reports may be cited as evidence in topic closeouts, but they
are not active product authority.
