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
- Desktop owns local avatar file picker/copy transport only. Avatar/Runtime
  resource service owns import custody, materialization, registry, and per-agent
  resource truth. `kit/features/avatar` must not become the canonical home for
  those resource truths.
- Local VRM or Live2D refs must arrive at kit surfaces as Avatar/Runtime
  projections or typed host-transport callbacks, not as arbitrary file-system
  product truth.

## D-SHELL-096 — Live2D Viewport Consumer Boundary

- Desktop may ship a concrete Live2D viewport locally while consuming
  `kit/features/avatar` stage semantics and normalized presentation inputs.
- This local viewport does not make kit the owner of Desktop fallback policy,
  local runtime packaging, or Desktop-only viewport lifecycle.
- A shared `/live2d` kit export must be separately registered and shipped before
  Desktop or any other app treats it as package surface.

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
- typed host-local Avatar/background file picker/copy transport adapter
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
  or turn execution truth

Local config module ownership for Desktop Agent Center:

| Module | Owner Decision |
| --- | --- |
| `appearance` / `avatar_asset` | Bounded Desktop host-local picker/copy transport only; Avatar/Runtime resource service owns custody/materialization truth and projects validated refs through admitted boundary. |
| `local_history` | Non-semantic UI recents only; no transcript, message, turn, session, or memory content. |
| `voice.avatar_autoplay` | Host-local playback UI preference only; not `audio.synthesize` readiness, binding, generation, or policy truth. |
| `ui.last_section` | Host-local UI preference only; no Runtime or product authority. |

`audio.synthesize` and `voice_workflow.*` are editable only through Kit Agent
Center typed Runtime Agent AI Config controls. Desktop must not render an
app-local audio binding surface, generate voice, or present a playable pseudo
voice artifact as Agent Center truth.

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`
