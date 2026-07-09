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

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — runtime-owned live agent lifecycle and app-facing control-plane boundary
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` — runtime-owned transient presentation / turn seam and current emotion projection
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime-owned `VoiceReference` and voice asset truth
- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md` — desktop-local carrier decommission and avatar-app handoff boundary
- `.nimi/spec/avatar/kernel/index.md` — Avatar first-party carrier authority map
- `.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md` — runtime projection reader guide and core presentation correspondence
- `.nimi/spec/avatar/kernel/live2d-render-contract.md` — Live2D companion reader guide and presentation correspondence
