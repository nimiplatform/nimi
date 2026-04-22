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

Fixed rules:

- profile fields must be stable enough to survive app restart and cross-surface reuse
- runtime may store provider or asset-specific implementation detail only as auxiliary metadata, not as a second canonical profile shape
- display labels, temporary URLs, or renderer-local cache handles must not become the canonical profile key
- missing required stable profile fields must fail closed rather than fabricate a fallback avatar

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
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/design.md` — topic-local authority blueprint and landing rationale
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/preflight.md` — admitted high-risk scope and non-owner framing
- `.nimi/local/report/ongoing/2026-04-17-desktop-agent-local-avatar-resource-binding/design.md` — desktop-local avatar binding non-owner rationale
- `.nimi/local/report/proposal/2026-04-17-desktop-agent-live2d-render-integration/design.md` — desktop-local Live2D viewport non-owner rationale
