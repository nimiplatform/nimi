# Runtime Agent Participation - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/agent-participation.authority.yaml`。下文保留的 `Contract`、`Authority`、`MUST` 和旧 Rule ID 标题均为历史标签，不能覆盖或扩展 canonical authority。

---

<!-- source: .nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md -->

# Agent Conversation Anchor Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-033 Conversation Anchor Authority Home

`RuntimeAgentService` owns conversation continuity for live agent surfaces
through runtime-owned `ConversationAnchor` truth.

`RuntimeAgentService` remains multi-agent by default. `ConversationAnchor`
closes per-agent continuity only; it is not a system-wide singleton session.

It owns:

- cross-surface conversation continuity identity
- anchor-scoped turn and message id scope
- anchor-scoped interrupt propagation
- attach / late-join / recovery boundary for host surfaces

It does not own:

- desktop-only window lifecycle
- avatar-only placement or renderer-local interaction state
- provider-native transcript truth

## K-AGCORE-034 ConversationAnchor Boundary

`ConversationAnchor` is the runtime-owned continuity anchor that allows multiple
surfaces to participate in one conversation without collapsing all surfaces into
one implicit global session.

The admitted anchor shape must remain reconstructable through committed runtime
truth and include at least:

- `conversation_anchor_id`
- `agent_id`
- `subject_user_id`
- anchor status / lifecycle metadata
- last committed turn/message identity

Fixed rules:

- runtime owns no platform-level default/current agent; any app-local
  current/default/pinned agent choice must resolve to explicit `agent_id`
  before crossing into runtime-owned truth
- `agent_id` is agent identity scope, not conversation continuity scope
- `conversation_anchor_id` is the only admitted cross-surface conversation
  continuity scope
- `turn_id` and `message_id` must be unique within one
  `conversation_anchor_id`
- `stream_id` must identify one owned presentation/turn stream and remain
  anchor-scoped
- host surfaces may attach to an existing anchor or open a new one explicitly;
  they must not infer "same agent means same conversation" by default
- `OpenConversationAnchor` must require explicit `agent_id` plus
  `subject_user_id` and return a committed `ConversationAnchorSnapshot`
- `GetConversationAnchorSnapshot` must recover committed continuity through
  explicit `agent_id` + `conversation_anchor_id`; late-join surfaces must not
  reconstruct canonical anchor truth from app-local history

## K-AGCORE-035 Sharing, Isolation, And Recovery Rules

Surfaces attached to the same `ConversationAnchor` share one conversation
continuity. Surfaces attached to different anchors do not.

Fixed rules:

- same-anchor surfaces share `runtime.agent.turn.*`,
  `runtime.agent.presentation.*`, and turn-interrupt semantics
- different anchors under the same `agent_id` must not share `turn_id`,
  `message_id`, or interrupt propagation by implication
- agent-scoped `runtime.agent.state.*`, `runtime.agent.memory.*`, and
  `runtime.agent.hook.*` may still be observed across anchors, but consumers
  must not reinterpret those agent-scoped projections as one conversation stream
- late-join surfaces must recover current continuity through runtime-owned
  anchor/session snapshot truth, not by replaying parser internals or guessing
  from UI-local history
- `runtime.agent.turn.request` may reference only an existing committed
  `conversation_anchor_id`; client-side shadow anchor creation is not admitted

## K-AGCORE-138 Avatar Live Instance Binding Recovery

Runtime owns the recovery binding between an explicit Avatar window instance
and an existing `ConversationAnchor`.

Fixed rules:

- Desktop may register `avatar_instance_id -> conversation_anchor_id` only
  after opening or recovering the anchor through Runtime.
- Avatar may resolve the binding only after validating the minimal launch
  `agent_id` selector through Runtime/SDK into local agent identity.
- the binding must be keyed by explicit `avatar_instance_id` plus local agent
  identity; same-agent identity alone must not imply conversation continuity
- registration and resolution must return a committed `ConversationAnchorSnapshot`
  and must fail closed on identity mismatch, missing anchor, or missing binding
- registration must not create anchors, choose packages, or widen Avatar launch
  payload authority

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/desktop/agent-projection.authority.yaml`
- `.nimi/spec/avatar/embodiment-surface.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime projection reader guide and dual-entry session correspondence
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Live2D companion reader guide and conversation continuity correspondence

---

<!-- source: .nimi/spec/runtime/kernel/agent-hook-intent-contract.md -->

# Agent Hook Intent Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-040 HookIntent Narrow-Admission Authority Home

`RuntimeAgentService` owns narrow-admission `HookIntent` truth for deferred
continuation on the live agent path.

It owns:

- validation of model-proposed hook intent
- admission / rejection decision
- pending lifecycle truth
- execution outcome and replay-visible observability

It does not own:

- a general timer, deadline, or appointment object model
- host automation or proactive contact semantics beyond the admitted effect set

## K-AGCORE-041 HookIntent Shape And Admission States

The admitted semantic object is `HookIntent`.

Its minimum typed shape is:

- `intent_id`
- `agent_id`
- optional `conversation_anchor_id`
- optional `originating_turn_id`
- optional `originating_stream_id`
- `trigger_family`
- `trigger_detail`
- `effect`
- `admission_state`

Fixed rules:

- admitted `trigger_family` is limited to `time` and `event`
- admitted `trigger_detail` is limited to:
  - `time(delay_ms)`
  - `event(user-idle, idle_ms)`
  - `event(chat-ended)`
- admitted `effect` is limited to `follow-up-turn`
- admission states must remain reconstructable through committed runtime truth
  and include `proposed`, `pending`, `rejected`, `running`, `completed`,
  `failed`, `canceled`, and `rescheduled`

## K-AGCORE-042 Hook Event Projection Seam

The public runtime event seam for narrow-admit hook intent is:

- `runtime.agent.hook.intent_proposed`
- `runtime.agent.hook.pending`
- `runtime.agent.hook.rejected`
- `runtime.agent.hook.running`
- `runtime.agent.hook.completed`
- `runtime.agent.hook.failed`
- `runtime.agent.hook.canceled`
- `runtime.agent.hook.rescheduled`

Fixed rules:

- `intent_proposed` is the projection of a validated APML hook proposal before
  runtime admission finalizes
- strict JSON message-action `follow-up-turn` is not admitted as the
  model-facing source of HookIntent truth; APML projection is the only admitted
  model-facing hook proposal source on this continuation line
- `pending` is the only admitted "accepted into scheduler truth" state
- reject reasons, conflict replacement, and budget/autonomy denial must remain
  observable through `runtime.agent.hook.rejected`
- hook event projection requires `agent_id`; origin linkage back to
  `conversation_anchor_id`, `originating_turn_id`, and
  `originating_stream_id` must be preserved when present

## K-AGCORE-043 Narrow-Admission Constraints

`HookIntent` v1 remains intentionally narrow.

Fixed rules:

- runtime must validate trigger/effect compatibility before a proposal becomes
  pending truth
- budget, autonomy, cadence-spacing, and conflict/replace policy remain
  runtime-owned admission gates
- new pending intent on the same continuity branch may replace an older pending
  follow-up only through explicit runtime-visible conflict handling
- failure to admit a hook intent must not be silently ignored or converted into
  process-local hidden timer behavior
- widening beyond the admitted trigger/effect matrix requires a later dedicated
  runtime rule, not implicit expansion
- `proactive_interruptibility_v1` may reference `HookIntent` ids as trigger
  source evidence for suggested, delivered, and suppressed projections, but it
  does not widen the admitted trigger/effect matrix, create notification
  delivery, or authorize app/renderer scheduling

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml` — broad event-bus deferral and runtime event owner map
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime projection reader guide and HookIntent / app-event boundary correspondence
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Live2D companion reader guide and HookIntent correspondence

---

<!-- source: .nimi/spec/runtime/kernel/agent-output-wire-contract.md -->

# Agent Output Wire Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-044 Agent Model Output Wire Authority Home

`RuntimeAgentService` owns the model-facing output wire contract for reactive
agent chat turns and runtime-private agent executors.

For the Live2D companion substrate continuation, the admitted model-facing wire
format is APML inline markup.

It owns:

- APML tag admission for agent chat and runtime-private executor model output
- APML parser validation and fail-close semantics
- mapping from APML semantic units into runtime-owned typed projections
- the boundary between model-facing wire syntax and app-facing durable events

It does not own:

- renderer-local interpolation or animation physics
- desktop-local prompt UI wording
- provider-specific hidden formatting hacks
- app-facing raw parser event consumption

Fixed rules:

- public reactive chat APML admits only `<message>`, sibling
  `<action kind="image|voice">`, `<time-hook>`, and `<event-hook>` top-level
  tags
- the admitted public `<message>` body is user-visible text plus optional
  `<emotion>` and `<activity>` cues; `<emotion>` projects only to
  runtime-owned current emotion state, and `<activity>` projects only to the
  admitted runtime activity ontology
- public `<action>` admits only `<prompt-payload kind="image|voice">` with a
  required `<prompt-text>` child; video, provider-specific parameters, and
  renderer/backend-specific action controls remain outside this APML dialect
- public chat APML does not admit direct motion, expression, look-at, pose,
  speech-prosody, surface-routing, notification, tool, chain-of-thought,
  memory-write, posture/status, hook-cancel, namespace extension, or
  parser-event syntax
- public `<event-hook>` is admitted only for the narrow HookIntent v1 event
  subset: `event-user-idle` with a positive `idle-for` / `idle-for-ms` duration
  or `event-chat-ended`; it must carry `<effect kind="follow-up-turn">`
- strict single-object JSON message-action output is not admitted as a
  model-facing wire authority for this continuation line
- model-facing JSON compatibility, fenced recovery, wrapper stripping, or
  best-effort JSON repair must not be retained; JSON may only exist as
  runtime-internal typed transport / persistence serialization after APML has
  already been validated and projected
- model output must be interpreted into typed runtime projection families before
  first-party apps treat it as product truth
- Avatar APML auto-adapter support does not widen public APML syntax. Generated
  motion provider routes, backend capability profiles, mapping sidecars, and
  confidence labels live downstream of runtime projection under Avatar
  authority; they are not valid public `<motion>`, `<expression>`, `<lookat>`,
  `<pose>`, or `<clear-pose>` tags.
- malformed APML must fail closed with observable turn failure and must not
  leave a turn in an uncommitted pending state
- closed broad APML designs are evidence only; any future public APML widening
  for direct presentation controls, prosody, routing, notification, tools,
  memory/state mutation, namespaces, video actions, or raw `apml.*` events
  requires a new mounted runtime authority packet before implementation

## K-AGCORE-045 APML To Runtime Projection Boundary

APML is a model-facing input contract. It is not the durable app consumption
contract.

The durable app product path remains:

- `runtime.agent.turn.*`
- `runtime.agent.presentation.*`
- `runtime.agent.state.*`
- `runtime.agent.hook.*`

Fixed rules:

- APML text content may become committed assistant message text only after the
  runtime turn commit point
- APML activity / expression / posture / status cues may only become product
  truth through the admitted runtime presentation and state projection families
- broad APML presentation capabilities such as motion, expression, look-at,
  pose, speech prosody, and voice/lipsync timing are product semantics only
  after they are represented as typed runtime projection families; their
  presence in closed APML evidence does not admit public model-facing syntax
- APML hook tags may only propose `HookIntent`; runtime owns validation,
  admission, scheduling, and public hook lifecycle events
- apps must not consume raw `apml.*` parser events as their durable product path
  unless a later mounted rule explicitly admits such events
- APML parser diagnostics may exist for debugging, but they must not replace
  typed runtime event envelopes
- Runtime projection for public `<activity>` remains
  `runtime.agent.presentation.activity_requested`; Avatar-specific backend
  route selection must happen after that projection and must not feed back into
  APML parser acceptance or runtime activity ontology ownership

## K-AGCORE-046 Post-Turn Action And Hook Split

APML may express immediate post-turn modality requests and deferred hook
proposals, but those semantics have different owners after runtime validation.

Fixed rules:

- immediate `image` and `voice` requests may project into post-turn action
  indications after the assistant message commit point
- `video` remains deferred unless a later mounted packet admits video execution
  and consumer semantics
- deferred continuation must be represented as runtime-owned `HookIntent`; it is
  not a desktop message-action modality
- runtime must reject unsupported or owner-mismatched APML tags rather than
  silently translating them into local timers, hidden actions, or best-effort UI
  side effects

## K-AGCORE-047 Runtime-Private Executor APML Hard Cut

Runtime-private model executors must use APML extraction documents as their
model-facing output contract.

Admitted root documents:

- `<message>` for reactive public chat assistant turns
- `<life-turn>` for Life Track hook execution
- `<chat-track-sidecar>` for Chat Track sidecar execution
- `<canonical-review>` for canonical review execution

Runtime-private roots are root-specific dialects under this rule, not synonyms
for the public chat APML vocabulary. The admitted private vocabulary includes:

- `<behavioral-posture>` with posture-class/action-family/interrupt-mode,
  transition reason, truth basis ids, and optional status text
- `<canonical-memory-candidates>` with typed candidate payload children
- `<next-hook-intent>` with one admitted trigger child (`<time>`,
  `<event-user-idle>`, or `<event-chat-ended>`) and a follow-up-turn effect

Fixed rules:

- every admitted root must have a single APML root document and must begin with
  that root tag after whitespace trimming
- unknown tags, unknown attributes, duplicate attributes, unsupported
  parent/child hierarchy, text in non-text container tags, XML namespaces,
  comments, processing instructions, code fences, prose wrappers, and multiple
  roots must fail closed
- runtime-private APML output may propose posture, status, canonical memory
  candidates, hook intents, hook cancellations, narratives, truths, or
  relations only inside the root-specific admitted shape
- APML output is not durable product truth; RuntimeAgentService must validate
  and project it through runtime-owned typed admission paths before committing
  events, hooks, memory, posture, or review outcomes
- no runtime-private executor may retain JSON model-output compatibility or
  silently downgrade invalid APML into success

## K-AGCORE-048 APML LLM Compliance Harness

APML LLM compliance is an enforcement posture, not only prompt wording.

The admitted compliance boundary is:

- first-party prompts may teach only admitted public APML shapes;
- runtime parsers remain the authority for acceptance or rejection;
- invalid model output must fail closed with diagnostics and no placeholder
  success;
- executable negative tests are required for every admitted dialect class that
  can be confused with legacy JSON, prose wrappers, or another APML dialect.

Public chat compliance must cover:

- successful `<message>` output with admitted message children;
- successful sibling image/voice `<action>` output;
- successful narrow `<time-hook>` and `<event-hook>` HookIntent proposal output;
- rejection of JSON model-output compatibility;
- rejection of prose wrappers, Markdown/code fences, comments, processing
  instructions, directives, XML namespaces, duplicate attributes, unknown
  attributes, unknown tags, invalid hierarchy, and multiple competing hook
  triggers;
- rejection of runtime-private roots such as `<life-turn>`,
  `<chat-track-sidecar>`, and `<canonical-review>` on the public chat path.

Runtime-private compliance must cover each K-AGCORE-047 root-specific dialect
separately. A private root is never a synonym for the public chat vocabulary.

Fixed rules:

- prompt-only compliance is not sufficient for closeout;
- provider-specific hidden formatting, grammar hacks, or constrained decoding
  may be added only by later explicit authority and must not weaken parser
  fail-close semantics;
- parsers must not strip wrappers, repair malformed XML, recover fenced APML,
  or translate invalid output into a best-effort success envelope;
- Desktop or SDK consumers must not re-accept model output that runtime would
  reject on the same admitted path;
- compliance tests must exercise both success and negative cases before a
  dialect widening can be closed.

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime projection reader guide and APML correspondence
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Live2D companion reader guide and APML decision correspondence

---

<!-- source: .nimi/spec/runtime/kernel/agent-presentation-contract.md -->

# Agent Presentation Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-022 Agent Presentation Authority Home

`RuntimeAgentService` owns persistent agent presentation truth through `AgentPresentationProfile`.

It owns:

- default avatar renderer/backend selection
- stable avatar asset / model reference
- stable expression / idle preset references
- stable presentation-policy defaults for reusable consumers
- default voice binding through runtime-owned `VoiceReference`
- avatar autoplay policy for ordinary assistant playback
- stable background asset reference as an opaque presentation ref

It does not own:

- current emotion as persistent profile truth
- current gesture or action cue
- current speaking / listening phase
- per-frame viseme or amplitude state
- renderer-local camera, lighting, or post-process state

Current emotion is instead runtime-owned transient state on the
`runtime.agent.state.*` seam defined by
`agent-presentation-stream-contract.md`; it must not be smuggled into
`AgentPresentationProfile`.

## K-AGCORE-023 AgentPresentationProfile Boundary

`AgentPresentationProfile` is a slow-changing runtime-owned projection attached to agent identity.

Its admitted public boundary is limited to stable presentation inputs such as:

- `backend_kind`
- `avatar_asset_ref`
- `expression_profile_ref`
- `idle_preset`
- `interaction_policy_ref`
- optional default `VoiceReference`
- `avatar_autoplay`
- `background_asset_ref`

Fixed rules:

- profile fields must be stable enough to survive app restart and cross-surface reuse
- runtime may store provider or asset-specific implementation detail only as auxiliary metadata, not as a second canonical profile shape
- display labels, temporary URLs, or renderer-local cache handles must not become the canonical profile key
- missing required stable profile fields must fail closed rather than fabricate a fallback avatar
- avatar/background refs are opaque refs; asset bytes, managed local paths, local asset URLs, and Live2D adapter sidecar payloads remain outside Runtime source and belong to the admitted host-local custody owner
- `avatar_autoplay` is the single persistent per-agent autoplay home and must not be mirrored into app-local Agent Center config
- `background_asset_ref` is runtime-owned selection truth only; an unresolved host-local ref must project a fail-closed re-import state instead of a ready background
- Runtime projects the selected profile through typed
  `AgentRecord.presentation_profile` field `8` and its committed revision
  through `AgentRecord.presentation_profile_revision` field `9`; generic
  `metadata.presentationProfile` is not an admitted read or storage seam
- a non-empty `AgentPresentationProfile` also carries its matching `uint64
  revision` at field `10`; field number `9` in that message remains reserved

## K-AGCORE-023a AgentPresentationProfile Mutation Boundary

`SetAgentPresentationProfile` admits partial field mutation for stable
presentation inputs.

Fixed rules:

- callers may set or clear `avatar_asset_ref`, `backend_kind`,
  `background_asset_ref`, default `VoiceReference`, and `avatar_autoplay`
  independently
- autoplay, background, and default voice must be editable before an avatar
  asset exists
- import completion for Kit Agent Center avatar/background assets commits the
  minted opaque ref through this Runtime mutation path; shell-local selected
  state without a committed Runtime write is not success
- mutation must fail closed on invalid voice reference kind, malformed opaque
  ref, missing auth scope, or expected revision conflict
- every set, patch, and clear mutation carries `expected_revision`; a
  never-mutated absent profile starts at committed revision `0`, and each
  successful mutation advances the committed revision by exactly one,
  including a clear; a cleared profile remains absent while its last committed
  revision remains available for the next CAS
- `SetAgentPresentationProfileRequest.expected_revision` is `optional uint64`
  field `6` so an omitted token is distinguishable from the valid initial
  revision `0`;
  Runtime compares it and commits the profile plus revision in one
  lock/transaction boundary; a stale revision fails with gRPC `ABORTED` and
  `AGENT_PRESENTATION_REVISION_CONFLICT` and must not partially change profile
  fields
- `SetAgentPresentationProfileResponse.committed_revision` is `uint64` field
  `2`; it returns the committed revision even when response field `profile = 1`
  is absent after clear
- `SetAgentPresentationProfile` is a protected write and the server must enforce
  `runtime.agent.write` (or an admitted scoped binding carrying that write
  capability); an SDK-requested scope is not authorization by itself
- `InitializeAgent.metadata` reserves `presentationProfile` and
  `presentationProfileRevision`; supplying either key fails closed, so generic
  metadata cannot bypass the typed mutation, validation, authorization, or CAS
  boundary
- a non-empty avatar/background opaque ref uses exactly one grammar below:
  - a bare ref is `1..256` ASCII bytes and matches
    `[A-Za-z0-9][A-Za-z0-9._@+~-]*`; a value containing `:` cannot fall back
    to the bare form
  - a qualified ref is `1..2048` ASCII bytes, starts with a lowercase namespace
    matching `[a-z][a-z0-9_.+-]{0,63}:`, and has a non-empty tail containing
    only RFC 3986 URI characters; percent escapes must be complete hexadecimal
    escapes; every value containing `:` is parsed as this qualified form
  - direct namespaces `file`, `data`, `http`, and `https` are forbidden;
    `profile_media_url` is the only URL-bearing namespace and its tail must be
    an absolute `https://` URL with no userinfo
  - both the raw value and one percent-decoded pass must contain no whitespace,
    control/NUL byte, backslash, POSIX absolute prefix, Windows drive/UNC
    prefix, `.`/`..` slash segment, or `;base64,` marker
  - clearing a field is represented only by the patch field being present with
    the empty string; the empty string is not an opaque ref
- full-profile validation, merged-patch validation, persisted-profile reads,
  and SDK request/projection validation apply the same opaque-ref admission
  rules; invalid stored metadata fails closed instead of projecting ready state
- `voice_asset_id` default voice bindings resolve at mutation time to an active,
  owner-scoped, durable Runtime `VoiceAsset`; missing, deleted, expired, failed,
  cross-owner, or `session_ephemeral` assets are rejected, and an empty voice
  reference suffix is invalid
- Runtime must not accept raw filesystem paths, raw `file://` URLs, asset bytes,
  package descriptors, backend compatibility tiers, calibration payloads, or
  Avatar launch payload fields on this mutation surface

## K-AGCORE-024 VoiceReference Binding Boundary

When `AgentPresentationProfile` binds a default voice, it must bind through runtime-owned `VoiceReference` semantics defined by `K-VOICE-003`.

Fixed rules:

- the presentation profile may reference a default voice; it does not own voice workflow, voice asset lifecycle, or discovery truth
- display-only provider labels, preview URLs, or UI-local selections must not replace stable `VoiceReference` truth
- a runtime-owned voice binding may inform first-party avatar or chat consumers, but those consumers remain responsible for transient session and playback state

## K-AGCORE-025 Public Projection And Consumer Boundary

Apps and SDK consumers may read `AgentPresentationProfile` only as runtime-owned
projection through `runtime.agent.*`.

Fixed rules:

- apps may cache or adapt the profile into surface-local renderer inputs, but that adapted shape is not canonical runtime truth
- apps may also consume transient `runtime.agent.turn.*`,
  `runtime.agent.presentation.*`, and `runtime.agent.state.emotion_changed`
  projections, but those remain distinct from the persistent profile
- app-local avatar interaction state, voice-session state, and thread-local animation cues must not be written back as `AgentPresentationProfile`
- runtime mutation of presentation truth must remain on admitted RuntimeAgentService command paths; consumers must not replace full profile blobs through arbitrary metadata write paths

## K-AGCORE-026 Deferred Scope And Non-Owners

The following remain outside runtime-owned persistent presentation truth unless later admitted explicitly:

- per-frame lip-sync / viseme streams
- session-local listening / speaking state
- pointer / gaze targets
- physics simulation or gesture queues
- renderer camera choreography and post-processing

Current emotion no longer belongs to this deferred list because it is now
runtime-owned transient state. It remains outside persistent profile truth.

If a consumer needs these semantics, it must own them on the surface side or wait for later authority admission; runtime must not absorb them into `AgentPresentationProfile` as a generic state bag.

## K-AGCORE-026a Desktop Local Carrier Decommission Boundary

Runtime does not own desktop-local avatar registries, per-agent local avatar bindings,
or desktop-imported VRM / Live2D carrier assets as active presentation truth.

Fixed rules:

- desktop shipped chat surfaces must not treat desktop-local avatar registry or binding
  data as an admitted render-selection input
- desktop may adapt runtime `AgentPresentationProfile` into surface-local non-carrier
  presentation or avatar-app handoff input, but that adapted shape must not recreate a
  desktop-local carrier override
- runtime metadata, auxiliary profile fields, or generic agent settings must not be used
  as a backdoor to smuggle desktop-local avatar registry, asset, or binding truth into
  `AgentPresentationProfile`

## K-AGCORE-026b Desktop Carrier Execution Non-Ownership

Runtime does not own desktop-local Live2D / VRM carrier execution, desktop-local viewport
lifecycle, or desktop-local load-fail precedence because desktop chat is no longer an
admitted first-party carrier line.

Fixed rules:

- desktop shipped chat paths must not interpret runtime `AgentPresentationProfile` as an
  instruction to mount desktop-local Live2D or VRM carriers
- if desktop consumers need embodiment beyond non-carrier shell presentation, they must
  hand off to the admitted avatar-app carrier path instead of reviving local execution
- renderer-local carrier diagnostics, runtime packaging handles, local fallback branches,
  and desktop-imported staging assets from the retired carrier line are not admitted
  runtime truth and must not regain shipped-path authority through `AgentPresentationProfile`

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml` — runtime-owned live agent lifecycle and app-facing control-plane boundary
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime-owned transient presentation / turn seam and current emotion projection
- `.nimi/spec/runtime/model-catalog.authority.yaml` — runtime-owned `VoiceReference` and voice asset truth
- `.nimi/spec/desktop/agent-projection.authority.yaml` — desktop-local carrier decommission and avatar-app handoff boundary
- `docs/spec/avatar-domain-index.md` — Avatar first-party carrier authority map
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime projection reader guide and core presentation correspondence
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Live2D companion reader guide and presentation correspondence

---

<!-- source: .nimi/spec/runtime/kernel/agent-presentation-stream-contract.md -->

# Agent Presentation Stream Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-036 Transient Presentation And Turn Authority Home

`RuntimeAgentService` owns transient multi-surface agent presentation and
reactive turn projection as runtime-owned committed stream truth.

This transient seam is distinct from persistent `AgentPresentationProfile`
defined in `agent-presentation-contract.md`.

It owns:

- anchor-scoped turn lifecycle and text projection
- anchor-scoped transient presentation requests
- runtime-owned current emotion projection
- stream-level commit / interrupt / failure semantics

It does not own:

- renderer-local interpolation or physics
- backend-specific motion handles or Live2D parameter writes
- app-local avatar placement and shell choreography

## K-AGCORE-037 Admitted Projection Families

The admitted runtime-owned stable projection families are:

- `runtime.agent.turn.accepted`
- `runtime.agent.turn.started`
- `runtime.agent.turn.reasoning_delta`
- `runtime.agent.turn.text_delta`
- `runtime.agent.turn.structured`
- `runtime.agent.turn.message_committed`
- `runtime.agent.turn.post_turn`
- `runtime.agent.turn.completed`
- `runtime.agent.turn.failed`
- `runtime.agent.turn.interrupted`
- `runtime.agent.turn.interrupt_ack`
- `runtime.agent.presentation.activity_requested`
- `runtime.agent.presentation.motion_requested`
- `runtime.agent.presentation.expression_requested`
- `runtime.agent.presentation.pose_requested`
- `runtime.agent.presentation.pose_cleared`
- `runtime.agent.presentation.lookat_requested`
- `runtime.agent.presentation.voice_playback_requested`
- `runtime.agent.presentation.voice_stream_chunk_available`
- `runtime.agent.presentation.lipsync_frame_batch`
- `runtime.agent.state.status_text_changed`
- `runtime.agent.state.execution_state_changed`
- `runtime.agent.state.emotion_changed`
- `runtime.agent.state.posture_changed`
- `runtime.agent.proactive.suggested`
- `runtime.agent.proactive.delivered`
- `runtime.agent.proactive.suppressed`

The family-specific envelope requirements below are historical examples. The
retired `runtime-agent-event-projection` table is not a generation source;
current envelopes are admitted only by canonical Runtime authority and the
generated protocol:

- `runtime.agent.turn.*` requires `agent_id`, `conversation_anchor_id`,
  `turn_id`, and `stream_id`
- `runtime.agent.presentation.*` requires `agent_id`,
  `conversation_anchor_id`, `turn_id`, and `stream_id`
- `runtime.agent.state.*` requires `agent_id`; origin linkage back to
  `conversation_anchor_id` / `originating_turn_id` / `originating_stream_id`
  remains optional and is present only when the state projection is traceable to
  a specific continuity branch
- `runtime.agent.hook.*` requires `agent_id`; origin linkage back to
  `conversation_anchor_id` / `originating_turn_id` / `originating_stream_id`
  remains optional and is present only when the hook projection is traceable to
  a specific continuity branch
- `runtime.agent.proactive.*` requires `agent_id`, `projection_id`,
  `owner_domain`, `delivery_channel`, and `audit_ref`; origin linkage back to
  `conversation_anchor_id`, `originating_turn_id`, `originating_stream_id`,
  `source_hook_id`, or `source_cadence_id` remains optional and is present only
  when the proactive projection is traceable to a specific continuity branch

`runtime.agent.turn.message_committed` must additionally carry `message_id`.
Playable voice projection events (`voice_playback_requested` and
`voice_stream_chunk_available`) must carry the committed assistant
`message_id` in `detail.message_id` so Avatar autoplay, Desktop manual
playback, and replay consumers do not collapse multiple committed messages
under the same turn identity.

Fixed rules:

- `runtime.agent.turn.*` is conversation-anchor-scoped transient projection
- `runtime.agent.session.*` is anchor-scoped recovery projection owned by
  runtime continuity truth
- `runtime.agent.presentation.*` is stream-scoped transient presentation
  projection derived from committed runtime interpretation
- `runtime.agent.state.*` remains agent-scoped state projection even when a
  particular update originated from one anchor/turn
- apps must consume these admitted runtime projection families rather than raw
  `apml.*` parser events as their durable product path
- Explicit binding-only consumers must receive these projections only through
  streams that validated the scoped binding attachment required by `K-BIND-012`
  and `K-AGCORE-052`. Default local first-party Avatar consumes through normal
  admitted first-party Runtime / SDK account and agent authorization paths.
- APML is admitted only as the model-facing output wire syntax defined by
  `agent-output-wire-contract.md`; runtime must project APML into these typed
  families before first-party consumers treat it as durable product truth
- Avatar APML auto-adapter support consumes this same typed projection boundary:
  Avatar may map admitted `runtime.agent.presentation.activity_requested`
  activity ids and admitted `runtime.agent.state.*` state to backend routes,
  but it must not consume raw `apml.*` parser diagnostics as product input
- family-specific envelopes and detail payloads for admitted projection
  families come from canonical Runtime authority and generated protocol source,
  not this rationale or a retired table
- `PostureProjection` was the historical schema alias for
  `runtime.agent.state.posture_changed.detail.current_posture`; current schema
  admission comes only from canonical Runtime authority
- `runtime.agent.turn.post_turn.detail.hook_intent` is only a turn-close
  indication; the canonical hook lifecycle seam remains `runtime.agent.hook.*`
- `runtime.agent.proactive.*` is the app-facing projection family for
  `proactive_interruptibility_v1`; it must not be treated as a broad event bus,
  OS notification delivery promise, or app scheduler admission
- this historical prose and its retired table references are not schema input;
  current event projections come from canonical authority and their generated
  protocol source

## K-AGCORE-038 Current Emotion Projection

Runtime owns current emotion as transient agent state projection, not as
persistent `AgentPresentationProfile` truth and not as renderer-local truth.

Fixed rules:

- current emotion must project through `AgentStateProjection.current_emotion`
- current emotion ids, when admitted by canonical Runtime authority, must not be
  expanded from this historical prose or from a retired ontology table
- public change notification must use `runtime.agent.state.emotion_changed`
- emotion is durable-until-replace runtime state and must not be collapsed into
  posture or persistent presentation profile fields
- renderer-specific expression or motion hints may derive from emotion, but they
  must not rewrite `current_emotion`
- read-only app-facing state projection may additionally expose
  `status_text_changed`, `execution_state_changed`, and `posture_changed`, but
  those projections must not leak deeper runtime-private posture machine truth

## K-AGCORE-039 Commit And Failure Semantics For Turn Streams

Turn/presentation stream truth uses channel-scoped partial commit with explicit
commit points.

Fixed rules:

- `runtime.agent.turn.text_delta` is provisional until
  `runtime.agent.turn.message_committed`
- every same-turn `text_delta` must be projected before `message_committed`;
  consumers must not append a late or replayed delta after sealing the
  committed message
- if a hard turn failure occurs before `message_committed`, consumers must
  discard provisional text from that stream
- sidecar runtime-owned state units such as posture, emotion, memory
  candidates, and hook intent proposals validate and commit independently
- sidecar rejection must emit an explicit rejected or failed runtime event and
  must not retroactively roll back an already committed message
- envelope-level hard violations must fail the whole turn and suppress
  `message_committed`

## K-AGCORE-049 Agent Activity Ontology Projection Boundary

This historical section described the app-facing
`runtime.agent.presentation.activity_requested` projection. It does not define
an active ontology or restore a retired table.

Fixed rules:

- activity category is exactly one of `emotion`, `interaction`, or `state`
- activity ids are admitted only through current canonical Runtime authority
- public runtime chat output that proposes an unknown activity id must fail
  closed before durable turn commit rather than being projected as a free-form
  renderer cue
- `detail.source` records provenance such as `apml_output` or `direct_api`; it
  must not be used as a substitute category like `chat` or `status`
- `detail.intensity` may be absent or one of `weak`, `moderate`, `strong`;
  public chat APML does not currently admit activity intensity attributes, so
  APML-sourced public activity projections normally omit intensity
- renderer/app mappings may provide backend fallback behavior for admitted ids,
  but they must not re-own runtime activity category or intensity truth
- Avatar-owned backend route ids, capability profile ids, generated motion ids,
  and mapping confidence labels are downstream projection facts only; they are
  not runtime activity ids, public APML tags, or runtime-owned presentation
  payload names unless a later runtime packet admits them
- historical activity ontology documents and retired table names are evidence
  only and cannot generate or admit current Runtime values

## K-AGCORE-050 Agent Event Owner Map And Broad Bus Deferral

The active event owner map for the Live2D companion continuation is narrower
than the historical platform event design.

Active owner map:

- Runtime owns only Layer A public projection families admitted by current
  canonical Runtime authority and generated protocol source
- APML parser events remain runtime-internal diagnostics and must not be exposed
  as durable app-facing `apml.*` product events
- Desktop owns only chat shell bridge / handoff semantics under
  `.nimi/spec/desktop/agent-projection.authority.yaml`
- Avatar owns Avatar-local `avatar.*` event naming and consume semantics under
  `.nimi/spec/avatar/embodiment-surface.authority.yaml`
- SDK may consume admitted runtime agent projections but does not own platform
  event ontology

Deferred or not admitted in the current authority set:

- a general cross-app event broker for `desktop.*`, `avatar.*`, `system.*`, or
  third-party app namespaces
- broad wildcard subscription semantics beyond the current
  `runtime.agent.turns.subscribe` consume path
- cancellable before-events as a public runtime/SDK broker feature
- SDK app-event emission as a general platform API

Fixed rules:

- no implementation may cite the closed event-hook design as active authority
  for broad bus or wildcard behavior
- first-party apps may document app-local event conventions, but those app-local
  specs must not redefine runtime-owned `runtime.agent.*` payloads
- any future widening into a general event bus requires a new admitted runtime
  and SDK authority packet plus implementation tests

## K-AGCORE-051 Presentation Timeline Voice/Lipsync Admission Boundary

Runtime is the canonical owner of PresentationTimeline truth for the admitted
Live2D companion voice/lipsync branch.

This rule admits the branch that was previously candidate-only in the closed
2026-04-20 design. It does not make closed `PresentationStream`,
`TimelineMarker`, or `voice.level` shapes active API truth by name; an exact
voice/lipsync projection schema requires canonical Runtime admission and
generated protocol support before implementation can claim it.

Fixed rules:

- runtime owns stream identity, timebase identity, offset/duration/deadline
  semantics, and interrupt propagation for text / activity / voice / lipsync
  coordination
- apps may schedule rendering locally, but they must consume runtime-owned
  timeline metadata and must not invent canonical offsets or stream identity
- the admitted timebase must include a monotonic offset basis for scheduling and
  a wall-clock anchor for trace/debug evidence
- voice timing and lipsync frames must remain downstream of the same
  `agent_id`, `conversation_anchor_id`, `turn_id`, and `stream_id` used by the
  admitted turn/presentation projection families
- malformed, missing, negative, or non-monotonic timing metadata in an admitted
  timeline-bearing event must fail closed before durable projection
- interrupt/cancel must project a single stream-level cancellation truth that
  consumers can apply to text continuation, voice playback, lipsync frames, and
  avatar motion scheduling
- runtime must not expose a broad app event bus or wildcard event API as the
  mechanism for this branch; the branch must stay within admitted
  `runtime.agent.*` projection families unless a later authority widens it
- voice provider selection remains outside this rule; runtime may carry
  provider-produced timing/audio-level evidence, but it must not hardcode a
  provider or model as timeline authority
- ordinary agent voice output must be gated by Runtime-owned agent voice policy
  (`K-VOICE-018`); text commit does not by itself imply playable voice output
- Desktop Agent Chat manual playback and Avatar autoplay are distinct playback
  targets. Runtime owns whether a target receives voice stream/playback
  projection; apps own only local rendering/playback controls.
- if speech route resolution is missing or unhealthy, Runtime must keep the turn
  as text-only and must not emit a fake playable voice request

Implementation work must not report this rule as product-complete until
runtime, SDK/Desktop, Avatar, and cross-surface acceptance evidence all exist.

## K-AGCORE-133 Runtime Agent Voice Stream Projection

Runtime-owned voice stream projection is admitted for active agent turns. It is
part of the `runtime.agent.presentation.*` family and must use the same turn
envelope identity as text/presentation projection.

Fixed rules:

- `runtime.agent.presentation.voice_playback_requested` and
  `runtime.agent.presentation.voice_stream_chunk_available` must carry the
  positive `voice_output_mode` axis
  (`native_stream | simulated_stream | batch_final_artifact | text_only`,
  `tables/voice-enums.yaml` `output_modes`) and the separate `voice_playback_state`
  axis (`active | completed | failed | interrupted | canceled`, `playback_states`).
  Consumers must not infer native realtime from event shape, chunk presence, or an
  omitted boolean; `failed`/`interrupted`/`canceled` must never be encoded as
  `voice_output_mode`. See `K-VOICE-019`.
- `native_stream` requires playable non-final chunks projected before the final
  artifact. `simulated_stream` (payload-slice degradation) must be positively
  marked and must not satisfy native realtime acceptance.
- Voice chunk bytes travel over the admitted typed SDK voice-stream transport as
  transient chunks. A per-chunk `audio_artifact_id`, when present, is a transient
  reference to playable audio bytes for that chunk and must not be reused for
  lipsync metadata; it must not imply a durable per-chunk retained artifact.
  Raw audio bytes are never embedded in the projection event.
- Each voice chunk must carry the committed assistant `message_id` in its detail
  payload.
- A completed voice stream must materialize exactly one final durable audio
  artifact for replay/export and local retention under `K-VOICE-020`. Per-chunk
  durable artifacts are not the default and require a separately admitted
  retention / cleanup / retrieval authority. The final replay artifact obeys the
  `ReadArtifactBytes` 32 MiB inline cap (`K-AGCORE-053`).
- Chunk sequence must be monotonic per `turn_id` / `stream_id`.
- Runtime terminal interruption/cancel/failure must stop further chunk projection
  and must be observable by consumers through the same stream identity, projected
  as `voice_playback_state = interrupted | canceled | failed` while preserving the
  selected `voice_output_mode`.
- Ordinary agent voice output is a scenario-layer `audio.synthesize` streaming
  path. `RealtimeAudioChunk` (`ai_realtime.proto`) belongs to
  `RuntimeAiRealtimeService` sessions only and is not the agent voice stream chunk
  field (`K-MMPROV-031`).
- Avatar may compute lipsync locally from streamed or final audio. Runtime must
  not own renderer mouth parameters.

## Fact Sources

- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml`
- `.nimi/spec/desktop/agent-projection.authority.yaml`
- `.nimi/spec/avatar/embodiment-surface.authority.yaml`
- `config/avatar-activity-mapping.yaml`
- `.nimi/spec/runtime/agent-participation.authority.yaml` — runtime projection reader guide and core projection correspondence
- `.nimi/spec/avatar/embodiment-surface.authority.yaml` — Live2D companion reader guide and runtime projection correspondence

---

<!-- source: .nimi/spec/runtime/kernel/avatar-debug-projection-contract.md -->

# Avatar Debug Projection Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-054 Avatar Debug Projection Authority Home

Runtime owns avatar debug probe request/result/replay semantics whenever the
probe is visible outside Avatar or participates in Desktop product diagnostics.

This contract extends the runtime-owned `runtime.agent.*` projection boundary.
It does not transfer APML wire ownership, Avatar backend execution, or Desktop
product layout ownership to Runtime.

## K-AGCORE-055 Avatar Probe Request Envelope

Avatar debug probe requests are Runtime-owned typed envelopes.

Required identity fields:

- `probe_id`
- `agent_id`
- `conversation_anchor_id`
- `probe_kind`
- `requested_at`
- `requested_by`

Optional trace fields:

- `turn_id`
- `stream_id`
- `avatar_instance_id`
- `runtime_replay_ref`

Fixed rules:

- request `probe_kind` values are pinned in
  `tables/avatar-debug-probe-events.yaml`
- Runtime must validate authorization before a request is projected
- probe requests must not carry package descriptors, package paths, raw APML,
  provider payloads, app data, tokens, or backend command strings

## K-AGCORE-056 Avatar Probe Result Envelope

Avatar debug probe results are Runtime-owned typed result envelopes that may
include Avatar-owned backend evidence refs.

Runtime admits `SubmitAvatarDebugProbeResult` as the only result submit path for
Avatar-owned local backend evidence. A submitted result does not transfer
semantic ownership to Avatar: Runtime validates agent identity, anchor identity,
probe kind, status, permission scope, scoped binding attachment, evidence refs,
and replay/audit projection before the envelope becomes the public diagnostic
result.

Required fields:

- `probe_id`
- `agent_id`
- `probe_kind`
- `status`
- `observed_at`
- `evidence_refs`
- `reason_code`

`status` is one of:

- `passed`
- `failed`
- `unsupported`
- `blocked`
- `invalid`

Fixed rules:

- `passed` requires concrete Runtime or Avatar evidence
- `unsupported`, `blocked`, and `invalid` are terminal diagnostic outcomes
- for the same `probe_id`, the latest accepted submitted result supersedes a
  provisional Runtime blocked result in snapshots and result lists
- results must not expose raw backend payloads or raw provider output
- Avatar backend facts may appear only as evidence refs or schema-bound evidence
  summaries admitted by Avatar contracts

## K-AGCORE-057 Avatar Debug Replay Keys

Runtime owns replay keys for avatar debug probes. The key set is pinned in
`tables/avatar-debug-replay-keys.yaml`.

Replay records must preserve:

- request envelope id
- result envelope id
- authorization verdict
- Runtime projection lineage
- Avatar backend evidence refs
- redaction state

Desktop may display replay links through SDK but must not reconstruct replay
from local UI state.

## K-AGCORE-058 Runtime Agent Event Projection Extension

Any app-facing avatar debug projection family must be admitted by canonical
Runtime authority and the generated protocol.

Admitted app-facing family names:

- `runtime.agent.avatar_debug.probe_requested`
- `runtime.agent.avatar_debug.probe_result`
- `runtime.agent.avatar_debug.replay_linked`

Fixed rules:

- these events are Runtime debug/probe projection families, not public APML
  syntax
- Avatar may consume these events only through typed SDK/Runtime projection
- Desktop may display these events only through typed SDK methods

## K-AGCORE-059 Provider And Delegation Boundary

If an avatar debug probe uses external provider evidence, it must pass through
the existing Runtime delegated gateway/firewall/audit path.

Desktop and Avatar must not directly consume MCP/A2A/delegated provider output
for avatar debug success.

## K-AGCORE-060 Implementation Availability Boundary

This contract admits Runtime authority, table, and event-family truth only.
Runtime implementation, SDK methods, Desktop UI, and Avatar debug execution
must each have implementation and test evidence before product support is
claimed.

---

<!-- source: .nimi/spec/runtime/kernel/companion-participation-projection-contract.md -->

# Companion Participation Projection Contract

> Owner Domain: `K-AGCORE-*`

This contract defines the Runtime-owned projection emitted to Avatar
companion/persona, Desktop, SDK, and debug/probe consumers for participation
status. It is downstream of Runtime Agent Participation and room orchestration.

## K-AGCORE-125 Projection Ownership

Runtime owns `CompanionParticipationProjection`. Apps and SDKs may render or
transport it but must not reinterpret it as execution, queue, memory, or commit
truth.

## K-AGCORE-126 Required Projection Shape

Every projection must include:

- `projection_id`
- `agent_id`
- `surface_kind`
- `profile_ref`
- `trigger_source`
- `status`
- `audit_ref`

Domain or multi-participant contexts must also include
`room_orchestration_ref`.

Execution outcomes must use `candidate_ref`, `commit_ref`, and
`refusal_reason` fields instead of embedding raw prompt, raw APML, raw domain
payload, or provider output.

Runtime exposes the projection and control boundary through
`RuntimeAgentService`:

- `GetCompanionParticipationProjection`
- `RequestCompanionParticipation`
- `CancelCompanionParticipation`
- `OpenCompanionParticipationReplay`

These methods are the canonical product-code Runtime entrypoint for Avatar
companion participation. They may bridge to canonical Runtime chat execution,
but the projection object itself remains ref/status only.

## K-AGCORE-127 Status Values

Closed status values:

- `idle`
- `admission_pending`
- `blocked`
- `running`
- `candidate_ready`
- `committed_by_owner`
- `failed`
- `canceled`

Unknown status values fail closed at SDK/app consumers.

## K-AGCORE-128 Candidate And Commit Boundary

`candidate_ready` means Runtime produced a candidate. It does not authorize
domain commit, canonical chat commit, memory write, cognition write, or Realm
source-core mutation.

`committed_by_owner` may be projected only after the owning domain or canonical
chat authority reports a typed commit reference.

## K-AGCORE-129 Raw Payload Hard Cut

Runtime must not expose raw prompt blobs, raw APML/debug payloads, provider
request/response payloads, MCP/A2A protocol payloads, memory material, or domain
state blobs through the companion projection.

`RequestCompanionParticipation` may carry bounded user-authored text as control
input for a `user_explicit` turn. Runtime must convert it into canonical
Runtime-owned chat execution and must not echo that text, generated APML,
provider payloads, or model output through `CompanionParticipationProjection`,
replay refs, audit refs, candidate refs, or commit refs.

## K-AGCORE-130 Trigger Source Boundary

Trigger sources are causes, not authority grants. `user_explicit`,
`scheduled_proactive`, and `domain_event` must pass through Runtime
participation admission and room/session orchestration when applicable.

## K-AGCORE-131 Failure And Refusal Projection

Runtime refusal, missing domain evidence, invalid room orchestration, budget
denial, cancellation, policy denial, and profile mismatch must project as
`blocked`, `failed`, or `canceled` with a typed `refusal_reason`. Apps must not
turn these into synthetic candidates.

## K-AGCORE-132 Overlay Binding

The `avatar_companion_presentation_room` row in
`tables/room-orchestration-domain-overlays.yaml` is a projection overlay. It
does not create a new participation profile or execution owner.

---

<!-- source: .nimi/spec/runtime/kernel/multi-agent-room-orchestration-contract.md -->

# Multi-Agent Room Orchestration Contract

> Owner Domain: `K-AGCORE-*`

This contract admits Runtime-owned same-room/session orchestration authority for
multi-agent and external-participant contexts.

It defines Runtime orchestration authority only. It does not create SDK, proto,
Desktop, Web, Avatar, Realm, Scenario, OASIS/world, external-entry, MCP/A2A,
app, or runtime implementation surfaces.

## K-AGCORE-107 Room Orchestration Authority

Runtime owns one horizontal same-room/session orchestration authority.

Runtime owns:

- room/session orchestration admission
- participant ordering
- trigger arbitration
- fairness and starvation policy
- queueing policy
- cancellation and timeout policy
- per-room and per-agent budget arbitration
- queue visibility and status projection posture
- external participant admission posture
- commit-race handoff policy

Runtime does not own:

- Realm GROUP thread, membership, message, read-state, sync, or commit truth
- Scenario package, run, branch, replay, transcript, or product truth
- OASIS/world state, event log, ontology, or product truth
- external protocol wire truth
- canonical chat transcript truth
- Desktop, Web, or Avatar UI truth

## K-AGCORE-108 Parent Participation Boundary

Room orchestration extends, but does not reopen, Runtime Agent Participation.

Canonical Runtime participation authority retains ownership of:

- participation prompt assembly and output candidates
- participation profile and axis registries
- `K-AGCORE-073` execution concurrency
- `K-AGCORE-086` concurrency policy table
- memory, capability, promotion, and external-entry participation verdicts

This contract must not add values to
`tables/agent-participation-axis-model.yaml`,
`tables/agent-participation-profiles.yaml`, or
`tables/agent-participation-concurrency-policy.yaml`.

## K-AGCORE-109 Closed Room Orchestration Axis Model

Room orchestration axes are closed and defined by
`tables/room-orchestration-axis-model.yaml`.

The fixed axis families are:

- `room_session_owner`
- `participant_set_source`
- `trigger_arbitration`
- `turn_ordering`
- `fairness_starvation_policy`
- `budget_owner`
- `queue_status_projection`
- `cancellation_timeout_owner`
- `external_participant_admission`
- `commit_race_handoff`

Apps, SDKs, and product domains must not submit open string axis values or
domain-local axis extensions.

## K-AGCORE-110 Domain Matrix Co-Freeze

The room orchestration domain matrix is closed and defined by
`tables/room-orchestration-domain-matrix.yaml`.

The required rows are:

- `realm_group`
- `scenario_sandbox`
- `oasis_world`
- `avatar_companion_presentation_room`
- `external_entry_inside_room`
- `canonical_chat_adjacency`

The matrix columns must match `K-AGCORE-109`. Every required cell must name:

- owner
- allowed evidence source
- forbidden parallel truth
- handoff or refusal posture

Domain overlays may refine presentation and evidence binding only after this
matrix is closed. Overlays must not first-define rows, columns, owner cells,
schedulers, queues, budgets, cancellation, timeout, external admission, status
truth, or commit-race policy.

## K-AGCORE-111 Trigger Arbitration And Turn Ordering

Trigger arbitration, turn ordering, fairness, and starvation rules are defined
by `tables/room-orchestration-trigger-arbitration.yaml`.

Product domains may provide trigger evidence, such as a group message event,
scenario step, world event, avatar presentation event, external protocol signal,
or canonical chat turn reference. Product domains do not own same-room
arbitration, ordering, fairness, or starvation policy.

Missing trigger evidence is fail-closed. Conflicting trigger evidence must be
resolved by Runtime policy before any participant acts.

## K-AGCORE-112 Budget, Cancellation, And Timeout Policy

Room orchestration budget, cancellation, timeout, and exhaustion refusal policy
is defined by `tables/room-orchestration-budget-policy.yaml`.

Per-room and per-agent budget admission remains Runtime-owned and must preserve:

- `K-AGCORE-007` token budget authority
- `K-AGCORE-073` execution concurrency axis
- `K-AGCORE-086` concurrency policy table

Desktop, Web, Avatar, Realm, Scenario, OASIS/world, external-entry, and SDK
must not own room budget, fairness, queue, cancellation, timeout, or
exhaustion decisions.

## K-AGCORE-113 Queue Visibility And Status Projection

Room orchestration status uses existing `runtime.agent.*` projection authority.

Status projection must be admitted by canonical Runtime authority and the
generated protocol and must not create a public `runtime.orchestration.*`
status namespace.

Allowed room status facts are projection facts only:

- admitted
- queued
- running
- canceled
- timed_out
- refused
- candidate_ready
- handed_off

Projection does not create transcript truth, commit truth, protocol truth, or
UI state truth.

## K-AGCORE-114 External Participant Room Admission

External-agent entry is not a current Runtime participation capability. MCP-
backed participants and A2A participants remain unavailable future seams and
cannot be admitted by a type, registry row, protocol payload, gateway verdict,
fixture, or consumer projection.

Any future external-participant design requires separate owner and security
authority before it may define identity, transport, admission, execution,
credential, firewall, audit, or product-consumer semantics.

## K-AGCORE-115 Commit-Race Handoff Boundary

Runtime room orchestration may produce output candidates and handoff verdicts.
It must not directly commit domain truth.

Commit truth remains owned by:

- Realm for GROUP transcript/message commit
- Scenario for scenario transcript, run, branch, and replay truth
- OASIS/world for world state, event log, and ontology truth
- canonical chat authority for canonical chat history
- external domain owners for external protocol/domain truth

When multiple participants produce candidates for the same room, Runtime owns
commit-race handoff ordering and refusal posture. The target domain owner owns
whether and how a candidate is committed.

## K-AGCORE-116 Domain Overlay Limitation

Domain overlays may refine presentation, evidence binding, and product-specific
context after the base matrix is closed.

Domain overlays are registered in
`tables/room-orchestration-domain-overlays.yaml`. That table is overlay truth
only: it may bind product/domain evidence, display/projection guidance, refusal
posture, and future packet references to existing matrix rows, but it
must not add or redefine matrix axes, rows, columns, owner cells, schedulers,
queues, budget, cancellation, timeout, external admission, status truth, or
commit-race policy.

Domain overlays must not:

- add matrix rows
- add matrix columns
- add owner cells
- define private schedulers
- define app-local room queues
- define budget, cancellation, timeout, fairness, or starvation policy
- bypass Runtime gateway verdict for external participants
- define direct Runtime domain commits
- split status projection into `runtime.orchestration.*`

## K-AGCORE-117 Room Orchestration Negative Gates

Room orchestration fails closed if any of these appear outside this contract and
its tables:

- app-local room queue as steady-state authority
- Realm, Scenario, OASIS/world, external-entry, Avatar, Desktop, Web, or SDK
  ownership of room ordering, fairness, budget, cancellation, or timeout
- Runtime direct commit of Realm GROUP, Scenario, OASIS/world, canonical chat,
  or external domain truth
- external participant room entry based only on protocol readiness
- new Runtime Participation profile, axis, or concurrency value by implication
- public `runtime.orchestration.*` status truth
- overlay first-definition of an axis, row, column, or owner cell

## K-AGCORE-118 Room Orchestration Matrix Closure Gates

Matrix closure requires all of the following:

- `multi-agent-room-orchestration-contract.md` exists and is referenced by
  `kernel/index.md`
- `room-orchestration-axis-model.yaml` exists and contains every
  `K-AGCORE-109` axis
- `room-orchestration-domain-matrix.yaml` exists and contains every
  `K-AGCORE-110` row and axis column
- `room-orchestration-trigger-arbitration.yaml` exists and covers trigger
  priority, ordering, fairness, and starvation
- `room-orchestration-budget-policy.yaml` exists and covers per-room budget,
  per-agent budget, cancellation, timeout, and exhaustion refusal
- no required axis, row, column, or owner cell is marked TBD, future, later, or
  deferred
- domain overlays are explicitly limited to refinements against the closed base
  matrix

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-ai-config-contract.md -->

# Runtime Agent AI Config Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent AI Config authority, revision, readiness, turn admission, action projection, event seam, and bootstrap seeding authority.

This section preserves a historical semantic split from
`runtime-agent-service-contract.md`; its Rule IDs and prose are non-authoritative
unless repeated by `.nimi/spec/runtime/agent-participation.authority.yaml`.

## K-AGCORE-144 Runtime Agent AI Config Authority Home

`RuntimeAgentService` owns Runtime Agent AI Config: one runtime-owned,
agent-instance-scoped committed AI consume config that decides which binding
the local agent uses for chat, lifecycle, memory embedding, cognition,
activity/query, image generation, voice generation, voice workflows, and future
agent work capabilities. The admitted capability set, readiness states, typed
reason vocabularies, scopes, and forbidden derived-state fields live in
`tables/runtime-agent-ai-config.yaml`.

It owns:

- the single committed Runtime Agent AI Config record for each Runtime Local
  Agent instance
- per-capability committed AI consume intent (`text.generate`, `text.embed`,
  `image.generate`, `audio.synthesize`, `audio.transcribe`,
  `voice_workflow.voice_clone`, `voice_workflow.voice_design`, and future
  admitted `agent.work.*`)
- config mutation admission, validation, revisioning, and change event emission
- readiness projection derived from the committed config

It does not own:

- provider/model routing execution (`RuntimeAiService` per K-AGCORE-006)
- connector custody, key-source legality, or model catalog truth
- desktop `AIProfile`/`AIConfig` portable configuration authority for
  non-agent app AI consume (D-AIPC-001)
- resolved embedding dimensions, memory bank bind/rebuild/cutover state, voice
  stream state, voice artifact materialization, avatar lipsync/render state, or
  runtime activity events

Fixed rules:

- there is exactly one committed Runtime Agent AI Config per Runtime Local Agent
  instance; all first-party and binding-only consumers read and mutate that
  record through the admitted RuntimeAgentService RPC surface
- apps, SDKs, hosts, and cognition bridges must not persist a parallel copy of
  agent AI consume truth, re-derive it from `AIConfig` overlays at submit time,
  or carry it as per-turn request payload once K-AGCORE-147 applies
- binding values must use v2 durable target refs (`K-RTARGET-*`) or another
  spec-admitted typed binding reference; descriptor or evidence fields forbidden
  by K-AIEXEC-001 must be rejected fail-closed
- binding values are an alias-or-pinned union per capability: alias bindings
  reference admitted default target families such as `local/default`,
  `local/default-embedding`, capability-specific local defaults, or
  `cloud/default`; pinned bindings reference a concrete v2 target ref
- Agent Center `fixed` checkboxes are pure projection of alias-vs-pinned
  binding state. They do not add a persisted boolean field.
- product UI does not offer pinning for the `local` route or `text.embed` in
  this hardcut; the runtime contract remains neutral so later UI admission can
  widen presentation without changing the config record shape
- this config is agent-domain committed state, not a runtime-global active AI
  profile; K-AIEXEC-005 continues to hold for the generic profile resolve/apply
  layer
- mutation requires the `runtime.agent.ai_config.write` scope and read requires
  `runtime.agent.ai_config.read` (or an admitted first-party host equivalence);
  Platform registry scopes are not a substitute

## K-AGCORE-145 Runtime Agent AI Config Revision And Persistence

The committed Runtime Agent AI Config carries an `agent_instance_id`, monotonic
`revision`, the mutating app id, and the commit timestamp, and persists in the
runtime-owned store.

Fixed rules:

- every successful mutation increments `revision` by exactly one and commits
  atomically through the runtime persistence write path
- mutation requests must carry `expected_revision`; a mismatch is a typed
  concurrent-modification rejection, never a silent last-writer win
- the committed config must survive daemon restart; readiness is recomputed
  after restart rather than restored as stale truth
- every mutation emits an observable config-changed event before or together
  with the first read that reflects it; hidden mutation is not admitted
- config mutation and its evidence enter the audit trail (K-AUDIT-001)

## K-AGCORE-146 Runtime Agent AI Config Readiness Projection

`RuntimeAgentService` projects per-capability readiness for the committed
Runtime Agent AI Config. Readiness is a projection, not an execution gate or a
prepare/readiness substitute (K-AIEXEC-009).

Fixed rules:

- readiness state per capability is exactly one of `ready`, `not_configured`,
  or `unavailable`, with typed reason codes from
  `tables/runtime-agent-ai-config.yaml`
- `not_configured` (no committed binding for the capability) and `unavailable`
  (committed binding whose route is currently not usable) are distinct truths
  and must never be collapsed
- readiness recomputes at daemon start, on every config mutation, on default
  alias target changes, and on provider/route health change evidence; a
  startup-only probe that is never refreshed is not admitted
- readiness carries `config_revision` and probe timestamps so consumers can
  detect staleness; consumers must not cache readiness as their own truth
- readiness success does not admit an action, validate a prompt payload, or
  replace explicit profile prepare; execution-time enforcement remains
  fail-closed

## K-AGCORE-147 Turn Admission Consumes Runtime Agent AI Config Only

Agent turn execution binds to committed Runtime Agent AI Config at turn
admission time.

Fixed rules:

- Chat Track public turn admission resolves AI consume bindings from committed
  Runtime Agent AI Config; request-carried `execution_bindings`,
  `runtimeFields`, app `AIConfig`, or provider/model payloads are not admitted
  and must be rejected with a typed invalid-argument failure
- turn admission fixes the resolved bindings and the `config_revision` into the
  turn execution snapshot (K-AIEXEC-003); a config mutation during an in-flight
  turn affects the next turn only
- for alias-bound capabilities, the turn snapshot records the alias name, the
  resolved target ref, and the `config_revision`; a default-target mutation
  affects alias-bound agents on their next turn and does not affect pinned
  agents
- the conversation-anchor-sticky binding rule (anchor-committed bindings with
  mismatch rejection) is retired; anchors do not own binding truth
- Life Track, canonical review, chat-track sidecar, and companion participation
  executors consume the same committed Runtime Agent AI Config `text.generate`
  binding; runtime-private hardcoded model constants are not admitted as
  execution binding truth
- a missing required `text.generate` binding at admission is a typed
  fail-closed rejection, never a silent fallback to another route

## K-AGCORE-148 Available Actions Derive From Runtime Agent AI Config And Readiness

The action affordances offered to the model on a turn (including the APML
output contract prompt) derive from committed Runtime Agent AI Config presence
plus readiness, never from what a caller attached.

Fixed rules:

- image action availability on a turn is a tri-state derived at admission:
  available (committed binding, readiness not `unavailable`),
  `not_configured`, and `unavailable`
- the model-facing output contract must state the matching truth for the
  non-available states; telling the model an image route is unconfigured when a
  committed binding exists is not admitted
- planned actions whose capability is not available must fail as typed
  `action_failed` events with reason codes from
  `tables/runtime-agent-ai-config.yaml`; silent action drop or pseudo-success is
  not admitted
- voice generation, voice workflow, and embedding-dependent actions follow the
  same config-plus-readiness rule; Desktop, Zhiyu, and Avatar may display or
  render Runtime projections but must not generate voice, synthesize image
  provider truth, or persist embedding binding truth
- apps map typed reasons to product copy only; they must not re-derive action
  availability from app-local route state

## K-AGCORE-149 Runtime Agent AI Config Event Seam

Runtime Agent AI Config changes and readiness changes reach apps through a
dedicated runtime-owned subscription seam.

Fixed rules:

- config/readiness subscription delivers an initial snapshot followed by change
  events carrying `config_revision`
- the seam is domain-scoped; agent-scoped `AgentEvent` envelopes
  (K-AGCORE-037) must not be widened to carry domain config events
- subscription requires the same read authority as config read; events must not
  leak connector secrets, key material, or runtime-private descriptor evidence

## K-AGCORE-150 Runtime Agent AI Config Bootstrap Seeding

Runtime seeds Runtime Agent AI Config exactly once for a Runtime Local Agent
instance when no committed record exists.

Fixed rules:

- the seed commits `text.generate` bound to the runtime-owned local default
  alias (`local/default`, resolved per K-CFG-013 and `texttarget` resolution)
  and `text.embed` bound to the runtime-owned local embedding default
  (`local/default-embedding`, resolved through admitted runtime memory/cognition
  embedding execution)
- optional image, audio synthesize, and voice workflow capabilities are absent
  (`not_configured`) until explicitly configured
- seeding is a normal committed mutation: it produces revision `1`, an audit
  record, and a change event
- after seeding, a missing config row is an internal fail-closed error;
  turn-time silent fallback to bundled defaults is not admitted
- the seed must not overwrite an existing committed config, including after
  daemon upgrade or restart

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-app-consume-contract.md -->

# Runtime Agent App Consume Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent app-facing reactive chat consume and scoped binding attachment authority.

This section preserves a historical semantic split from
`runtime-agent-service-contract.md`; its Rule IDs and prose are non-authoritative
unless repeated by `.nimi/spec/runtime/agent-participation.authority.yaml`.

## K-AGCORE-032 App-Facing Reactive Chat Consume Seam

`RuntimeAgentService` owns one admitted app-facing reactive chat consume seam
for first-party host surfaces and the protected selected-operation subset for
third-party `LOCAL_APP` callers.

Fixed rules:

- the canonical transport target for that seam is the reserved runtime app
  target `runtime.agent`
- the admitted ingress families on that target are:
  `runtime.agent.turn.request`,
  and `runtime.agent.turn.interrupt`
- the admitted projection families on that target are:
  `runtime.agent.turn.accepted`,
  `runtime.agent.turn.started`,
  `runtime.agent.turn.reasoning_delta`,
  `runtime.agent.turn.text_delta`,
  `runtime.agent.turn.structured`,
  `runtime.agent.turn.message_committed`,
  `runtime.agent.turn.action_planned`,
  `runtime.agent.turn.action_started`,
  `runtime.agent.turn.artifact_ready`,
  `runtime.agent.turn.action_completed`,
  `runtime.agent.turn.action_failed`,
  `runtime.agent.turn.post_turn`,
  `runtime.agent.turn.completed`,
  `runtime.agent.turn.failed`,
  `runtime.agent.turn.interrupted`,
  and `runtime.agent.turn.interrupt_ack`
- full public chat session snapshot is a query and must use
  `RuntimeAgentService.GetPublicChatSessionSnapshot`; it must not be modeled as
  an app-message request/reply pair
- `runtime.agent.*` remains the steady-state lifecycle/state/memory/admin/read
  RPC projection and must not be restated as a second reactive-chat app-message
  family
- the reserved app target is only the carrier for this seam; semantic
  ownership of `runtime.agent.turn.*` / `runtime.agent.session.*` remains on
  `RuntimeAgentService`
- host surfaces must consume runtime-owned `session` / `turn` / `stream` truth
  through this seam rather than reconstructing shadow chat orchestration,
  provider-native sidecar parsing, or provider-native transcript truth locally
- host surfaces must bind or recover the appropriate `conversation_anchor_id`
  explicitly; runtime must not infer that all host surfaces attached to one
  `agent_id` belong to the same reactive conversation
- host surfaces must open or recover anchors through the runtime-owned
  `OpenConversationAnchor` / `GetConversationAnchorSnapshot` surface before
  sending `runtime.agent.turn.request`; app-local guessed anchor ids are not
  admitted continuity truth
- typed chat-sidecar / structured projection on this seam remains runtime-owned
  semantic output; hosts may render or act on it, but must not reinterpret raw
  provider output as canonical chat truth
- current transport authorization and subscription posture for turn ingress and
  turn projection remains governed by the admitted `RuntimeAppService` /
  app-messaging path; query surfaces are owned by `RuntimeAgentService` unary
  RPCs
- a third-party local app reaches only open-conversation, send-turn,
  subscribe-turn and conversation-snapshot operations through the common
  protected local-app carrier; Runtime maps those typed operations into this
  canonical seam after `K-ACCSVC-026` authorization and never exposes the
  reserved app target as a generic message bus

## K-AGCORE-052 Scoped Binding Attachment For App-Facing Consume

Explicit binding-only first-party consume modes must attach a Runtime-issued
scoped binding to every app-facing reactive consume operation. Default Nimi
Avatar launch is not binding-only; it consumes runtime-agent through admitted
local first-party Runtime / SDK account and agent authorization paths.

Third-party `LOCAL_APP` callers do not mint or attach first-party scoped
bindings. They present no portable credential: the protected transport resolves
their current process-bound local-app session. A protected Agent operation is
admitted only after `agents.interact` resolves through its owner-issued selector,
current permission decision and exact Agent/conversation policy. The current
permission is reserved, so all such third-party calls are typed unavailable.

Fixed rules:

- `runtime.agent.turn.request` and `runtime.agent.turn.interrupt` carried over
  `RuntimeAppService` must include `ScopedRuntimeBindingAttachment` with at
  least `binding_id`.
- `RuntimeAppService.SubscribeAppMessages` used to consume
  `runtime.agent.turn.*` or `runtime.agent.presentation.*` projections must
  include the same attachment.
- `RuntimeAgentService.GetPublicChatSessionSnapshot` used by binding-only
  consumers must include the same attachment on `AgentRequestContext`.
- `RuntimeAgentService.SubscribeAgentEvents` used by binding-only consumers to
  merge `runtime.agent.state.*`, hook, or presentation-adjacent projections
  must include the attachment on `AgentRequestContext`.
- Runtime must validate the attachment against the binding relation:
  `runtime_app_id`, app/window relation where available, `avatar_instance_id`
  where available, `agent_id`, `conversation_anchor_id` for anchor-scoped
  surfaces, optional `world_id`, required scope, state, expiry, and current
  authenticated account state.
- Missing, revoked, expired, stale, suspended, superseded, replayed,
  relation-mismatched, scope-mismatched, or account-non-authenticated bindings
  fail closed with typed unavailable / permission status.
- `subject_user_id` remains available for unrelated Web/cloud or
  external-principal paths, but it is never scoped binding proof.
- Default local first-party Avatar must not be forced through this binding
  attachment path solely because Desktop launched it.
- a local-app principal remains only the caller/access/audit subject; it cannot
  substitute for `agent_id`, `conversation_anchor_id`, agent ownership, memory
  ownership or `subject_user_id`

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-life-autonomy-contract.md -->

# Runtime Agent Life And Autonomy Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent Life Track, autonomy cadence, mutation event, delegation, and turn/stream boundary authority.

This section preserves a historical semantic split from
`runtime-agent-service-contract.md`; its Rule IDs and prose are non-authoritative
unless repeated by `.nimi/spec/runtime/agent-participation.authority.yaml`.

## K-AGCORE-011 WORLD_SHARED Runtime Admission Boundary

`RuntimeAgentService` may admit `WORLD_SHARED` canonical memory only when runtime-owned world context is sufficiently typed for the bank owner contract.

Fixed rules:

- runtime-owned admission requires explicit `world_id` truth matching the `WORLD_SHARED` bank owner shape
- runtime must not infer an extra owner dimension from account, app, or renderer-local context
- when runtime-owned world context has not yet been admitted on the RuntimeAgentService path, `WORLD_SHARED` query/write behavior must remain fail-closed inside runtime
- deferring `WORLD_SHARED` on the runtime path does not authorize app, SDK, or Realm bypasses for canonical agent writes

## K-AGCORE-012 Life Track Runtime Loop

`RuntimeAgentService` owns the internal Life Track execution loop as a runtime-private lifecycle, not as an app-facing RPC surface.

Fixed rules:

- the loop must scan committed hook store truth rather than caller-provided snapshots
- due-hook execution must emit outcomes and events through the same committed hook store and committed event log path used by public read surfaces
- the loop must be startable and stoppable with daemon lifecycle so shutdown does not leave hidden background execution running
- when runtime has not yet admitted a concrete Life Track executor, due hooks must fail closed with an explicit terminal rejection or failure outcome rather than silent retention or pseudo-success
- host-owned trigger admission follows current canonical authority;
  non-admitted trigger timing must not be synthesized into immediate execution
  inside the loop

## K-AGCORE-013 Runtime-Private Life Turn Executor

`RuntimeAgentService` may execute Life Track turns through an in-process runtime-private executor.

It owns:

- hook gate and scheduler truth
- admitted Life Turn input assembly
- canonical memory admission and write projection
- status projection mutation
- budget accounting
- committed event emission

The AI layer may supply model execution only. It does not own scheduler truth, agent truth, memory truth, or public agent contracts.

Fixed rules:

- the admitted runtime-private Life Turn request must include committed `AgentRecord`, committed `AgentStateProjection`, the triggering `PendingHook`, admitted canonical recall set, and autonomy snapshot
- the admitted runtime-private Life Turn result is limited to `status_text`
  diff, posture patch, emotion update, canonical memory candidates, typed
  `HookIntent`, summary, and token usage
- the model-facing Life Turn executor output contract is the APML
  `<life-turn>` root admitted by `agent-output-wire-contract.md`; JSON executor
  output compatibility is not admitted
- the runtime-private executor must not admit arbitrary attribute mutation, free-form hook logic, direct world/user state mutation, or proactive app-facing initiate-chat semantics
- canonical memory candidates returned by the executor must still pass RuntimeAgentService-owned canonical class and bank-scope admission before Memory Service writes occur
- typed `HookIntent` returned by the executor must still pass the same
  runtime-owned validator and hook-admission path used elsewhere on
  RuntimeAgentService
- invalid executor output must fail closed with observable terminal hook failure rather than implicit completion, pseudo-success, or silent drop

## K-AGCORE-014 Replication Event Projection Source

`RuntimeAgentService` must project replication events from the committed
retained runtime-private memory replication update source.

Fixed rules:

- `AGENT_EVENT_TYPE_REPLICATION` must derive from committed `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` events rather than from immediate write-result decoration or snapshot inference
- RuntimeAgentService may project only canonical bank scopes admitted on its public path; infra-scope memory banks must not synthesize canonical agent replication events
- `AGENT_CORE` and `AGENT_DYADIC` replication updates project to the owning `agent_id`
- `WORLD_SHARED` replication updates project to agents whose committed `active_world_id` matches the world-scoped bank owner
- RuntimeAgentService cursor replay and live subscription must observe the same replication event ordering as the committed memory replication source after RuntimeAgentService projection commit

## K-AGCORE-015 Runtime-Private Behavioral Posture Truth

`RuntimeAgentService` owns behavioral posture as runtime-private machine truth for live agent execution.

It owns:

- committed posture state
- posture validation
- truth-basis binding
- chat-track and life-track posture transitions
- projection of posture into human-readable state text

It does not own:

- public renderer-local posture truth
- Memory Service storage for admitted truths

Fixed rules:

- behavioral posture must remain distinct from `AgentStateProjection.status_text`; `status_text` is a projection, not the authoritative posture state
- posture truth must retain explicit linkage to the admitted truth ids that constrain it when such linkage is present
- chat-track and life-track outputs may propose posture mutation only through admitted runtime-private typed contracts validated by RuntimeAgentService
- invalid posture output must fail closed rather than silently mutating committed state
- behavioral posture remains runtime-private machine truth; only the narrower
  read-only `PostureProjection` admitted through `K-AGCORE-037` may cross the
  public RuntimeAgentService surface

## K-AGCORE-027 Life-Track Cadence Ownership

`RuntimeAgentService` owns proactive Life Track cadence as runtime-owned
scheduler truth.

It owns:

- explicit opt-in autonomy mode for proactive Life Track execution
- baseline cadence tick policy
- host-owned reconciliation between cadence tick and typed HookIntent timing
- hook cadence-interaction semantics for long-running hooks
- spacing, suspension, and budget gates applied after cadence selection

It does not own:

- Desktop-only preset truth for cadence mode
- renderer-local scheduling logic
- provider/model-owned scheduling logic

Fixed rules:

- proactive Life Track execution must remain explicit opt-in and default-off
- admitted runtime-owned autonomy mode is bounded to `off`, `low`, `medium`,
  and `high` unless a later rule admits a wider family
- cadence and quota must remain distinct concerns; token budget is not primary
  frequency truth
- typed `HookIntent` may request callback timing, but host runtime
  remains the only owner of effective next-run computation
- admitted hook cadence interaction must remain typed rather than a freeform
  boolean or scheduler blob
- long-running hook suppression may delay baseline cadence tick only through
  admitted hook cadence interaction semantics validated by RuntimeAgentService
- `min_hook_interval` or its admitted successor remains a hard lower-bound
  spacing gate after cadence and callback timing are reconciled
- Chat Track remains reactive and available regardless of proactive Life Track
  cadence mode

## K-AGCORE-028 Source/Profile And Binding Mutation Event Grammar

`RuntimeAgentService` owns the durable mutation-event grammar for
account-scoped source/profile truth and runtime binding truth.

It owns:

- committed mutation events for `account_agent_source_revision`
- committed mutation events for `runtime_agent_binding`
- replay-visible revision expectation and conflict posture
- replay-visible forceful replacement and binding cutover outcomes

It does not by itself admit:

- a final public RPC/update taxonomy
- full wire-format lock-in for mutation envelopes
- one final conflict-resolution algorithm

Fixed rules:

- source/profile mutation and binding mutation must not exist only as protocol
  traffic or host-local narrative reason text; they must commit through explicit
  durable mutation event families
- `expected_revision_id`, conflict, and forceful replacement semantics must stay
  reconstructable through committed mutation events and replay
- free-form `reason` text may remain auxiliary audit context, but it must not
  become the sole durable mutation truth
- this rule lands the canonical event-grammar requirement without by itself
  expanding the current public RPC method family

## K-AGCORE-029 Narrow Multi-Agent Delegation Authority Boundary

`RuntimeAgentService` admits a narrow multi-agent claim centered on durable
delegation lifecycle rather than a full delegated-authority trust model.

It owns:

- durable delegation lifecycle
- supervisor accountability
- scheduler attribution and coordination visibility
- runtime-visible delegation identity and recovery semantics

It does not yet own:

- delegated `on-behalf-of` authority minting
- delegated grant attenuation rules
- delegated approval inheritance
- delegated secret-scope semantics

Fixed rules:

- delegation does not mint new principal authority by itself
- worker-side externally governed effects remain constrained by ordinary
  principal, capability, approval, and trust gates
- any future delegated-authority model must land through a separate admitted
  packet or rule rather than being inferred from delegation existence alone

## K-AGCORE-030 Turn/Stream Terminal Coupling

`RuntimeAgentService` owns the minimum terminal-coupling rules between `turn`
truth and owned `stream` truth.

Fixed rules:

- one `turn` may own multiple `stream` units
- a `turn` must not enter `completed` while its owned foreground response
  streams remain in non-terminal live state
- turn interruption or abandonment must propagate interrupt or terminal
  semantics onto its still-live owned streams
- a `stream` may outlive one `turn` only when its longer-running `activity`
  anchor is explicit and replayable

## K-AGCORE-031 Temporal-Autonomy Deferral Boundary

`RuntimeAgentService` does not yet admit timer/deadline/wake-style
temporal-autonomy objects as canonical runtime truth.

Fixed rules:

- the admitted autonomy baseline remains the scheduler/budget/lease/cadence
  model already frozen elsewhere on the spec path, plus the narrow-admit
  `HookIntent` surface defined in `agent-hook-intent-contract.md`
- spec text must not imply canonical timer, deadline, wakeup, appointment, or
  alarm truth without a later dedicated admission
- admitted `HookIntent` does not create a general temporal object model; it is
  limited to relative delay and event-triggered follow-up continuation
- proactive cadence ownership under `K-AGCORE-027` does not by itself imply a
  full time-driven assistant object model

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-participation-contract.md -->

# Runtime Agent Participation Contract

> Owner Domain: `K-AGCORE-*`

This contract admits Runtime-owned agent participation semantics for contexts
that are not always canonical 1:1 Agent Chat.

It defines Runtime authority only. It does not create SDK, proto, Desktop,
Avatar, app, Realm implementation, OASIS, Scenario, A2A production, or MCP
production surfaces.

## K-AGCORE-061 Runtime Participation Authority

Runtime owns agent participation execution semantics.

It owns:

- participation profile validation
- typed context block admission
- prompt assembly policy for participation execution
- AI consume / provider routing for participation execution
- output candidate schema
- memory read verdict
- memory write verdict
- capability scope verdict
- audit/replay linkage
- same-agent cross-profile concurrency admission

Runtime does not own:

- Realm GROUP thread, membership, message, read-state, sync, or commit truth
- Scenario package, run, branch, replay, or transcript truth
- OASIS/world state, event log, or product ontology
- Desktop, Web, or Avatar UI state
- A2A or MCP protocol wire truth

## K-AGCORE-062 Non-Canonical Candidate Posture

Every participation profile except `canonical_agent_chat` is non-canonical by
default.

Non-canonical output:

- must be returned as an output candidate
- must not write memory by default
- must not commit cognition by default
- must not mutate Realm source-core by default
- must not become canonical chat history by default

Promotion into memory, cognition, Realm source-core, or canonical chat requires a
separate explicit promotion authority.

## K-AGCORE-063 Axis Registry

Participation axes are closed and defined by
`tables/agent-participation-axis-model.yaml`.

The fixed axis families are:

- `transcript_owner`
- `identity_source`
- `execution_owner`
- `memory_read_scope`
- `memory_write_default`
- `capability_scope`
- `input_trust`
- `output_destination`
- `promotion_posture`
- `execution_concurrency`

Apps, SDKs, and product domains must not submit open string axis values.

## K-AGCORE-064 Transcript Owner Axis

`transcript_owner` identifies the owner of transcript or event-log truth.

Fixed values:

- `RUNTIME`
- `REALM`
- `SCENARIO_MODULE`
- `OASIS_WORLD_DOMAIN`
- `EXTERNAL_DOMAIN`
- `EPHEMERAL`

Transcript owner does not imply execution owner.

## K-AGCORE-065 Identity Source Axis

The former advanced-participation identity-source matrix is deferred and is not
a current Runtime product contract. In particular,
`MCP_BACKED_AI_CAPABILITY` is not an admitted participant identity.

## K-AGCORE-066 Execution Owner Axis

`execution_owner` identifies who assembles prompt/context and calls AI.

Fixed values:

- `RUNTIME`
- `EXTERNAL_RUNTIME_VIA_ADMITTED_GATEWAY`
- `NOT_ADMITTED`

External execution does not transfer boundary ownership. Runtime still owns
gateway verdict, policy, audit, and output candidate semantics.

## K-AGCORE-067 Memory Read Scope Axis

`memory_read_scope` identifies which memory may be loaded into participation
execution context.

Fixed values:

- `CANONICAL_OWNER_POLICY`
- `DYADIC_PRIVATE_ALLOWED`
- `DYADIC_PRIVATE_EXCLUDED`
- `PUBLIC_SHARED_ONLY`
- `DOMAIN_SHARED_ONLY`
- `NO_MEMORY_READ`

Non-canonical participation profiles must not read dyadic/private canonical
memory by default.

## K-AGCORE-068 Memory Write Default Axis

`memory_write_default` identifies whether participation output may write durable
agent truth by default.

Fixed values:

- `CANONICAL_WRITE_ALLOWED`
- `WRITE_NONE`
- `PROMOTION_GATED`

`WRITE_NONE` is the default for non-canonical profiles.

## K-AGCORE-069 Capability Scope Axis

`capability_scope` identifies which tools, files, delegated capabilities,
Realm source-core mutations, paid/cloud operations, or provider access may be used.

Fixed values:

- `CANONICAL_AGENT_SCOPE`
- `PROFILE_LIMITED`
- `DOMAIN_LIMITED`
- `DIAGNOSTIC_READ_ONLY`
- `EXTERNAL_GATEWAY_LIMITED`
- `NONE`

Canonical Agent Chat capability grants do not carry into non-canonical
participation profiles by default.

## K-AGCORE-070 Input Trust Axis

`input_trust` identifies how prompt assembly must rank and isolate input.

Fixed values:

- `TRUSTED_USER`
- `UNTRUSTED_MULTI_PARTY_TRANSCRIPT`
- `SANDBOX_SCRIPT`
- `EXTERNAL_A2A_PAYLOAD`
- `TOOL_PROVIDER_PAYLOAD`
- `WORLD_CONTEXT`
- `DIAGNOSTIC_INPUT`

Untrusted transcript and protocol payload content must remain below Runtime
system, policy, and profile instructions in prompt assembly.

## K-AGCORE-071 Output Destination Axis

`output_destination` identifies where an output candidate may be committed.

Fixed values:

- `CANONICAL_CHAT`
- `REALM_GROUP_MESSAGE_CANDIDATE`
- `SCENARIO_TURN_CANDIDATE`
- `WORLD_EVENT_CANDIDATE`
- `EXTERNAL_REPLY_CANDIDATE`
- `DIAGNOSTIC_CANDIDATE`
- `EPHEMERAL`

Candidate destination does not authorize direct domain commit.

## K-AGCORE-072 Promotion Posture Axis

`promotion_posture` identifies whether and how non-canonical output may become
durable agent truth.

Fixed values:

- `NOT_ALLOWED`
- `EXPLICIT_CANDIDATE`
- `EXPLICIT_COMMIT_FLOW`
- `EXISTING_CANONICAL_POLICY`

Promotion remains fail-closed until a later authority admits the promotion flow.

## K-AGCORE-073 Execution Concurrency Axis

`execution_concurrency` identifies how simultaneous participation triggers for
the same agent are admitted.

Fixed values:

- `CANONICAL_CHAT_BUDGET`
- `PER_AGENT_PARTICIPATION_QUEUE`
- `PROFILE_ISOLATED_BUDGET`
- `DOMAIN_TRIGGER_QUEUE`
- `REJECT_WHILE_ACTIVE`
- `GATEWAY_BUDGET_QUEUE`
- `LOW_PRIORITY_CANCELABLE`

Runtime owns same-agent cross-profile queueing, cancellation, and budget
admission. Apps, Realm, Scenario, OASIS/world, external gateways, and debug
surfaces must not own this decision.

This axis must preserve `K-AGCORE-002`, `K-AGCORE-007`, and `K-AGCORE-027`.
It does not create a second Chat Track, Life Track, token-budget, or cadence
owner.

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-participation-domain-promotion-contract.md -->

# Runtime Agent Participation Domain Promotion Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-095 Domain Future Seam Matrix

Domain future-consumer seam rules are defined by
`tables/agent-participation-domain-future-seams.yaml`.

The matrix describes how OASIS/world and Scenario Sandbox may consume Runtime
participation authority in the future. It does not implement those product
domains and does not redefine their transcript, state, history, run, replay, or
commit truth.

Every domain future seam row must declare:

- participation profile
- transcript owner
- identity source
- execution owner
- authority references
- required context blocks
- admitted typed context shape
- forbidden raw context shape
- memory read scope
- memory write default
- capability scope
- output destination
- promotion posture
- commit owner
- Runtime direct-commit posture
- product ontology implementation posture

## K-AGCORE-096 OASIS World Participation Future Seam

`oasis_world_participation` is a future-consumer seam for world participation.

Runtime participation may consume typed world context, event, visible state, and
recent transcript/event projections. Runtime participation must not define world
product ontology, world prompt shape, Realm/OASIS truth, world history, or world
commit authority.

Fixed posture:

- `K-WEV-*` may be referenced for Runtime-local world execution evidence only
- Realm/OASIS world truth and history remain domain-owned
- public raw world prompt blobs are forbidden
- app-local world agent execution authority is forbidden
- output remains a `WORLD_EVENT_CANDIDATE`
- Runtime direct world truth commit is forbidden
- memory/cognition/canonical-chat writes remain forbidden until future
  promotion authority admits them

## K-AGCORE-097 Scenario Sandbox Future Seam

`scenario_sandbox` is a pending future-consumer seam for a standalone Scenario
Sandbox product domain.

Runtime participation may consume typed scenario package, run, branch, visible
scene state, and recent sandbox transcript projections. Runtime participation
must not implement scenario product ontology, scenario replay branches, scenario
transcript storage, ScenarioJob execution, or custom prompt APIs.

Fixed posture:

- the pending Scenario Sandbox product requirement remains product-domain
  pressure, not active implementation
- `K-JOB-*` may be referenced only as existing ScenarioJob lifecycle authority
- public raw scenario prompt blobs and custom prompt APIs are forbidden
- app-local scenario agent execution authority is forbidden
- output remains a `SCENARIO_TURN_CANDIDATE`
- Runtime direct scenario transcript/run/replay commit is forbidden
- memory/cognition/canonical-chat writes remain forbidden until future
  promotion authority admits them

## K-AGCORE-098 Domain Truth Separation

Runtime participation owns execution semantics only.

For domain future seams, the following remain outside Runtime participation
truth:

- OASIS/world state
- OASIS/world history
- OASIS/world commit authorization
- Scenario package ontology
- Scenario run, branch, and replay truth
- Scenario transcript storage
- product-domain visible state truth

Runtime participation output candidates are not domain commits.

## K-AGCORE-099 Product Implementation Gates

OASIS/world and Scenario Sandbox product implementation require separate
admission.

This contract does not admit:

- OASIS/world product UI or backend implementation
- Scenario Sandbox product UI or backend implementation
- ScenarioJob execution changes
- SDK/proto/app/Desktop/Avatar public surfaces
- promotion implementation
- world/scenario product success fixtures

## K-AGCORE-100 Domain Future Seam Negative Gates

Domain future seams must be audited with negative gates for:

- raw world prompt blobs
- raw scenario prompt blobs
- Runtime direct world truth commit
- Runtime direct scenario transcript/run/replay commit
- app-local world agent execution
- app-local scenario agent execution
- fake world/scenario product success
- memory/cognition/canonical-chat writes before promotion admission

Matches in Runtime/Realm kernel contracts, generated docs, pending requirement notes,
or explicit prohibition text are allowed evidence only when they preserve domain
truth ownership and do not create product implementation support.

## K-AGCORE-101 Promotion Boundary Registry

Promotion boundaries are defined by
`tables/agent-participation-promotion-boundaries.yaml`.

Promotion is explicit candidate admission. It is not default write behavior and
it is not a transport implementation.

Every promotion target row must declare:

- target id
- owning authority contract or future authority
- owning rule family
- admitted source profiles
- forbidden source profiles
- required evidence
- default write posture
- direct-write posture
- missing-evidence policy

## K-AGCORE-102 Runtime Memory Or Cognition Promotion Target

Promotion into Runtime memory or cognition may be admitted only through the
owning `K-MEM-*` and `C-COG-*` authority boundaries.

Runtime participation must not directly write memory or cognition. It may only
produce a promotion candidate carrying output candidate provenance, audit
lineage, policy verdicts, memory/capability verdicts, target owner
authorization, and explicit user or manager intent.

External-entry and debug/probe profiles are not admitted as source profiles for
this target.

## K-AGCORE-103 Canonical Chat Promotion Target

Promotion into canonical chat must preserve existing RuntimeAgentService
canonical chat authority.

Runtime participation must not append canonical chat history directly. It may
only produce a promotion candidate for owner-authorized canonical handling.

External-entry and debug/probe profiles are not admitted as source profiles for
this target.

## K-AGCORE-104 Realm GROUP Transcript Promotion Target

Realm GROUP transcript commit remains owned by Realm Chat.

Runtime participation must not directly commit Realm GROUP messages. A Realm
GROUP promotion candidate is valid only for `realm_group_source` and must carry
Realm thread, agent slot, audit, output candidate, and authenticated commit
references.

## K-AGCORE-105 Domain Truth Promotion Target

Domain truth promotion remains owned by the target domain.

Runtime participation must not directly commit:

- OASIS/world state
- OASIS/world history
- Scenario transcript
- Scenario run/branch/replay truth
- external-domain truth

`scenario_sandbox` and `oasis_world_participation` may produce domain truth
promotion candidates only when target domain owner authorization and target
commit candidate references are present.

## K-AGCORE-106 Promotion Fail-Closed Invariants

Promotion is fail-closed.

Forbidden:

- non-canonical default writes
- app-local promotion decisions
- external principal self-promotion
- debug/probe promotion
- side audit stores
- promotion transport implementation without promotion transport admission
- open-string promotion targets

Required for every promotion candidate:

- target owner
- audit lineage
- provenance
- policy verdict
- source profile
- output candidate reference
- missing-required-input policy of `fail_closed`

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-participation-policy-boundary-contract.md -->

# Runtime Agent Participation Policy Boundary Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-084 Memory Policy Tables

Memory read and write policy defaults are defined by:

- `tables/agent-participation-memory-read-scopes.yaml`
- `tables/agent-participation-memory-policy.yaml`

Non-canonical profiles must default to no dyadic/private canonical memory read
and no memory/cognition/canonical-chat write.

## K-AGCORE-085 Capability Scope Table

Capability scope defaults are defined by
`tables/agent-participation-capability-scopes.yaml`.

Canonical Agent Chat capability grants must not automatically carry into
non-canonical participation profiles.

Realm source-core mutation, private file access, paid/cloud capability use, external
provider calls, and delegated tool execution require an admitted capability
scope for the active participation profile.

## K-AGCORE-086 Concurrency Policy Table

Same-agent cross-profile admission is defined by
`tables/agent-participation-concurrency-policy.yaml`.

Runtime owns:

- cross-profile queueing
- cancellation
- budget admission
- active execution rejection
- audit linkage for admission decisions

This policy must preserve `K-AGCORE-002`, `K-AGCORE-007`, and `K-AGCORE-027`.

## K-AGCORE-087 Audit And Replay

Participation execution audit must layer on existing Runtime audit authority.

Fixed rules:

- audit event fields must satisfy `K-AUDIT-001` and `K-AUDIT-006`
- participation audit may add domain extension fields
- replay lineage must reference `audit_id`
- no participation-specific side audit store is admitted
- delegated external-entry replay may reference `K-DELEG-085` and
  `K-DELEG-086` as external evidence lineage, without modifying `K-DELEG-*`

## K-AGCORE-088 Public Raw Prompt Boundary

Public participation surfaces must not accept raw prompt blobs as their primary
semantic input.

Allowed public input shape is typed context block references plus policy and
identity refs.

Runtime-internal backend parameters such as private `systemPrompt` fields are
implementation details. They are not public raw-prompt APIs by themselves.

## K-AGCORE-089 External Entry Boundary Matrix

External-entry boundary rules are defined by
`tables/agent-participation-external-entry-boundaries.yaml`.

The matrix is the Runtime participation view over external protocol pressure. It
does not define protocol wire truth and does not rewrite `K-DELEG-*`.

Every external-entry boundary row must declare:

- participation profile
- identity source
- input trust
- protocol authority contract and rule range
- required context blocks
- required gateway/firewall/audit/credential verdict references
- memory read scope
- memory write default
- capability scope
- output destination
- promotion posture
- production-claim posture

## K-AGCORE-090 Deferred MCP-Backed Participation

MCP-backed participation is unavailable. Runtime exposes no current MCP-backed
participant identity, external-entry admission, tool availability, execution,
promotion, or production-claim posture. A gateway or firewall type cannot
activate this deferred product surface.

## K-AGCORE-091 Future A2A External Agent Entry

`EXTERNAL_A2A_AGENT` is a future-seam participation identity source only.

Fixed posture:

- `K-DELEG-120..129` owns A2A future-seam and no-production posture
- A2A task payloads, agent cards, remote state, and protocol metadata are not
  Runtime participation semantic authority
- production A2A adapter activation, Runtime registration, SDK/proto public
  surface, app/Desktop UI claim, and fake-server success are forbidden without a
  separate high-risk admission
- future A2A entry must still pass Runtime gateway, policy, audit, and firewall
  boundaries before any projection or action
- Nimi memory, cognition, canonical chat, Realm GROUP, and product-domain writes
  are forbidden by default

## K-AGCORE-092 External Principal Writeback Boundary

External participants cannot commit Nimi semantic truth by default.

Forbidden writeback targets:

- Runtime memory
- cognition memory/commit surfaces
- canonical chat history
- Realm GROUP transcript
- Scenario transcript
- OASIS/world event truth
- product-domain transcript or state truth

Any future promotion from external output requires a later explicitly admitted
promotion path and must preserve `K-AGCORE-084`, `K-AGCORE-087`, `K-DELEG-*`,
`K-MEM-*`, and cognition authority.

## K-AGCORE-093 External Entry Gateway Chain

External-entry projection is fail-closed unless the gateway chain is complete.

The required order is:

1. external identity evidence
2. protocol adapter or future admission check
3. gateway verdict
4. delegated firewall verdict when protocol execution occurs
5. capability scope verdict
6. memory read verdict
7. memory write verdict
8. audit lineage record
9. output candidate projection

Pre-verdict consumption is forbidden. Missing verdicts fail closed.

## K-AGCORE-094 External Entry Negative Gates

External-entry alignment must be audited with negative gates for:

- production A2A claims
- direct MCP clients or Runtime MCP adapter activation
- direct A2A clients outside a future admitted Runtime adapter
- raw protocol payload public participation fields
- `K-DELEG-*` rule redefinition in participation authority
- fake external server success

Matches in `K-DELEG-*` contracts, generated docs, or explicit prohibition text
are allowed evidence only when they preserve protocol/gateway ownership and do
not create public implementation support.

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-participation-profile-contract.md -->

# Runtime Agent Participation Profile Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-074 Profile Registry

Participation profile kinds are closed and defined by
`tables/agent-participation-profiles.yaml`.

Fixed profile kinds:

- `canonical_agent_chat`
- `realm_group_source`
- `scenario_sandbox`
- `oasis_world_participation`
- `external_agent_entry`
- `debug_or_probe`

Profiles are axis compositions. They are not product-local lane names and must
not be open string extensible by apps.

## K-AGCORE-075 Canonical Agent Chat Reference Profile

`canonical_agent_chat` references existing `RuntimeAgentService` authority.

It does not rewrite:

- canonical conversation anchors
- Chat Track / Life Track separation
- token budget authority
- Life Track cadence authority
- admitted canonical memory policy

Those remain governed by `K-AGCORE-*`.

## K-AGCORE-076 Realm Group Agent Profile

`realm_group_source` represents a Runtime-executed agent reply candidate for a
Realm GROUP transcript.

Fixed posture:

- `transcript_owner = REALM`
- `execution_owner = RUNTIME` by default
- `memory_read_scope = DYADIC_PRIVATE_EXCLUDED`
- `memory_write_default = WRITE_NONE`
- `capability_scope = PROFILE_LIMITED`
- `input_trust = UNTRUSTED_MULTI_PARTY_TRANSCRIPT`
- `output_destination = REALM_GROUP_MESSAGE_CANDIDATE`
- `promotion_posture = EXPLICIT_CANDIDATE`
- `execution_concurrency = PER_AGENT_PARTICIPATION_QUEUE`

Runtime must not directly commit GROUP messages. Realm-authenticated commit and
anti-spoof validation remain governed by `R-CHAT-*`.

## K-AGCORE-077 Scenario Sandbox Profile

`scenario_sandbox` is a future-consumer profile.

It does not admit Scenario product ontology, scenario package truth, scenario
prompt language, or scenario implementation.

Fixed posture:

- memory read is domain-shared or no-read by default
- memory write is `WRITE_NONE`
- capability scope is scenario/domain limited
- output is a scenario turn candidate

## K-AGCORE-078 OASIS World Participation Profile

`oasis_world_participation` is a future-consumer profile for world/domain
contexts.

It does not admit OASIS/world product ontology.

Fixed posture:

- memory read is world-shared or no-read by default
- memory write is `WRITE_NONE`
- capability scope is world/domain limited
- output is a world event/domain candidate

## K-AGCORE-079 External Agent Entry Profile

`external_agent_entry` is a deferred profile name only. Runtime admits no
current A2A or MCP participant, external-entry identity, gateway protocol, or
participation capability through this profile. Any future admission requires a
separately decided owner and canonical contract; until then the profile remains
unavailable and does not affect ordinary LocalAgent readiness.

## K-AGCORE-080 Debug Or Probe Profile

`debug_or_probe` represents diagnostic participation.

It consumes existing `K-AGCORE-036..052` projection surfaces and does not create
presentation truth ontology.

Fixed posture:

- diagnostic-minimal memory read
- `WRITE_NONE` memory write default
- diagnostic read-only capability scope
- diagnostic/probe candidate output
- `NOT_ALLOWED` promotion posture

## K-AGCORE-081 Context Block Registry

Typed context blocks are closed and defined by
`tables/agent-participation-context-blocks.yaml`.

Context blocks must be profile-scoped. Product domains may provide typed
references, projections, and gateway verdict references, but they must not
submit raw prompt blobs as public participation input.

## K-AGCORE-082 Output Candidate

Every Runtime participation execution returns a typed output candidate.

Required fields:

| Field | Type | Required |
|---|---|---|
| `participation_id` | string | yes |
| `profile_kind` | enum | yes |
| `agent_id` | string | conditional |
| `identity_source` | enum | yes |
| `participant_ref` | string | yes |
| `trigger_ref` | string | yes |
| `context_block_refs` | list of string | yes |
| `output_destination` | enum | yes |
| `candidate_ref` | string | yes |
| `policy_verdict_ref` | string | yes |
| `memory_read_verdict` | enum | yes |
| `memory_write_verdict` | enum | yes |
| `capability_scope_verdict` | enum | yes |
| `audit_id` | string | yes |
| `created_at` | timestamp | yes |

Inline raw provider output, raw prompt chains, or raw protocol payloads are not
admitted as public candidate fields.

## K-AGCORE-083 Domain Commit Separation

Output candidates do not commit domain transcript truth.

Domain commit remains owned by the domain:

- Realm GROUP commit remains `R-CHAT-*`
- Scenario transcript commit remains future Scenario authority
- OASIS/world event commit remains future world authority
- external reply commit remains the owning domain/external path

---

<!-- source: .nimi/spec/runtime/kernel/realm-group-participation-consumer-contract.md -->

---
id: SPEC-RUNTIME-KERNEL-REALM-GROUP-PARTICIPATION-CONSUMER-001
title: Realm Group Participation Consumer Contract
status: active
owner: "@team"
updated: 2026-05-13
---

# Realm Group Participation Consumer Contract

> Domain: K-AGCORE
> Rule family: K

## Scope

This contract defines the Runtime-side consumer boundary for Realm `GROUP` agent
participation. It binds the `realm_group_source` Runtime Participation profile to
Realm-owned group thread, membership, slot, trigger, and commit evidence without
creating a new Runtime Participation axis, Room Orchestration axis, or app-local
execution path.

## Authority Imports

- Runtime Agent Participation: `K-AGCORE-061`, `K-AGCORE-073`,
  `K-AGCORE-086`, `K-AGCORE-104`.
- Runtime Room Orchestration: `K-AGCORE-107` through `K-AGCORE-118`.
- Realm Group product authority: `R-CHAT-008` through `R-CHAT-014`.

## K-AGCORE-119

Realm Group participation is a Runtime Agent Participation consumer bound to the
existing `realm_group_source` profile. Runtime must not create a new participation
profile, concurrency axis value, capability scope, or memory policy for this
product surface.

## K-AGCORE-120

Runtime `realm_group_source` admission must consume only typed Realm group context
references declared in `tables/realm-group-participation-context.yaml`. Context
may include thread, membership snapshot, agent slot, trigger event, read cursor,
reply target, room orchestration, and Realm commit handoff references. Raw prompt
blobs, provider/model hints, unbounded transcript dumps, app-local participant
lists, and direct commit handles are forbidden context inputs.

## K-AGCORE-121

Runtime may produce `REALM_GROUP_MESSAGE_CANDIDATE` output only. Candidate output
must carry enough lineage for Realm to validate thread owner, slot binding,
trigger evidence, moderation/refusal posture, and audit/replay before commit.
Runtime must not directly write Realm `GROUP` messages or mark Realm commit as
successful.

## K-AGCORE-122

Realm Group participation inherits Runtime Agent Participation policy for memory
read scope, memory write default, capability scope, and same-agent concurrency.
The product default remains `DYADIC_PRIVATE_EXCLUDED`, `WRITE_NONE`, and
`PROFILE_LIMITED`. Runtime must fail closed if a consumer requests `GROUP_LIMITED`
or group-local memory write/default concurrency values outside the closed
participation tables.

## K-AGCORE-123

Same-room ordering, fairness, queueing, budget allocation, cancellation, timeout,
status projection, external participant admission, and commit-race handoff for
Realm Group participation are owned by Runtime Room Orchestration. Runtime
consumers must bind to the closed `realm_group` matrix row and overlay and must
not accept a Realm, SDK, Desktop, Web, or app-local same-room scheduler.

## K-AGCORE-124

Realm Group participation consumer implementation must fail closed on Desktop or
Web prompt assembly, provider/model routing, app-local reply queue truth,
Runtime direct Realm commit, public `runtime.orchestration.*` status namespace,
external participant gateway bypass, or any reopening of `K-AGCORE-073`,
`K-AGCORE-086`, the Runtime Participation profile registry, or the Room
Orchestration axis/matrix/overlay registries.

<!-- source: .nimi/spec/avatar/kernel/companion-participation-consumer-contract.md -->

# Companion Participation Consumer Contract

> App: `@nimiplatform/avatar`
> Owner Domain: Avatar consumer projection, downstream of Runtime `K-AGCORE-*`

This contract defines how Avatar companion/persona and Avatar debug/probe
surfaces consume Runtime Agent Participation projection. It does not create a
Runtime Participation profile and does not grant execution authority to any app
surface.

## Authority Boundary

Runtime owns participation execution semantics:

- profile validation
- prompt assembly
- provider/model routing
- memory/capability verdicts
- concurrency, budget, cancellation, and audit lineage
- output candidates and promotion posture

Avatar-owned surfaces may only:

- display typed participation projection
- display typed presentation timeline state
- expose bounded controls that call Runtime/SDK typed methods
- emit Avatar-local UI/render/debug evidence
- render refusal, blocked, pending, running, candidate, committed, or failed
  states from typed projection

Avatar-owned surfaces must not:

- assemble prompts
- call providers or models directly
- read or write memory/cognition/domain/canonical truth
- consume raw APML/debug/MCP/A2A payloads as product truth
- create private queues, schedulers, fairness budgets, cancellation budgets, or
  Runtime queue status namespaces
- commit Realm/Scenario/OASIS/domain transcripts

## Surface Kinds

Closed surface kinds are defined in
[`tables/companion-participation-surface-kinds.yaml`](tables/companion-participation-surface-kinds.yaml).

The initial admitted kinds are:

- `avatar_companion`
- `desktop_companion_panel`
- `avatar_debug_workbench` (stable typed probe-client vocabulary; not a
  Desktop-local workbench UI)

Avatar package/persona choices, such as assistant, character, virtual singer,
or other stylized persona, are configuration and content choices inside the
Avatar product. They are not separate participation surface kinds and do not
create independent execution owners.

## Projection Model

The Avatar consumer reads `runtime.companionParticipation` through the Runtime
SDK typed module. Avatar product code must not call `runtime.agent.turns`
directly for companion participation requests or cancellation. The projection
must include:

- `projection_id`
- `agent_id`
- `surface_kind`
- `profile_ref`
- `room_orchestration_ref` when more than one participant or domain context is
  involved
- `trigger_source`
- `status`
- `candidate_ref` when Runtime has produced an output candidate
- `refusal_reason` when Runtime or room orchestration refuses admission
- `presentation_ref` when the projection is visual/presentation-only
- `audit_ref`

Avatar may cache the projection only as transient UI state. It may not promote
projection content into durable product truth.

## Avatar Implementation Binding

The Avatar shell bootstrap owns the first-party Runtime binding and exposes
only Avatar-local handle methods backed by SDK companion participation:

- text submit routes to `runtime.companionParticipation.request`
- foreground voice transcript submit routes to the same request method
- interrupt/cancel routes to `runtime.companionParticipation.cancel`

The companion surface renders Runtime/SDK projection status as UI state. It
must treat `blocked`, `failed`, and `canceled` as non-success states and must
not fall back to local text-turn execution.

## Status Semantics

Allowed status values:

- `idle`
- `admission_pending`
- `blocked`
- `running`
- `candidate_ready`
- `committed_by_owner`
- `failed`
- `canceled`

`candidate_ready` means Runtime has produced a candidate. It does not mean the
candidate has been committed to domain truth.

`committed_by_owner` may be displayed only when the domain owner or canonical
chat owner returns a typed commit projection. Avatar must not infer commit from
candidate content.

## Trigger Policy

Trigger policy is defined in
[`tables/companion-participation-trigger-policy.yaml`](tables/companion-participation-trigger-policy.yaml).

Allowed trigger sources:

- `none`
- `user_explicit`
- `scheduled_proactive`
- `domain_event`

Every non-`none` trigger must route through Runtime participation admission and,
where applicable, room/session orchestration. A trigger source never grants
prompt, provider/model, memory, cognition, queue, or commit authority.

## Domain Consumption

For Group, Scenario, OASIS/world, and external-entry contexts:

- the domain-specific profile/overlay remains the owner of domain context and
  commit handoff
- Avatar companion/persona surfaces display typed projection only
- missing domain evidence fails closed before Runtime candidate handoff
- raw domain payloads must not be passed to Avatar as prompt material

## Debug / Probe Consumption

Avatar debug/probe surfaces may show typed Runtime or Avatar evidence:

- Runtime probe ids and replay refs
- Avatar backend evidence
- refusal and remediation states
- visual carrier evidence

They must not consume raw backend bus payloads, raw APML diagnostics, delegated
provider output, app auth material, or private Runtime internals.

## Fail-Closed Rules

The surface must show a blocked/failed state when:

- projection is missing required ids
- trigger source is unknown
- surface kind is unknown
- profile ref is missing for an execution request
- room orchestration ref is missing for multi-participant/domain contexts
- Runtime refusal reason is present
- candidate ref is missing for `candidate_ready`
- commit projection is missing for `committed_by_owner`

No UI may convert these failures into a successful reply, synthetic candidate,
or local fallback execution.

## Agent Center Appearance Boundary

Avatar may consume Agent Center appearance inputs only as admitted local asset
references and Runtime/SDK presentation projection. This boundary admits local
Live2D/VRM/background refs, validation evidence, and launch bridge inputs, but
does not admit any Agent Center model, provider, Runtime Agent AI Config,
memory, transcript, Runtime snapshot, route, or turn execution truth.

Avatar package resolvers and bridge payload parsers must reject Runtime AI
config fields, provider/model route fields, memory fields, transcript/session
recovery fields, Runtime snapshot fields, and arbitrary key growth. Avatar
package gates remain required before RLA5 closeout.

---

<!-- source: .nimi/spec/avatar/kernel/avatar-external-entry-consumer-contract.md -->

# Avatar External Entry Consumer Contract

> Historical owner label: Avatar Kernel

## Scope

Avatar has no current external-entry participation projection. External-agent
entry, MCP-backed participation, and A2A participation remain deferred and
unavailable.

A future Avatar consumer may render only a separately admitted Runtime
projection. It cannot own external principal identity, gateway or firewall
verdicts, credential custody, consent posture, protocol adapters, provider/model
routing, audit lineage, or domain writeback.

## Upstream Authority

Any future Avatar external-entry consumption is downstream of separately
admitted Runtime participation and delegation authority. Avatar must inherit
that boundary without defining a local identity, protocol, or admission matrix.

## Consumer Shape

Avatar may render external-entry influence only after Runtime has produced an
admitted typed presentation projection or an explicitly admitted equivalent
Avatar consumer envelope.

The projection must carry Runtime-owned provenance such as `apml_output` or
`direct_api`. `direct_api` means Runtime-admitted direct projection provenance.
It does not mean a browser, localhost, sidecar, plugin, or arbitrary app can
write Avatar state directly.

## Forbidden Local Driver Authority

Avatar MUST NOT expose or own:

- an Avatar-local HTTP endpoint
- an Avatar-local WebSocket endpoint
- a browser-reachable local state endpoint
- a Petdex-style `/state` protocol
- token posture for local driver writes
- rate-limit posture for local driver writes
- user-consent posture for local driver writes
- external provider/model routing
- external credential custody
- external protocol adapter truth

These questions belong to Runtime/external-agent-entry/desktop admission, not to
Avatar.

## No Writeback

External-entry presentation consumption must remain render-only from Avatar's
perspective.

Avatar MUST NOT turn external-entry projections into:

- memory writes
- cognition writes
- canonical chat commits
- Realm GROUP commits
- product-domain commits
- provider/model routing decisions
- package activation or package lifecycle changes

## Fail-Closed Rendering

Avatar must refuse rendering of an external-entry projection when:

- Runtime admission evidence is missing
- required gateway/firewall/audit/credential verdict refs are missing
- provenance is unknown
- the projection attempts writeback
- the projection carries raw MCP/A2A/protocol payloads as semantic fields
- the projection requires an Avatar-local endpoint or local adapter protocol

Refusal must use admitted degraded/debug surfaces. It must not invent a local
fallback driver, localhost state path, fixture carrier, or static success state.

---

<!-- source: .nimi/spec/avatar/kernel/wake-local-audio-lifecycle-contract.md -->

# Wake And Local Audio Lifecycle Contract

> App: `@nimiplatform/avatar`
> Historical owner label: Avatar kernel contract
> Historical status label: active owner boundary
> Related contracts:
> - [App shell contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Avatar event contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
> - [Companion participation consumer contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
> - [Backend branch contract](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)

---

## 1. Scope

This contract defines Avatar-local handling for wake-adjacent and local-audio
lifecycle states. It does not admit wake-word activation in Avatar UI. It
establishes the owner boundary required before a future Runtime-owned wake
phrase lifecycle can be admitted.

Current admitted slice:

- Runtime-owned wake/listening/foreground response projection rendered by Avatar
- visible local audio privacy feedback for every Runtime-projected capture/playback state
- Runtime-owned turn and playback projection rendered by Avatar presentation UI
- backend-local lipsync driven by Runtime-owned audio artifacts
- fail-closed degraded and blocked states

Out of scope until separate Runtime authority admits it:

- wake-word / wake-phrase activation
- background listening
- lock-screen continuation
- hidden hot mic
- Avatar-local wake toggles
- Desktop-local wake parsing

---

## 2. Owner Boundary

| Capability | Runtime owner | Avatar owner | Desktop owner |
|---|---|---|---|
| Wake phrase admission | Owns future lifecycle, consent, model/session gating, event projection, and policy | Must not locally admit or fake wake behavior | Must not parse wake audio or create wake truth |
| Foreground voice / wake listening | Owns wake phrase lifecycle, listener fan-out, accepted turn, transcript, participation, foreground response priority, and turn lifecycle projection | Renders Runtime-projected listening/privacy/playback state and may request foreground response priority; must not start/commit microphone capture locally | May host OS permission prompts and launch handoff only |
| Background listening | Owns future admitted lifecycle if added | Forbidden in this slice | Forbidden as hidden app behavior |
| Audio playback | Owns presentation timing, artifact identity, playback state projection, and interruption truth | Owns local playback pipeline, visual speaker state, lipsync sink, and fail-closed rendering | Does not own playback truth |
| Lipsync | Owns audio artifact and presentation timing; does not own backend mouth parameters | Owns backend-local mouth driver and visible lipsync state | No ownership |
| Interrupt | Owns accepted cancellation semantics and current-turn result | Owns current-anchor interrupt affordance and request emission | May display host state but cannot cancel independently |
| Privacy feedback | Owns policy/state projection for future lifecycle modes | Must visibly render mic/audio/privacy state for every local capture/playback state | Owns OS/window-level permission surfacing only |

Boundary invariants:

1. Avatar must not enter listening from local UI state. Listening requires
   Runtime projection.
2. Avatar must not represent wake as available unless Runtime has admitted and
   projected a wake lifecycle in a future authority batch.
3. Desktop launch context may identify an Avatar instance, agent, and anchor;
   it must not supply raw wake/audio truth to Avatar.
4. Runtime turn projection is the only source for reply/pending/interrupted
   truth. Avatar UI state may be optimistic only for text composer submission
   and must fail closed on Runtime rejection.
5. Every state that uses the microphone or plays agent audio must have a visible
   privacy or activity indicator in the presence capsule.
6. Avatar autoplay is a per-agent Runtime/local-agent policy. Avatar instance
   settings must not own voice enablement, TTS route, voice reference, or model
   choice.
7. Avatar must not call TTS directly. It only consumes Runtime voice
   stream/playback projection and Runtime artifact bytes.
8. If Runtime produces text-only output because TTS is missing or unavailable,
   Avatar remains text/expression/activity only and must not show fake speaking
   or fake lipsync.

---

## 3. Lifecycle States

Avatar maps Runtime, local voice capture, audio playback, and lipsync projection
into the following closed visual lifecycle ids.

| State id | Source inputs | Avatar visual obligation | Allowed action |
|---|---|---|---|
| `idle` | ready surface, no active Runtime-projected voice/capture/playback/error | neutral presentation state; no local mic start control | request foreground priority, open composer/settings |
| `foreground_listening` | Runtime projects this avatar/agent as actively listening | active mic/listening indicator, privacy label when a visible voice overlay is admitted | no local commit; Runtime owns capture lifecycle |
| `transcribing` | Runtime projects capture/transcription in progress | busy mic indicator, capture privacy no longer active | wait or fail closed |
| `turn_pending` | transcript/typed turn submitted, Runtime active turn not yet projected | pending indicator | no mic start; allow no fake speaking |
| `assistant_speaking` | Runtime active turn/reply projection or audio playback started/requested | speaker/lipsync indicator, bounded cue/caption when available | interrupt current anchor turn |
| `interrupted` | Runtime terminal interrupted/canceled projection or local interrupt result | interrupted indicator, audio/lipsync silent | clear via next turn or anchor change |
| `muted_or_audio_unavailable` | audio playback failed/canceled/unavailable while surface remains ready | unavailable speaker indicator, no fake lipsync | text may remain based on binding availability |
| `blocked` | foreground voice availability is blocked or binding missing | mic disabled with visible blocked/error state | text/settings only where binding permits |
| `error` | local capture/submit error for current anchor | transient error indicator and bounded error text | retry explicit action |
| `runtime_degraded` | non-ready composition state | degraded surface only; no presence capsule | reload shell if admitted |
| `wake_future_unadmitted` | requested or configured wake behavior without Runtime admission | fail closed as unavailable; no toggle | none |

The ready state and any degraded state remain mutually exclusive per
`app-shell-contract.md`; lifecycle states above are sub-states of the ready
presence capsule unless explicitly marked `runtime_degraded`.

---

## 4. Runtime-Owned Voice Wake

The admitted voice mode is Runtime-owned wake/listening orchestration:

1. Runtime owns microphone listener lifecycle, wake phrase matching, consent,
   fan-out across multiple avatars, foreground respondent selection, transcript,
   accepted turn, and final reply truth.
2. Avatar may request foreground response priority by double-click or context
   menu. This is only an intent signal; it is not a local capture start.
3. Avatar renders Runtime-projected voice/listening/playback/lipsync state when
   Runtime emits it.
4. Avatar must not expose local start-listening, stop-listening, or commit
   capture controls in the default embodied output layer.
5. Text input remains a transient Runtime-bound composer and does not imply
   voice authority.
6. When Runtime policy enables per-agent Avatar autoplay, Avatar may automatically
   play the Runtime-projected voice stream for the active agent/anchor.
7. When Runtime policy disables Avatar autoplay, Avatar must not request or
   synthesize speech for ordinary assistant messages.

## 4.1 Runtime-Owned Voice Output Policy

Avatar observes, but does not own, the agent voice output policy admitted by
`K-VOICE-018`.

Fixed rules:

- `avatar_autoplay` is per agent, not per avatar instance.
- Avatar-local shell settings may mute local playback or hide captions, but they
  do not change Runtime policy or voice artifact generation truth.
- Avatar may compute lipsync locally from playable audio via browser audio
  processing. Runtime does not own mouth parameters.
- Generated voice audio persistence and cleanup are Runtime-owned. Avatar does
  not maintain a durable voice cache.

---

## 5. Future Wake Admission Requirements

A future wake phrase slice must be owned by Runtime before Avatar may expose it.
Minimum Runtime-owned requirements:

- wake lifecycle projection with admitted state ids
- policy/consent and profile/session binding
- wake phrase detector ownership and privacy posture
- visible state projection for armed/listening/matched/blocked/degraded
- explicit stop/disable semantics
- audit/evidence events outside Avatar-local UI truth

Avatar may then render Runtime projection, but must still not own wake parsing,
background microphone capture, consent policy, or lifecycle admission.

---

## 6. Event Binding

Avatar-local evidence for this lifecycle is limited to UI/render facts:

- `avatar.audio.lifecycle.state_changed`
- `avatar.audio.privacy.indicator_changed`
- `avatar.shell.foreground_priority.requested`
- existing `avatar.audio.playback.*`
- existing `avatar.lipsync.*`

Runtime-owned wake lifecycle events are not admitted in Avatar authority and
must not be invented under the `avatar.*` namespace.

---

## 7. Drift Rules

- A wake toggle in Avatar settings is drift until Runtime wake lifecycle
  authority is admitted.
- Any Avatar-local transition into listening without Runtime projection is drift.
- Any Avatar-local start/stop/commit listening control in the default embodied
  output layer is drift.
- Any hidden mic, background continuation, or lock-screen continuation is drift.
- Any local fake transcript/reply/speaking state is drift.
- Any audio/lipsync success claim without Runtime artifact or backend evidence
  is drift.

---
