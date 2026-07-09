# Desktop Kit UI Consumption Contract

This contract owns Desktop-specific consumption of `@nimiplatform/kit/ui`.
The platform design spec owns shared primitives, tokens, theme schema, material
taxonomy, and generic validation rules. Desktop owns its concrete renderer
inventory, retained app-owned compositions, and controlled exceptions.

## D-SHELL-090 — Local Kit Consumption Authority

- Desktop kit consumption inventory lives in `tables/nimi-kit-adoption.yaml`.
- Desktop retained UI compositions live in `tables/nimi-kit-compositions.yaml`.
- Desktop design allowlists for kit governance live in `tables/nimi-kit-allowlists.yaml`.
- Platform design tables must not contain Desktop module inventories or
  Desktop-owned component rows.

## D-SHELL-091 — Theme Entry

- Desktop renderer must import `@nimiplatform/kit/ui/styles.css`,
  `light.css`, `dark.css`, and exactly one accent pack.
- Desktop uses `nimi-accent`.
- Desktop root rendering must use `NimiThemeProvider` from
  `@nimiplatform/kit/ui`.

## D-SHELL-092 — Controlled Exceptions

- Desktop controlled design exceptions are allowed only when registered in
  `tables/nimi-kit-adoption.yaml` with `exception_policy: controlled_exception`.
- Controlled exceptions still consume kit semantic tokens and must not define an
  independent shared primitive or token system.

## D-SHELL-093 — Chat Obstacle-Flow Consumer Boundary

- Desktop may consume `kit/features/chat` while injecting Desktop-owned
  occupancy geometry and obstacle-flow taxonomy into the canonical adapter path.
- This does not transfer canonical transcript shell, scroll-root, grouping, or
  virtualization truth from `kit/features/chat` to Desktop.
- Widening Desktop obstacle-flow semantics into shared kit ownership requires a
  separate platform authority cut.

## D-SHELL-094 — Renderer Shell Facade Boundary

- Desktop may retain local facade directories for Desktop-specific bridge
  modules.
- Shared renderer shell primitives must come from
  `@nimiplatform/kit/shell/renderer`; Desktop facades must not fork
  shared bridge primitive semantics.

## D-SHELL-095 — Local Avatar Binding Consumer Boundary

- Desktop may pass already-resolved Avatar/Runtime avatar presentation
  projections into `kit/features/avatar`.
- Desktop does not own Agent Center avatar/background picker, copy, validation,
  or custody transport. It injects the standard Kit Shell `agent-center`
  capability; Kit Shell owns the managed host-local bytes and asset-scoped
  custody metadata, while Runtime owns the selected opaque refs.
- Local VRM or Live2D refs must arrive at kit surfaces as Avatar/Runtime
  projections or typed host-transport callbacks, not as arbitrary file-system
  product truth.

## D-SHELL-096 — Retired Live2D / VRM Viewport Consumer Boundary

- Desktop MUST NOT ship a concrete Live2D, VRM, Cubism, or Three.js avatar
  viewport locally.
- Desktop may consume `kit/features/avatar` and `kit/features/agent-center`
  only for normalized presentation, evidence, and launch-control surfaces.
- Concrete avatar renderer execution belongs to the Runtime-admitted Avatar app
  and its Avatar/Runtime resource resolver path, not the Desktop shell.
- Absence of a shared Kit renderer export must fail closed; it must not create a
  Desktop-local fallback renderer or lifecycle path.

## D-SHELL-097 — Pointer Attention Consumer Boundary

- Desktop owns raw attention intake, DOM pointer capture, app viewport
  measurement, attention smoothing, clamp policy, and surface stop-line policy.
- `kit/features/avatar` may consume already-resolved Desktop attention targets,
  continuous presence, and bounded app-attention-follow inputs.
- Kit avatar renderer seams must not become the semantic owner of
  speaking-vs-attention precedence or Desktop attention lifecycle truth.

## D-SHELL-098 Agent Center Kit Consumer Boundary

Desktop Agent Center consumes `kit.features.agent-center` as the reusable
Runtime Local Agent product surface.

Desktop owns only:

- Agent Center placement in Desktop shell chrome
- close/open settings callbacks and other Desktop navigation outside Kit core
- scoped Runtime SDK adapter attachment
- Kit Shell host bridge injection for the standard `agent-center` capability
- typed Avatar launch bridge when admitted by Avatar/Desktop contracts
- evidence hooks for real app acceptance

Desktop must not:

- keep a reusable Desktop-owned Agent Center implementation after the Kit
  hardcut
- inject `ChatSettingsPanel`, arbitrary `modelContent`, `diagnosticsContent`,
  `avatarContent`, `localAppearanceContent`, or equivalent app panels into Kit
  Agent Center
- derive Agent Chat submit readiness from Desktop AIConfig,
  `ConversationCapabilityProjection.resolvedBinding`, route cache, or
  `AISnapshot`
- derive route/model/provider diagnostics from app-local AIConfig or
  conversation capability bindings
- persist Runtime Agent lifecycle, memory, transcript, model route, provider,
  turn execution truth, or Agent Center presentation selection truth

Retired local config module ownership for Desktop Agent Center:

| Module | Owner Decision |
| --- | --- |
| `appearance` / `avatar_asset` | Retired as Desktop local config. Selection truth is Runtime `AgentPresentationProfile`; asset bytes and validation are Kit Shell `agent-center` custody. |
| `local_history` | Dropped without replacement. |
| `voice.avatar_autoplay` | Retired as host-local preference. Runtime `AgentPresentationProfile.avatar_autoplay` is the single persistent home. |
| `ui.last_section` | Dropped without replacement. |

Desktop must not expose `AgentCenterLocalConfig`, `desktop_agent_center_*`,
or app-local Agent Center config get/set/import/resource-management bridges
after the hardcut.

`audio.synthesize` and `voice_workflow.*` are editable only through Kit Agent
Center typed Runtime Agent AI Config controls. Desktop must not render an
app-local audio binding surface, generate voice, or present a playable pseudo
voice artifact as Agent Center truth.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`
