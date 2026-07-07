# Agent Center Contract

> Authority: Platform / Kit Kernel

Kit admits `kit.features.agent-center` as the reusable first-party Runtime Local Agent product surface.

## P-AGENT-CENTER-001 Kit Authority Home

Kit owns:

- complete reusable Agent Center layout, sections, state assembly, controls, and UI contracts
- typed adapter contracts for Runtime Agent AI Config, readiness, inspect, autonomy, memory projection, and appearance host picker/copy transport
- failure-state, disabled-state, loading-state, and narrow-layout behavior

Kit does not own:

- Runtime Agent execution, lifecycle, memory admission, event truth, transcript truth, or Runtime Agent AI Config persistence
- SDK transport or scoped binding custody
- Desktop/Zhiyu host picker/copy transport for imported Live2D/VRM/background assets
- Avatar carrier lifecycle or backend readiness truth
- app-specific developer tools, capability studios, partner selection, side-sheet chrome, or arbitrary app panels

Apps may:

- place Agent Center in their shell and wrap it with app chrome
- inject typed host-local appearance/avatar transport adapters
- provide typed placement callbacks such as close, open app settings, select partner, or launch Avatar when those callbacks are admitted
- provide app-specific navigation, copy namespace, and evidence hooks

Apps may not:

- fork Agent Center model route truth
- write Runtime Agent AI Config outside Runtime/SDK ai-config mutation
- reconstruct memory truth from raw banks
- persist Agent Chat transcript/session/lifecycle truth
- keep unadmitted Agent Center local config modules
- derive route/model/provider diagnostics from app-local AIConfig or conversation capability bindings
- pass arbitrary `ReactNode` feature panels into Kit Agent Center as `modelContent`, `diagnosticsContent`, `renderGatedSurface`, capability studio, or technical surfaces
- include app-specific developer/product features inside Agent Center sections

## P-AGENT-CENTER-002 Product Sections

Kit Agent Center provides the complete generic Agent Center surface:

- Overview: Runtime status, model readiness, autonomy state, cognition state, appearance state, and next required action.
- Model: committed Runtime Agent AI Config, AI consume intent editor, readiness projection, revision conflict recovery, and per-capability reason detail.
- Behavior: autonomy enablement, proactive mode, token budget posture, hook queue preview, and interruptibility projection.
- Cognition: Runtime Agent state, current emotion, status text, activity, memory mode/status, recent canonical memories, knowledge availability, and failed/unavailable states.
- Appearance: Live2D/VRM/avatar local asset selection, validation, calibration reference, background, reference image/voice projection, and bounded host picker/copy transport into Avatar/Runtime resource service.
- Advanced: Runtime-derived diagnostics, event stream health, runtime source identity, app binding scopes, accepted turn/config revision, and audit references.

Zhiyu may place the same Kit sections only as a partner-settings or secondary surface. Advanced diagnostics and event stream detail are secondary or developer-facing surfaces, not first-viewport product narrative.

## P-AGENT-CENTER-003 Local Config Closed World

Local config modules are closed-world:

- `appearance` and `avatar_asset` are admitted only as bounded host picker/copy transport and UI preference; Avatar/Runtime resource service owns custody/materialization truth.
- `local_history` is admitted only as non-semantic UI recents with no message/session/transcript content.
- `voice.avatar_autoplay` is admitted only as a host-local playback UI preference. It is not audio generation policy.
- `ui.last_section` is admitted only as a host-local UI preference with no Runtime semantics.

Unlisted modules and Runtime truth fields are rejected by schema validation.

## P-AGENT-CENTER-004 Runtime Agent Optional Audio

`audio.synthesize` and `voice_workflow.*` intent are Runtime Agent AI Config-owned. Agent Center may render and edit them only through the admitted Runtime/SDK ai-config adapter. Runtime voice owns generation, stream, artifacts, and workflow execution results. Apps must not create playable pseudo voice artifacts, app-local voice synthesis truth, or independent voice workflow choices.

## P-AGENT-CENTER-005 SDK And Runtime Boundary

Kit Agent Center consumes Runtime/SDK truth only through `kit/core/src/sdk-contract.ts` or explicitly injected typed adapters. Kit Agent Center production code must not import `runtime/internal/**`, `apps/**`, SDK-private paths, or app aliases.

## P-AGENT-CENTER-006 Surface Ownership Matrix

| Current Surface | Required Owner | Required Handling |
| --- | --- | --- |
| Desktop `AgentCenterPanel` sections, setup checklist, nav, status rows | Kit | Move into Kit Agent Center. Desktop becomes placement wrapper only. |
| Desktop `ChatSettingsPanel` injected as `modelContent` | Runtime/SDK Runtime Agent AI Config editor in Kit; generic AI settings outside Agent Center | Replace with Kit Runtime Agent AI Config section; keep generic AI config as separate Desktop settings surface if still needed. |
| Desktop `diagnosticsContent` injected into Advanced | Runtime/SDK advanced diagnostics in Kit, app developer diagnostics outside Agent Center | Replace with Runtime-derived diagnostics; move app diagnostics outside Kit Agent Center placement. |
| Desktop `avatarContent` / `localAppearanceContent` | Kit appearance section plus typed host-transport adapter and Avatar/Runtime resource boundary | Replace arbitrary content with typed adapter-driven Kit controls. |
| Desktop voice autoplay / voice artifact cleanup | Host-local playback/artifact preference only | Keep only as typed host-local playback/artifact adapter; no audio generation truth. |
| Zhiyu `RightAgentPanel` tabs/sections | Kit | Replace with Kit Agent Center; Zhiyu keeps partner-first placement wrapper. |
| Zhiyu `ZhiyuAiConfigSettings` inside model tab | Runtime/SDK Runtime Agent AI Config editor in Kit | Replace with Kit Runtime Agent AI Config section. |
| Zhiyu `AgentCenterCapabilityProbePanel` / Capability Studio | Zhiyu developer tooling | Move outside Agent Center or into a separate app developer panel. |
| Zhiyu `renderGatedSurface`, `technicalSurfaces`, `DiagnosticSurface` inside Agent Center | Zhiyu app/developer surfaces or Runtime-derived Kit diagnostics | Runtime-derived diagnostics stay in Kit; app-specific surfaces move outside Agent Center. |
| Zhiyu partner header, close button, partner selection | Zhiyu placement | Keep around Kit Agent Center, not inside Kit core. |
| Zhiyu/desktop local avatar/background file bridge | Host-transport adapter plus Avatar/Runtime resource contract | Keep as typed adapter consumed by Kit appearance section. |

Every current Agent Center child/panel must map to Kit core, Runtime projection/setting, host-transport adapter, Avatar/Runtime resource boundary, or app-only outside-Agent-Center placement. Unmapped surfaces block implementation.
