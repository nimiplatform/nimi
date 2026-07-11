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
