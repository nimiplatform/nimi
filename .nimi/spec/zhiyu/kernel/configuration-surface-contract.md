# Zhiyu Configuration Surface Contract

## Z-CONFIG-001 AI Model Config Operation

Zhiyu must provide a user-facing surface to view and operate the AI model
configuration used by Runtime execution for the current partner. Zhiyu does not
own `runtime_ai_config`, provider routing, execution, credential custody,
prompt assembly, or spend truth.

## Z-CONFIG-002 AI Config Persistence

AI config changes initiated from Zhiyu must be submitted through admitted
Runtime/SDK/Kit or Platform public facades. Zhiyu must not persist a local
Runtime AI config store or hardcode provider/model constants.

## Z-CONFIG-003 Avatar Config Operation

Zhiyu must provide Avatar config operations required by the local partner
center: import Live2D/VRM resources through admitted facades, select
Live2D/VRM, and launch Avatar. Zhiyu does not own Avatar resource truth, config
truth, carrier lifecycle, or runtime truth.

## Z-CONFIG-004 Config Boundary

Configuration surfaces must fail closed on missing upstream facade, permission,
binding, validation, or owner admission. A local UI control is not proof that
the config change is admitted or persisted.

## Z-CONFIG-005 Agent Center Local Config Hardcut

During the Desktop Agent Chat parity hardcut, Zhiyu may host a bounded Electron
local config/import bridge at `apps/zhiyu/src-electron/agent-center-local-config.ts`
and `apps/zhiyu/src-electron/live2d-source.ts` until real app acceptance
stabilizes and SDK/Kit/Avatar owners decide the upstream surface. This bridge is
limited to user-selected Agent Center appearance/avatar package copies, scoped
to account id, owner user id, runtime source ref, and Runtime-owned local agent
ref. It must remain noncanonical local parity state, fail closed on invalid
scope/path/manifest, and must not claim Avatar resource truth, Avatar carrier
lifecycle truth, Runtime AI config truth, provider/model route truth,
transcript/session recovery truth, memory truth, or Runtime snapshot truth.

## Z-CONFIG-006 Kit Agent Center Consumer Boundary

Zhiyu consumes `kit.features.agent-center` as a partner-settings or secondary
surface. Zhiyu remains partner-first: partner selection, partner header, close
button, side-sheet chrome, and developer tools stay outside Kit Agent Center.

Zhiyu may provide:

- a scoped Runtime SDK adapter
- a bounded local appearance/avatar import bridge
- typed host-local UI preferences admitted by Platform Agent Center authority
- evidence hooks for real app acceptance

Zhiyu must not place the following inside Kit Agent Center:

- `ZhiyuAiConfigSettings`
- `AgentCenterCapabilityProbePanel`
- Capability Studio
- `technicalSurfaces`
- `renderGatedSurface`
- app-specific `DiagnosticSurface`
- partner shell chrome or partner selection controls

The Kit Agent Center model tab is the Runtime Agent execution config editor.
Model changes must call Runtime/SDK execution config upsert with
`expected_revision`; stale conflicts must be visible and must not overwrite a
newer Runtime config.

Local config module ownership for Zhiyu Agent Center:

| Module | Owner Decision |
| --- | --- |
| `appearance` / `avatar_asset` | Bounded Zhiyu host-local asset custody only; no Avatar resource truth or Runtime presentation truth. |
| `local_history` | Non-semantic UI recents only; no transcript, message, turn, session, or memory content. |
| `voice.avatar_autoplay` | Host-local playback UI preference only; not `audio.synthesize` readiness, binding, generation, or policy truth. |
| `ui.last_section` | Host-local UI preference only; no Runtime or product authority. |

`audio.synthesize` is read-only Runtime readiness projection in this wave.
Zhiyu must not render an editable audio binding surface or a playable pseudo
voice artifact as Agent Center truth.
