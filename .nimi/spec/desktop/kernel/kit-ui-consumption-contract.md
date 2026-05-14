# Desktop Kit UI Consumption Contract

This contract owns Desktop-specific consumption of `@nimiplatform/nimi-kit/ui`.
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

- Desktop renderer must import `@nimiplatform/nimi-kit/ui/styles.css`,
  `light.css`, `dark.css`, and exactly one accent pack.
- Desktop uses `nimi-accent`.
- Desktop root rendering must use `NimiThemeProvider` from
  `@nimiplatform/nimi-kit/ui`.

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
  `@nimiplatform/nimi-kit/shell/renderer`; Desktop facades must not fork
  shared bridge primitive semantics.

## D-SHELL-095 — Local Avatar Binding Consumer Boundary

- Desktop may pass already-resolved local avatar presentation overrides into
  `kit/features/avatar`.
- Desktop owns local avatar import, storage, registry, and per-agent binding
  semantics. `kit/features/avatar` must not become the canonical home for those
  Desktop product truths.
- Local VRM or Live2D file refs must arrive at kit surfaces as resolved
  Desktop-owned inputs, not as arbitrary file-system product truth.

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

## Fact Sources

- `tables/nimi-kit-adoption.yaml`
- `tables/nimi-kit-compositions.yaml`
- `tables/nimi-kit-allowlists.yaml`
