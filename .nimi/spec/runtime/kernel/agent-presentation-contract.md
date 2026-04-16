# Agent Presentation Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-022 Agent Presentation Authority Home

`RuntimeAgentCoreService` owns persistent agent presentation truth through `AgentPresentationProfile`.

It owns:

- default avatar renderer/backend selection
- stable avatar asset / model reference
- stable expression / idle preset references
- stable presentation-policy defaults for reusable consumers
- default voice binding through runtime-owned `VoiceReference`

It does not own:

- current emotion
- current gesture or action cue
- current speaking / listening phase
- per-frame viseme or amplitude state
- renderer-local camera, lighting, or post-process state

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

Apps and SDK consumers may read `AgentPresentationProfile` only as runtime-owned projection through `runtime.agentCore.*`.

Fixed rules:

- apps may cache or adapt the profile into surface-local renderer inputs, but that adapted shape is not canonical runtime truth
- app-local avatar interaction state, voice-session state, and thread-local animation cues must not be written back as `AgentPresentationProfile`
- runtime mutation of presentation truth must remain on admitted agent-core command paths; consumers must not replace full profile blobs through arbitrary metadata write paths

## K-AGCORE-026 Deferred Scope And Non-Owners

The following remain outside runtime-owned persistent presentation truth unless later admitted explicitly:

- per-frame lip-sync / viseme streams
- thread-local emotion state
- session-local listening / speaking state
- pointer / gaze targets
- physics simulation or gesture queues
- renderer camera choreography and post-processing

If a consumer needs these semantics, it must own them on the surface side or wait for later authority admission; runtime must not absorb them into `AgentPresentationProfile` as a generic state bag.

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-core-contract.md` — runtime-owned live agent lifecycle and app-facing control-plane boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime-owned `VoiceReference` and voice asset truth
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/design.md` — topic-local authority blueprint and landing rationale
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/preflight.md` — admitted high-risk scope and non-owner framing
