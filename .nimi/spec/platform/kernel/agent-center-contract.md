# Agent Center Contract

> Authority: Platform / Kit Kernel

Kit admits `kit.features.agent-center` as the reusable first-party Runtime Local Agent product surface.

## P-AGENT-CENTER-001 Kit Authority Home

Kit owns:

- complete reusable Agent Center layout, sections, state assembly, controls, and UI contracts
- typed adapter contracts for Runtime Agent AI Config, readiness, inspect, autonomy, memory projection, and shell-backed appearance transport
- complete Agent Center appearance feature behavior that composes Runtime-owned presentation selection truth with Kit Shell-owned host-local asset custody
- failure-state, disabled-state, loading-state, and narrow-layout behavior
- typed rendering/state mapping for Runtime-admitted
  `LocalAgentSourceContextStatus` only; source readiness remains a bounded
  read-only projection

Kit does not own:

- Runtime Agent execution, lifecycle, memory admission, event truth, transcript truth, or Runtime Agent AI Config persistence
- SDK transport or scoped binding custody
- asset bytes as semantic presentation truth; Kit Shell owns host-local byte custody only, while Runtime `AgentPresentationProfile` owns selected avatar/background/voice/autoplay refs
- Avatar carrier lifecycle or backend readiness truth
- Avatar-owned Agent Center preview service render truth, carrier readiness, backend compatibility tier, calibration effects, or launch payload truth
- app-specific developer tools, capability studios, partner selection, side-sheet chrome, or arbitrary app panels

Apps may:

- place Agent Center in their shell and wrap it with app chrome
- inject scoped Runtime/SDK adapters, Kit Shell host bridges, app copy namespaces, and placement callbacks
- provide typed placement callbacks such as close, open app settings, select partner, or launch Avatar when those callbacks are admitted
- provide app-specific navigation, copy namespace, and evidence hooks

Apps may not:

- fork Agent Center model route truth
- write Runtime Agent AI Config outside Runtime/SDK ai-config mutation
- reconstruct memory truth from raw banks
- persist Agent Chat transcript/session/lifecycle truth
- keep unadmitted Agent Center local config modules
- persist avatar/background/default-voice/autoplay selection outside Runtime `AgentPresentationProfile`
- reintroduce app-local Live2D/VRM/background import stores, local Agent Center config stores, or private bridge command vocabularies once Kit Shell standard Agent Center operations are admitted
- derive route/model/provider diagnostics from app-local AIConfig or conversation capability bindings
- pass arbitrary `ReactNode` feature panels into Kit Agent Center as `modelContent`, `diagnosticsContent`, `renderGatedSurface`, capability studio, or technical surfaces
- include app-specific developer/product features inside Agent Center sections

Kit never receives raw source/world/core/closure data, prompt or lane text,
transcript/private memory, packet/proof/chunks, provider payloads, credentials,
tool arguments/results, or a LocalAgent context assembler.

- AUTHORITY-RELATION subject=kit-agent-center action=consume-status object=localagent-source value=bounded-only polarity=require

## P-AGENT-CENTER-002 Product Sections

Kit Agent Center provides the complete generic Agent Center surface:

- Overview: Runtime status, model readiness, autonomy state, cognition state, appearance state, and next required action.
- Model: committed Runtime Agent AI Config, AI consume intent editor, readiness projection, revision conflict recovery, and per-capability reason detail.
- Behavior: autonomy enablement, proactive mode, token budget posture, hook queue preview, and interruptibility projection.
- Cognition: Runtime Agent state, current emotion, status text, activity, memory mode/status, recent canonical memories, knowledge availability, and failed/unavailable states.
- Appearance: Runtime-owned avatar/background/default-voice/autoplay selection, Kit Shell host-local Live2D/VRM/background asset custody, validation, Avatar-owned preview-service status, and bounded failure/re-import states for unresolvable refs.
- Advanced: Runtime-derived diagnostics, event stream health, runtime source identity, app binding scopes, accepted turn/config revision, and audit references.

Zhiyu may place the same Kit sections only as a partner-settings or secondary surface. Advanced diagnostics and event stream detail are secondary or developer-facing surfaces, not first-viewport product narrative.

Overview and Advanced may render the closed read-only
`AgentTurnContextSummary` state/reason, versions/hashes, ordered lane
ids/status/counts, budget/truncation, transcript/memory/media/tool counts, and
route/catalog digest. They must not render or reconstruct raw context.

- AUTHORITY-RELATION subject=kit-agent-center action=consume-status object=localagent-context value=bounded-only polarity=require

## P-AGENT-CENTER-003 Local Config Retired World

Agent Center has no app-local or Kit-local persisted local config record.
`AgentCenterLocalConfig`, `agent-center.configGet`, and
`agent-center.configSet` are retired without replacement.

Fixed rules:

- avatar ref, background ref, default voice, and avatar autoplay selection truth lives only on Runtime `AgentPresentationProfile`
- import completion must commit the minted avatar/background ref through `SetAgentPresentationProfile`; local selected-but-not-committed success is not admitted
- Kit Shell may own only host-local asset bytes, validation evidence, local asset URLs, and asset-scoped custody metadata such as Live2D adapter manifest association
- `local_history` and `ui.last_section` are dropped without replacement
- retired policy fields such as `avatar_instance_policy`, `generated_motion_provider_policy`, `launch_mode`, and `debug_profile` are not migrated to Kit Shell or Runtime presentation profile
- Web hosts may edit Runtime-owned selections when the Runtime write surface is available, but cannot import assets without a standard shell host

## P-AGENT-CENTER-004 Runtime Agent Optional Audio

`audio.synthesize` and `voice_workflow.*` intent are Runtime Agent AI Config-owned. Agent Center may render and edit them only through the admitted Runtime/SDK ai-config adapter. Runtime voice owns generation, stream, artifacts, and workflow execution results. Apps must not create playable pseudo voice artifacts, app-local voice synthesis truth, or independent voice workflow choices.

## P-AGENT-CENTER-005 SDK And Runtime Boundary

Kit Agent Center consumes Runtime/SDK truth only through `kit/core/src/sdk-contract.ts` or explicitly injected typed adapters. Kit Agent Center production code must not import `runtime/internal/**`, `apps/**`, SDK-private paths, or app aliases.

Its LocalAgent adapter inputs are limited to
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary`. Unknown/partial
schema, enum, state, lane, or reason is an unavailable/failed UI state. Kit
must not accept raw context or expose an adapter that assembles, overrides, or
attaches LocalAgent context.

- AUTHORITY-RELATION subject=kit-agent-center action=assemble object=localagent-context value=denied polarity=forbid

## P-AGENT-CENTER-006 Surface Ownership Matrix

| Current Surface | Required Owner | Required Handling |
| --- | --- | --- |
| Desktop `AgentCenterPanel` sections, setup checklist, nav, status rows | Kit | Move into Kit Agent Center. Desktop becomes placement wrapper only. |
| Desktop `ChatSettingsPanel` injected as `modelContent` | Runtime/SDK Runtime Agent AI Config editor in Kit; generic AI settings outside Agent Center | Replace with Kit Runtime Agent AI Config section; keep generic AI config as separate Desktop settings surface if still needed. |
| Desktop `diagnosticsContent` injected into Advanced | Runtime/SDK advanced diagnostics in Kit, app developer diagnostics outside Agent Center | Replace with Runtime-derived diagnostics; move app diagnostics outside Kit Agent Center placement. |
| Desktop `avatarContent` / `localAppearanceContent` | Kit appearance section plus Runtime presentation profile writes, Kit Shell asset custody, and Avatar preview service boundary | Replace arbitrary content with typed adapter-driven Kit controls. |
| Desktop voice autoplay / voice artifact cleanup | Host-local playback/artifact preference only | Keep only as typed host-local playback/artifact adapter; no audio generation truth. |
| Zhiyu `RightAgentPanel` tabs/sections | Kit | Replace with Kit Agent Center; Zhiyu keeps partner-first placement wrapper. |
| Zhiyu `ZhiyuAiConfigSettings` inside model tab | Runtime/SDK Runtime Agent AI Config editor in Kit | Replace with Kit Runtime Agent AI Config section. |
| Zhiyu `AgentCenterCapabilityProbePanel` / Capability Studio | Zhiyu developer tooling | Move outside Agent Center or into a separate app developer panel. |
| Zhiyu `renderGatedSurface`, `technicalSurfaces`, `DiagnosticSurface` inside Agent Center | Zhiyu app/developer surfaces or Runtime-derived Kit diagnostics | Runtime-derived diagnostics stay in Kit; app-specific surfaces move outside Agent Center. |
| Zhiyu partner header, close button, partner selection | Zhiyu placement | Keep around Kit Agent Center, not inside Kit core. |
| Zhiyu/desktop local avatar/background file bridge | Kit Shell standard `agent-center` capability plus Runtime `AgentPresentationProfile` selection writes | Delete private app bridges and consume the shared Kit shell-backed appearance adapter. |

Every current Agent Center child/panel must map to Kit core, Runtime projection/setting, host-transport adapter, Avatar/Runtime resource boundary, or app-only outside-Agent-Center placement. Unmapped surfaces block implementation.

Apps own LocalAgent intent capture, placement, copy, navigation, and bounded
presentation state only. Runtime owns source snapshot/context execution truth;
Kit owns reusable rendering only. Neither Kit nor apps may promote bounded
summary fields into a source, prompt, context, memory, proof, or execution
authority.

- AUTHORITY-RELATION subject=apps action=own object=localagent-intent-and-presentation value=app-owned polarity=require
- AUTHORITY-RELATION subject=kit-agent-center action=assemble object=localagent-context value=denied polarity=forbid
