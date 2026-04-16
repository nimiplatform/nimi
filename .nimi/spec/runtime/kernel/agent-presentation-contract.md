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

## K-AGCORE-026a Desktop-Local Avatar Resource Non-Ownership

Runtime does not own desktop-imported VRM or Live2D resource files, desktop-local avatar
resource registries, or desktop per-agent local avatar bindings by default.

Fixed rules:

- desktop-local imported avatar assets under `{nimi_data_dir}` remain desktop storage
  truth unless and until a separate admitted runtime asset ownership surface exists
- desktop may derive a local render override from desktop-local binding while still
  consuming runtime `AgentPresentationProfile` as the persistent cross-app baseline
- runtime metadata, auxiliary profile fields, or generic agent settings must not be used
  as a backdoor to smuggle desktop-local avatar registry or binding truth into
  `AgentPresentationProfile`

## K-AGCORE-026b Desktop-Local Live2D Viewport Non-Ownership

Runtime does not own the desktop-local Live2D viewport lifecycle, desktop-local Live2D
runtime packaging, or the active surface's load-fail fallback decision.

Fixed rules:

- runtime-owned `AgentPresentationProfile` may still provide the persistent cross-app
  baseline presentation, but desktop-local Live2D render support must not rewrite that
  profile as a side effect of local viewport success or failure
- renderer-local Live2D load status, runtime-availability diagnostics, motion/runtime
  handles, and current fallback branch must remain surface-local or desktop-local
  implementation detail; they must not be promoted into runtime canonical presentation
  truth
- desktop may continue canonical render precedence after a local Live2D failure, but that
  continuation must consume existing runtime presentation truth rather than asking runtime
  to own the failed desktop-local viewport lifecycle
- runtime must not be treated as the owner of desktop-imported Cubism runtime files,
  desktop-local model staging assets, or first-wave right-rail parity policy

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-core-contract.md` — runtime-owned live agent lifecycle and app-facing control-plane boundary
- `.nimi/spec/runtime/kernel/voice-contract.md` — runtime-owned `VoiceReference` and voice asset truth
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/design.md` — topic-local authority blueprint and landing rationale
- `.nimi/local/report/ongoing/2026-04-15-agent-live-avatar-airi-audit/preflight.md` — admitted high-risk scope and non-owner framing
- `.nimi/local/report/ongoing/2026-04-17-desktop-agent-local-avatar-resource-binding/design.md` — desktop-local avatar binding non-owner rationale
- `.nimi/local/report/proposal/2026-04-17-desktop-agent-live2d-render-integration/design.md` — desktop-local Live2D viewport non-owner rationale
