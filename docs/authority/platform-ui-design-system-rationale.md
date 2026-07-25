# Platform UI Design System - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/platform/ui-design-system.authority.yaml`。

---

<!-- source: .nimi/spec/platform/design-pattern.md -->

# Design Pattern

> Domain: platform

## 0. Normative Imports

- `.nimi/spec/platform/kernel/*`
- `.nimi/spec/platform/kernel/tables/*`

## Scope

This guide points to the Platform authority surfaces for design-pattern. It does not define product rules.

## Reading Path

- `.nimi/spec/platform/kernel/index.md`
- `.nimi/spec/platform/kernel/ai-last-mile-contract.md`
- `.nimi/spec/platform/kernel/ai-scope-contract.md`
- `.nimi/spec/platform/kernel/app-slice-admission-contract.md`
- `.nimi/spec/platform/kernel/architecture-contract.md`
- `.nimi/spec/platform/kernel/capability-catalog-contract.md`
- `.nimi/spec/platform/kernel/design-pattern-contract.md`
- `.nimi/spec/platform/kernel/governance-contract.md`
- `.nimi/spec/platform/kernel/kit-contract.md`
- `.nimi/spec/platform/kernel/nimi-ui-material-contract.md`
- `.nimi/spec/platform/kernel/package-authority-admission-contract.md`
- `.nimi/spec/platform/kernel/protocol-contract.md`
- `.nimi/spec/platform/kernel/release-gate-contract.md`

## Tables

- `.nimi/spec/platform/kernel/tables/app-authorization-presets.yaml`
- `.nimi/spec/platform/kernel/tables/app-slice-admissions.yaml`
- `.nimi/spec/platform/kernel/tables/audit-events.yaml`
- `.nimi/spec/platform/kernel/tables/audit-evidence-roots.yaml`
- `.nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml`
- `.nimi/spec/platform/kernel/tables/compliance-test-matrix.yaml`
- `.nimi/spec/platform/kernel/tables/error-code-mapping.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-ui-adoption.yaml`
- `.nimi/spec/platform/kernel/tables/nimi-ui-allowlists.yaml`


---

<!-- source: .nimi/spec/platform/kernel/design-pattern-contract.md -->

# Design Pattern Contract — P-DESIGN-*

> Cross-app authority for the Nimi design pattern, shared primitives, theme packs, and hard gates.

## P-DESIGN-001 — Foundation Authority

- The Nimi design pattern is the single authoritative source for shared kit primitives, semantic tokens, theme-pack schemas, material taxonomy, and external app integration rules.
- Cross-app design authority must live in `.nimi/spec/platform/kernel/design-pattern-contract.md` and the structured fact sources under `.nimi/spec/platform/kernel/tables/`.
- App-local specs own concrete kit consumption inventories, retained app-owned compositions, and product art direction. They may not redefine shared primitive families, token taxonomies, or governance rules.

## P-DESIGN-002 — Theme Pack Model

- Shared design foundation is constant across apps; theme expression is delivered through foundation scheme packs plus exactly one app accent pack.
- Governed app entries must import `@nimiplatform/kit/ui/themes/light.css`, `@nimiplatform/kit/ui/themes/dark.css`, and exactly one app accent pack from `@nimiplatform/kit/ui/themes/*-accent.css`.
- Foundation schemes are `nimi-light` and `nimi-dark`.
- `nimi-accent` is the shared Nimi accent pack. External app accent packs may be packaged by `@nimiplatform/kit/ui` only when their values are owned by the consuming app's local spec manifest, not by platform design authority.

## P-DESIGN-003 — Semantic Token Taxonomy

- Shared semantic tokens must be declared in `tables/nimi-ui-tokens.yaml`.
- Required token categories are `surface`, `text`, `action`, `overlay`, `sidebar`, `field`, `status`, `radius`, `spacing`, `typography`, `stroke`, `elevation`, `motion`, `z`, `sizing`, `border`, `opacity`, `focus`, `scrollbar`, `toggle`, `material`, `backdrop`, and `ambient`.
- Semantic tokens must declare whether they are `foundation` or `accent` layer tokens.
- Theme pack values must be declared in `tables/nimi-ui-themes.yaml`; app code must not invent parallel token registries for governed surfaces.

## P-DESIGN-004 — Theme Scheme Contract

- All governed apps must resolve theme state through one shared scheme mechanism.
- Shared scheme state is `light` or `dark`; governed apps must not define a parallel app-local theme entrypoint or root token system.
- Accent packs may express product identity, but they must layer on top of the shared foundation schemes and must not redefine primitive family structure.

## P-DESIGN-005 — Primitive Visual Authority

- Shared primitive variant taxonomy (which tones, sizes, states are valid) must be declared in `tables/nimi-ui-primitives.yaml`.
- Shared primitive visual implementations use CVA (class-variance-authority) + Tailwind utility classes in `@nimiplatform/kit/ui` component source, backed by Radix UI headless primitives for accessible behavior.
- Semantic theme tokens are registered as Tailwind theme values via `@theme` in generated CSS; primitive CSS class selectors are no longer generated.
- App code and shared-lib handwritten code may compose shared primitives, but may not define CVA variants for shared primitive families outside `kit/ui`.

## P-DESIGN-006 — No App-Local Shared Primitive Redefinition

- Governed app stylesheets must not define CVA variants or Tailwind utility overrides that target shared primitive families delivered by `@nimiplatform/kit/ui`.
- App-local wrappers may add composition class names, but they must not redefine the visual contract of shared primitive components.
- Controlled exceptions may style app-owned selectors only; they must not override shared primitive styling.

## P-DESIGN-007 — No App-Local Shared Token Overrides

- Governed app stylesheets must not assign values to `--nimi-*` CSS variables.
- Shared semantic token values must originate only from generated theme CSS emitted from `tables/nimi-ui-themes.yaml`.
- Shared-lib handwritten CSS may read semantic tokens, but must not provide fallback token authority.

## P-DESIGN-008 — Accent Alias Phase-Out

- Generated accent packs must emit shared `--nimi-*` semantic token values only; they must not emit app-scoped alias token namespaces such as `--ot-*`, `--color-ot-*`, `--color-brand-*`, or `--color-accent-*` as long-term authority.
- Retired app-specific full-theme compatibility outputs must not remain in the generated shared-lib theme surface once the foundation-plus-accent model is active.
- Governed app chrome may layer app identity through shared semantic tokens and local `color-mix(...)` expressions, but it must not depend on app-scoped accent aliases for shared background, text, focus, or surface meaning.

## P-DESIGN-009 — Visual Reference Taxonomy Admission Boundary

- UI reference artifacts may seed shared taxonomy only after they are admitted
  through an artifact manifest, classification matrix, and audit
  result. They are never token tables, theme packs, app composition authority,
  or implementation proof by themselves.
- Platform contracts must cite the admitted taxonomy and admission source, not copy
  host-local artifact paths, hashes, or visual measurements into durable
  platform truth. Artifact identity stays in the evidence that admitted
  the reference.
- Generated image labels and pixels must not be used as canonical color,
  radius, blur, shadow, spacing, sizing, or typography values. Numeric visual
  values must come from `tables/nimi-ui-tokens.yaml`,
  `tables/nimi-ui-themes.yaml`, or a later admitted platform token change.
- A reference-card composition may be promoted to shared kit authority only as
  a reusable primitive abstraction. Product information architecture, route
  placement, data models, and screen composition remain app-local.

## P-DESIGN-010 — Shared Primitive Contract

- Shared design primitives must be delivered by `@nimiplatform/kit/ui`, built on Radix UI headless primitives (Dialog, Tooltip, ScrollArea, Select, Switch, Avatar, Popover) and styled with CVA + Tailwind referencing `--nimi-*` semantic tokens.
- Governed app modules must use shared primitives for shell-level `surface`, `action`, `overlay`, `sidebar`, `field`, `status`, `scroll_area`, `toggle`, and `avatar` families.
- Thin compatibility wrappers are permitted only if they delegate directly to `@nimiplatform/kit/ui` and do not redefine the visual contract.

## P-DESIGN-011 — Surface Contract

- `Surface` is the only shared shell-level primitive for `canvas`, `panel`, `card`, `hero`, and `overlay` tones.
- Shared surface elevation and border treatment must resolve through semantic tokens, not feature-local shadow or color constants.

## P-DESIGN-012 — Action Contract

- `Button` and `IconButton` are the shared action primitives for shell-level and form-level interactions.
- Shared actions must resolve `primary`, `secondary`, `ghost`, and `danger` tone behavior through semantic tokens.
- Shape carries semantics. Standard actions (`Button`, `IconButton`) resolve corner radius through `radius.action`, which is a continuous small radius (`12px`), never a capsule. The capsule radius (`radius.full`, `999px`) is reserved for chip, filter, status badge, segmented/pill selection, search field, and toggle-shaped primitives. Tone (`primary`/`secondary`/`ghost`/`danger`) must not change an action's shape.
- Shared actions must give immediate pressed feedback on pointer-down via `motion.pressed_scale` per P-DESIGN-027; hover treatment alone is not an admitted feedback model, and hover elevation shifts (`translateY` lifts) are not admitted on standard actions.

## P-DESIGN-013 — Overlay Contract

- `OverlayShell` is the shared overlay shell primitive for governed `dialog` and `drawer` surfaces. Its admitted primitive metadata also includes a controlled `popover` kind for registered overlay-family popover surfaces; app specs must not treat that as permission to hand-roll dialog/drawer shells. `OverlayShell` owns the canonical backdrop, panel, title, content, footer, motion, z-index, close behavior, and testability slots.
- `Dialog` / `DialogContent` are lower-level Radix-backed parts for kit-internal and explicitly controlled overlay surfaces; they must still emit the canonical overlay slot classes when rendering governed content.
- `Popover` / `PopoverContent` and `Tooltip` / `TooltipContent` are lower-level Radix-backed overlay parts for popover and tooltip surfaces; their content layers must emit the canonical overlay-family classes admitted in `nimi-ui-primitives.yaml`.
- Governed overlays must keep reduced-motion behavior and stable testability surfaces.
- Admitted overlay panel size IDs for `OverlayShell`: `S` (480px), `M` (720px), `L` (960px), `XL` (1120px), `full` (`calc(100vw - 32px)`). All sized panels also apply `max-width: calc(100vw - 32px)` to stay viewport-safe. The structured size enumeration lives in `nimi-ui-primitives.yaml#primitive.overlay.class_groups.size`; the kit implementation may bind these via the generator-owned `nimi-overlay-panel--size-*` selectors and/or inline `style.width`/`style.maxWidth`. When no `size` is supplied, the panel preserves the default `max-w-md` layout for backward compatibility.
- `OverlayShell` admits an opt-in `sidebar` slot for 2-column overlay layouts. When set, the panel becomes a left aside (`nimi-overlay-sidebar`, default `200px` width, kit-owned border-right and padding) plus a main column carrying the existing title / content / footer composition. Aside chrome (width default, border, padding) is kit-owned; aside content is caller-provided. Single-column behavior remains the default when `sidebar` is not supplied.

## P-DESIGN-014 — Sidebar / Nav Contract

- Shared sidebars and shell-level navigation lists must use the shared sidebar family `nimi-sidebar-v1`.
- Allowed item kinds are `entity-row`, `category-row`, and `nav-row`.
- Allowed trailing affordances are `badge`, `status-dot`, `chevron`, and `count`.

## P-DESIGN-015 — Field / Input Contract

- `TextField`, `SearchField`, `TextareaField`, and `SelectField` are the shared field primitives for shell-level and publish/settings surfaces.
- Governed field surfaces must resolve background, stroke, placeholder, and focus states through semantic tokens.
- Admitted field tone IDs for `TextField` and `TextareaField`: `default`, `search`, `quiet`, `danger`. The `danger` tone signals an invalid input state and must resolve its chrome (border, focus ring) through `--nimi-status-danger`. The structured tone enumeration lives in `nimi-ui-primitives.yaml#primitive.field.class_groups.tone`; the kit implementation may bind these via Tailwind utility classes or the generator-owned `nimi-field--*` selectors, matching the existing implementation pattern for `default`/`search`/`quiet`.
- When `tone="danger"` is set on `TextField` or `TextareaField`, the inner control receives `aria-invalid="true"` by default for screen-reader semantics. An explicit caller-supplied `aria-invalid` always wins (kit convention: caller-provided HTML attributes are never overwritten by kit-internal defaults).

## P-DESIGN-016 — Typography Contract

- Typography scale, font weights, line heights, and letter spacing for governed surfaces must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared type utility classes such as page titles, section titles, body copy, captions, labels, overlines, and mono text must be generated from semantic typography tokens.
- Governed modules must not invent ad hoc typography scales when the toolkit taxonomy covers the needed role.

## P-DESIGN-017 — Spacing & Sizing Contract

- Shared spacing and component sizing scales must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared primitives must resolve padding, gaps, min-heights, icon sizes, sidebar row sizes, and scrollbar sizes through semantic sizing and spacing tokens.
- Governed modules must not encode layout rhythm or component size contracts with raw values when a shared token exists.

## P-DESIGN-018 — Focus / Opacity / Icon Contract

- Shared focus rings, disabled opacity, interaction overlays, and icon size scales must be declared in `tables/nimi-ui-tokens.yaml`.
- Shared primitives must resolve focus, disabled, and hover/overlay treatments through semantic tokens rather than per-app constants.
- Governed apps may add app-specific icon glyphs, but icon sizing and focus behavior must come from the shared toolkit contract.

## P-DESIGN-019 — App-Owned Composition Boundary

- App-owned composition components are permitted only when they are explicitly registered in the consuming app's local kit composition manifest.
- Thin wrappers over shared primitive families must delegate directly to `@nimiplatform/kit/ui` and must not add an app-owned visual contract for those shared families.
- App-owned compositions may define local interaction or layout selectors only for component families that are not yet part of the shared toolkit contract; they must not become a parallel authority for `action`, `field`, `surface`, `sidebar`, `overlay`, `status`, `scroll_area`, `toggle`, or `avatar`.

## P-DESIGN-020 — Adoption Registry

- Every governed shell-level module must be explicitly registered in the consuming app's local kit adoption manifest.
- Manifest rows must declare `scheme_support`, `default_scheme`, and `accent_pack`; governed apps may not encode these decisions only in renderer code.
- Hard gate enforcement is driven by platform-defined manifest schema plus app-local manifests, not by ad hoc path guesses or reviewer memory.

## P-DESIGN-021 — Controlled Exceptions

- Exceptions to shared primitive adoption must be explicit, narrow, and owned by the consuming app's local kit manifest.
- Platform design authority must not carry concrete app exception inventories.
- Controlled exceptions must still consume shared semantic tokens and may not define an independent token system.

## P-DESIGN-022 — Material Layering Contract

- Material is an axis orthogonal to the surface `tone` family declared in P-DESIGN-011. Governed surfaces that are not `solid` must declare both a tone and a material.
- Allowed materials are `solid`, `glass-thin`, `glass-regular`, `glass-thick`, and `glass-chrome`. `solid` is the default material for surfaces that do not declare a material. This 5-tier taxonomy supersedes the prior 3-material taxonomy (`solid`, `glass-regular`, `glass-thick`); the prior tier names are preserved byte-for-byte with identical semantics, and `glass-thin` / `glass-chrome` are the admitted additional tiers.
- `glass-regular` and `glass-thick` must resolve background fill, border color, and backdrop-filter blur strength through semantic `material.*` and `backdrop.*` tokens declared in `tables/nimi-ui-tokens.yaml`. Governed modules must not inline `rgba(...)` material values or inline `backdrop-filter` declarations.
- Material tokens are `foundation`-layer tokens. Every `material.*` and `backdrop.*` token must declare both light and dark values in `tables/nimi-ui-themes.yaml`.
- Material tokens must stay neutral. Accent expression is delivered through accent packs per P-DESIGN-002 and must not be welded into material values.
- Governed modules that consume a glass material must provide a `@supports not (backdrop-filter: blur(1px))` fallback that preserves legibility without requiring backdrop-filter, and must honor the `prefers-reduced-transparency` media feature by downgrading to a `solid` material.

## P-DESIGN-023 — Ambient Background Contract

- Ambient backgrounds are first-class governed surfaces, not decorative absolute-positioned elements authored per app.
- Allowed ambient variants are `mesh`, `minimal`, and `none`. `none` is the default and imposes no ambient treatment.
- `mesh` composes a radial-gradient aurora field plus soft blurred color halos. Its color slots and radii must resolve through `ambient.*` tokens declared in `tables/nimi-ui-tokens.yaml`; governed modules must not inline raw gradient stacks or hex halo colors.
- Ambient color-slot tokens are `foundation`-layer tokens with neutral defaults in the shared light and dark schemes. Accent packs may override any ambient slot to express product identity without changing the composition structure; overrides remain opt-in and must not remove the foundation default.
- Every `ambient.*` token must declare both light and dark values in `tables/nimi-ui-themes.yaml`.
- Governed modules that render ambient `mesh` must honor `prefers-reduced-motion` by disabling halo animation and must honor `prefers-reduced-transparency` by falling back to `minimal` or `none`.

## P-DESIGN-024 — UI Card v2.1 Shared Taxonomy Families

- The shared taxonomy admitted from UI Card v2.1 is limited to primitive
  families and semantic roles. It does not admit new component APIs until the
  executable primitive table, `kit/ui` implementation, tests, and generated docs
  are updated through admitted implementation and documentation gates.
- Surface and material taxonomy covers app background, regular glass cards,
  elevated glass cards, navigation/sidebar surfaces, floating overlay panels,
  and modal/dialog shells as reusable surface roles. Concrete dock placement,
  runtime placement, world lists, profile headers, and app route structure are
  excluded.
- Typography taxonomy covers page title, section title, card title, body text,
  muted/helper text, label/meta, caption/tag, and CJK role adjustments. Values
  remain owned by typography tokens; the reference card does not supply sizes,
  weights, line heights, or letter spacing.
- Control taxonomy covers button, icon button, segmented control, text field,
  search field, select field, textarea, toggle, checkbox, slider, stepper, and
  tabs. Missing controls are gap-audit subjects, not automatically admitted
  `kit/ui` exports.
- Data and feedback taxonomy covers status badge, progress indicator, inline
  alert, empty state, loading skeleton, error state, success state, and semantic
  status emphasis. Status color meaning must resolve through governed status and
  accent tokens, not random palettes.
- Overlay and interaction taxonomy covers tooltip, dropdown menu, popover,
  action menu, confirmation dialog, and settings panel shell. Settings content,
  settings information architecture, and app-specific option models remain
  app-local.
- `nimi-accent` usage taxonomy covers focus ring, selected state, primary
  action, active navigation, subtle background tint, and positive/confirming
  status emphasis. Accent semantics are shared; app-local accent packs remain
  app-local manifest authority.
- Fixed companion hues that do not vary by accent pack must use `color.*`
  tokens such as `--nimi-color-indigo`; they must not be named as secondary
  accent tokens unless they are owned by the active accent pack.
- Soft status surfaces must resolve through `status.*.soft_bg`,
  `status.*.soft_border`, and `status.*.soft_text` tokens. Consumers should
  not hand-author status badge or alert backgrounds with raw `color-mix(...)`
  expressions when a soft status token exists.
- Density-mode guidance is platform-owned taxonomy and must live under
  `tables/nimi-ui-compositions.yaml#density_modes`; platform composition
  registry rows remain under `components` and must not be used to carry density
  guidance.

## P-DESIGN-025 — Composition Extraction Boundary

- The UI Card v2.1 composition examples are Desktop product-feel references,
  not platform composition authority. They may be decomposed into reusable
  primitive gaps, but the composed screen truth remains in Desktop app-local
  spec.
- Desktop dock layout may seed shell surface, icon nav, active nav, and badge
  primitive requirements; it must not seed a platform-owned dock layout.
- Desktop top shell status controls may seed icon button, badge, counter, chip,
  and compact toolbar primitive requirements; it must not seed Desktop status
  bar composition.
- Desktop command row may seed search, select, segmented control, and icon group
  primitive requirements; it must not seed Desktop filtering workflow truth.
- Desktop runtime, world library, contact/profile, and resource panels may seed
  panel, list, status badge, avatar header, stat row, and resource meter
  primitive requirements; they must not seed runtime metric schemas, world data
  models, contact IA, or panel placement truth.
- When a candidate can plausibly be both shared primitive and app composition,
  the default posture is app-local candidate until a later packet proves the
  reusable abstraction and records audit approval.

## P-DESIGN-026 — Anti-Drift Negative Pattern Contract

- Nimi product UI must stay compact, glass-based, token-governed, and
  component-led. Reference-card negative examples are admitted as anti-drift
  categories, not as pixel-level fixtures.
- Governed product surfaces must not introduce marketing hero patterns,
  oversized gradient cards, random accent palettes, plain native web-form
  styling, dense border-first form grids, or ad hoc heavy-shadow cards when a
  shared primitive family covers the need.
- Future visual and pattern gates must encode these negative categories as
  executable checks or named visual smoke fixtures before they are used as
  release criteria.
- App-local exceptions for negative categories require a local manifest entry,
  a named owner, and a reason they do not redefine shared primitive or token
  authority.

## P-DESIGN-027 — Interaction & Motion Contract

- Motion behavior is a governed contract, not per-component taste. The prose companion is `nimi-ui-motion-contract.md`; token values live in `tables/nimi-ui-tokens.yaml` (`motion.*`) and `tables/nimi-ui-themes.yaml`.
- One motion scale exists for both CSS and TypeScript: `motion.fast` / `motion.base` / `motion.slow` / `motion.ambient` durations plus `motion.ease_standard` / `motion.ease_emphasized` / `motion.ease_decelerated` / `motion.ease_accelerated`. Any TypeScript motion mirror must resolve to the same values as the CSS tokens; a divergent hardcoded duration or easing in kit or app code is drift.
- Pressed feedback is mandatory on interactive primitives: pointer-down must produce visible feedback within one frame via `motion.pressed_scale` (or an admitted token-driven equivalent), independent of hover styling.
- Overlay enter/exit motion is spring-based and symmetric: a surface exits along the same path it entered, anchored to its spatial source where one exists (popover/menu from trigger, drawer from its edge). CSS keyframe enter/exit animations on governed overlays are not admitted. The admitted implementation substrate is the kit motion layer (`@nimiplatform/kit/ui/motion`) built on the `motion` package; app code must not hand-roll overlay animation or adopt a parallel animation library for governed surfaces.
- Gesture-driven motion must start from the current presentation value and carry pointer velocity into the spring target; momentum projection uses the decay model declared in `nimi-ui-motion-contract.md`. Fixed-duration target animations are only admitted for non-gesture state changes.
- Functional transitions animate compositor-friendly properties (`transform`, `opacity`, plus color/box-shadow for state changes). `transition: all` is not admitted on governed components.
- `prefers-reduced-motion` must keep spatial causality while removing travel: overlays cross-fade in place instead of sliding/scaling, pressed feedback stays instantaneous, and ambient/looping motion stops. The global duration guard in the generated theme base is the floor, not the whole contract.

## P-DESIGN-028 — Density Runtime Axis

- Density is a runtime axis owned by the theme layer, not guidance prose. The admitted values are `compact`, `regular`, and `expressive`; `regular` is the default and needs no attribute.
- Density is applied at a page or composition boundary through the shared scheme runtime (`data-nimi-density`). `NimiThemeProvider` sets the root default; any element may declare the attribute for its subtree. An `expressive` boundary inside a compact region restores foundation sizing/typography via the generated escape-hatch rules in the density theme pack. Per-control ad hoc height/radius overrides to simulate density are not admitted.
- `density` packs (`pack_kind: density` in `tables/nimi-ui-themes.yaml`) carry only `sizing.*` and `typography.*` overrides for the `compact` boundary. They must not redefine `color`, `material`, `backdrop`, `radius`, `stroke`, `elevation`, `motion`, or accent-layer tokens.
- Desktop operational surfaces default to `compact`; identity/hero surfaces opt into `expressive` at the composition boundary per `tables/nimi-ui-compositions.yaml`. The composition taxonomy remains the admission authority for which surfaces may leave `regular`.
- Consumers that render governed surfaces must import the density theme pack (`kit/ui/src/generated/themes/nimi-density-compact.css` or its dist equivalent) alongside the foundation scheme packs.

## P-DESIGN-090 — Nimi Design Hard Gate

- `pnpm check:nimi-ui-pattern` is the hard gate for cross-app design compliance.
- The gate must fail when:
  - a governed module does not import `@nimiplatform/kit/ui`
  - an app renderer entry does not import the shared foundation CSS, both scheme packs, and exactly one accent pack
  - an app renderer entry does not apply theme state through the shared scheme runtime
  - a governed module defines local shell/sidebar/surface/action/overlay/toggle/scroll_area/avatar helper families
  - platform design tables contain non-core app consumption inventories instead of app-local kit manifests
  - an app-local stylesheet defines a parallel root token registry or `@theme` block for governed semantic `--nimi-*` tokens
  - an app-local stylesheet assigns values to `--nimi-*` variables
  - a governed module defines CVA variants for shared primitive families outside `kit/ui`
  - a governed module introduces raw visual contract values outside `tables/nimi-ui-allowlists.yaml`
  - a foundation scheme or accent pack omits a required token value for its layer
  - a governed product surface introduces an admitted anti-drift negative
    category without an app-local controlled exception

## Fact Sources

- `tables/nimi-ui-tokens.yaml`
- `tables/nimi-ui-primitives.yaml`
- `tables/nimi-ui-themes.yaml`
- `tables/nimi-ui-compositions.yaml`
- consuming app `spec/**/tables/nimi-kit-adoption.yaml` manifests
- consuming app `spec/**/tables/nimi-kit-compositions.yaml` manifests
- `tables/nimi-ui-allowlists.yaml`
- `tables/rule-evidence.yaml`
- `nimi-ui-motion-contract.md`


---

<!-- source: .nimi/spec/platform/kernel/kit-contract.md -->

# Kit Contract — P-KIT-*

> Cross-app shared platform toolkit: foundation UI, feature modules, logic modules, and infra modules.

## P-KIT-001 — Kit Package Authority

- `@nimiplatform/kit` is the single authoritative package for cross-app shared platform infrastructure.
- Sub-modules are published through subpath exports on the single package: `/ui`, `/auth`, `/core/*`, `/telemetry/*`, `/features/*`, `/shell/capabilities`, `/shell/renderer/*`, and `/shell/electron/*`.
- Apps must not duplicate capabilities already covered by a kit sub-module in app-local code.

## P-KIT-002 — Kit Sub-Module Registry

- Every kit sub-module must be explicitly registered in `tables/nimi-kit-registry.yaml`.
- Registry rows must declare `subpath`, `kind` (`foundation`, `feature`, `logic`, `infra`), `dependencies`, `peer_dependencies`, `exports`, `admission_status`, and `owner`.
- New sub-modules must be registered before their first consumer import.

## P-KIT-003 — Kit Location and Boundary

- Kit source lives at `kit/` in the repository root, peer to `apps/`, `sdk/`, and `runtime/`.
- `kit/` is a single workspace package rooted at `kit/package.json`; sub-modules do not carry independent workspace package manifests.
- Kit sub-modules must not import app-layer code (`apps/**`).
- Kit sub-modules must not import runtime internal code (`runtime/internal/**`).
- Apps consume kit TypeScript surfaces through `@nimiplatform/kit/<subpath>`.
- `kit/shell/capabilities/**` is the admitted standard shell contract surface within the single kit authority. Tauri, Electron, renderer bridge code, and acceptance gates consume capability ids, command names, and standard errors from this surface.
- `kit/shell/tauri/**` is an admitted non-npm Rust crate surface within the single kit authority. Apps consume it via Cargo path dependency, not npm import. It has no `package.json` exports and does not carry an independent workspace package manifest.
- `kit/shell/electron/**` is an admitted npm TypeScript surface within the single kit authority. Apps consume it through `@nimiplatform/kit/shell/electron/*` subpath exports from Electron main/preload code, not from renderer application code.

## P-KIT-010 — UI Sub-Module (nimi-ui)

- `ui` is the foundation module for shared design tokens, primitives, themes, and generated visual contracts.
- All existing `P-DESIGN-*` rules remain in force for the UI sub-module.
- The token → primitive → generation → gate pipeline is unchanged.
- Consumer import path: `@nimiplatform/kit/ui`.
- Generation pipeline output: `kit/ui/src/generated/`.
- `ui` owns reusable primitive families and default visual behavior only. It
  must not absorb app product composition, information architecture, route
  placement, data schemas, or app-local consumption inventories.
- UI reference-card taxonomy may identify missing primitive families, but a
  missing family is only a gap-audit item until `tables/nimi-ui-primitives.yaml`,
  `kit/ui` implementation, tests, and generated docs are updated together.

## P-KIT-020 — Auth Sub-Module

- `auth` is a feature module and may contain components, hooks, logic, adapters, storage, and CSS within one bounded public surface.
- Auth components must consume `--nimi-*` CSS custom properties; no independent token system is permitted.
- Platform-specific logic must be injected through `AuthPlatformAdapter`; no direct Tauri/Electron imports.
- Scoped presentation themes (`data-shell-auth-theme`) may override `--nimi-*` variable values within `.nimi-shell-auth-root` but must not create a parallel global namespace.

## P-KIT-030 — Core Sub-Module

- `core` is a logic module for shared env, capability detection, OAuth helpers, and Desktop Open Intent pure helpers.
- Core is a pure-logic utility library: zero UI dependencies, zero CSS imports, zero runtime rendering code.
- OAuth helpers must be parameterized on `TauriOAuthBridge`; no Tauri-specific imports.
- Shell mode detection must read injected environment values (`VITE_NIMI_SHELL_MODE`); no hardcoded app names.
- Zero runtime dependencies (TypeScript types and logic only).

## P-KIT-040 — Telemetry Sub-Module

- `telemetry` is an infra module for renderer-side telemetry and reusable error boundaries.
- Must be renderer-safe: no Tauri, Node.js, or Electron direct imports.
- Telemetry emitters must be structureless (accept caller-supplied payloads without imposing schema).
- Error boundary must be React-only and must not assume a specific app context.
- Only peer dependency on React is permitted.

## P-KIT-041 — Native Protected Carrier And Tauri Shell Modules

- `shell/protected-local` is the single shared native host contract for
  protected Runtime mutual endpoint/process/executable verification, the empty
  `OpenDesktopSession` bootstrap, and typed fixed-service
  `status/start/restart`. Kit carries typed calls only; Runtime/OS own endpoint,
  origin, custody, service lifecycle and security truth. Product stop, binary /
  service/path selection, generic config JSON and bearer privilege are absent.
  The Windows local-app child carrier is host-only and cannot be exported to
  renderer or npm surfaces.
- `shell/tauri` is an infra module that consumes `shell/protected-local` and
  implements app-agnostic Tauri shell capabilities. It must not implement a
  parallel daemon manager, stage/execute Runtime, own credentials, exchange
  OAuth tokens, inject Realm endpoints, or expose protected generic gRPC IPC.
- Authority id and source location are `kit.shell.tauri` at `kit/shell/tauri/`.
- Public standalone delivery crate name is `nimi-shell-tauri`; standalone
  generated apps depend on the published crate only after scaffolding shell
  package API and publication mechanics are admitted.
- `platform_catalog` modules under this crate are generated read-only projections of Platform catalog tables. They are consumer surfaces, not canonical catalog truth, and must not write app-local admission rows.
- Workspace generated apps consume the same crate surface by Cargo path dependency.
- The crate must expose standard capability modules through `nimi_shell_tauri::capabilities::*`; consumer apps must not import shared capability implementations through old top-level Tauri module paths.
- Must remain renderer-agnostic: pure Rust host/bridge logic, no JS/TS runtime code.
- Must not contain app-specific business logic, single-consumer menu bar logic,
  or realm/runtime typed API truth.
- Shared `runtime_defaults` payload shape is owned by `shell/capabilities` and
  contains only non-security shell hints. Realm/JWKS/revocation endpoints,
  tokens, account/subject, provider/model/connector/local endpoint truth,
  service/listener identity, executable selector and config paths are forbidden.
- Consumer Tauri apps that wire `nimi_shell_tauri::runtime_defaults` must not retain an app-local src-tauri defaults module duplicate for the same payload shape.
- D-IPC-* rules continue to govern IPC contract semantics; this module provides the shared implementation.
- App identity and session prefix must be parameterized; no hardcoded app branding in shared code.
- Generated runtime bridge method IDs must have a single source owner in the standard shell capability catalog or Runtime/SDK generated bridge tables; Tauri must not define parallel command truth.
- Build-time static assets (e.g., OAuth callback HTML template) may be consumed via admitted build inputs, not cross-layer `include_str!` from app paths.

## P-KIT-041C - Standard Shell Capabilities Module

- `shell/capabilities` is the standard contract surface for Nimi shell hosts. It owns standard capability ids, operation ids, command names, operation-level negative states, and the standard shell error envelope.
- Active machine authority is `tables/standard-shell-capabilities.yaml`. Non-authoritative execution dossiers, acceptance matrices, and gates may consume or validate this table but must not become parallel truth.
- Delivered as the `@nimiplatform/kit/shell/capabilities` package export for TypeScript consumers and mirrored into Rust host adapters through `nimi_shell_tauri::capabilities`.
- Nimi ecosystem capabilities are standard, not optional: binding-only/runtime
  ordinary transport, typed Runtime service status/start/restart, non-security
  runtime defaults, native browser/callback observation, shell UI, diagnostics, data, storage,
  config, local assets, local agent, AI Profile, AI Config, avatar,
  agent-center, platform projection, file dialog, file reveal, export,
  artifacts, and floating window must be represented in this catalog. Shared
  auth is carried by `runtime.unary` / `runtime.streamOpen` to
  RuntimeAccountService; app-readable/app-writable `auth.session*` is not an
  active product capability and must not appear in the standard catalog.
- Standard `data.pathResolve` and `storage.*` operations resolve under a
  host-owned app data root. Renderer payloads must not carry absolute storage
  roots; they may carry only `{ relativePath }` or `{ relativePath, value }`.
  Hosts obtain the root from a
  Runtime-internal principal/session-derived storage projection, never an app-id
  lookup or renderer input. `data.pathResolve` remains unavailable on the 0K
  local-app carrier. The exact `storage.readJson`, `storage.writeJson`, and
  `storage.removeJson` operations are admitted for that carrier by P-KIT-044:
  Runtime derives and revalidates the current principal/account partition on
  every call, enforces the canonical relative JSON path plus 256 KiB document
  and 16 MiB partition quotas, and returns no path or root field. This is a base
  entitlement with no permission row or prompt. No generic file operation is
  implied.
- `storage.removeJson` is an idempotent app-storage lifecycle primitive. If
  the file exists the host removes it; if it is already absent the operation
  still succeeds. Full standard hosts retain `{ path, removed }`; the protected
  local-app projection is exactly `{ removed }`.
- Standard host failures must use the envelope fields `code`, `reasonCode`, `actionHint`, `source`, and optional `details`. Browser/no-host fallbacks, raw `file://` conversion escape hatches, and silent no-op behavior are not standard shell behavior.
- Standard `agent-center.*` operations own host-local Agent Center asset byte custody only: avatar/background import, validation, preview material resolution, Live2D adapter sidecar association, and scoped resource removal. They must not expose `configGet` or `configSet`, persist selection truth, decide Avatar readiness, return raw filesystem paths, or materialize runtime launch payload truth.
- `renderer_entry_probe` is a diagnostics capability. Generic `runtime_account_caller`/trusted caller metadata belongs to the local-agent standard capability; Desktop-specific caller policy remains product-owned and must not be promoted into the standard catalog.
- Tauri and Electron host adapters must implement the same capability ids and shared error envelope. Gaps must fail closed with catalogued standard error codes instead of returning pseudo-success.
- `runtime-lifecycle.stop` does not exist. Lifecycle payloads cannot contain a
  service name, binary path, argv, endpoint, config path or trust-record path.
  Generic runtime unary/stream commands reject every protected method; those
  require `shell/protected-local`.

## P-KIT-041F - Standard Shell File & Window Capabilities

- The standard catalog additionally owns file-dialog (OS open dialogs),
  file-reveal (reveal a host-validated path in the OS file manager), export
  (user-facing file export writes), artifacts (binary artifact writes under the
  app data root), and floating-window (companion-window control for
  transparent floating embodiment surfaces). Apps must consume these standard
  operations instead of registering parallel app-local shell commands for the
  same semantics.
- `file-dialog.open` returns host-selected absolute paths; the host validates
  and registers returned paths for subsequent read access. Renderer-supplied
  absolute paths remain forbidden inputs.
- `file-reveal.reveal` accepts only paths inside the host-owned app data root,
  admitted local asset roots, or paths previously returned by host file
  selection; anything else fails closed as `invalid-path`.
- `export.saveFile` writes renderer-supplied `dataBase64` bytes into the
  host-owned export directory with sanitized, collision-free naming. Empty or
  undecodable payloads fail closed as `invalid-payload`.
- `artifacts.write` writes binary artifacts only under the `artifacts/`
  subtree of the host-owned app data root with
  `{ relativePath, mimeType?, dataBase64 }`; subtree escape fails closed as
  `invalid-path`. Written artifact paths are eligible inputs to
  `local-assets.resolveUrl`.
- `artifacts.readRuntimeBytes` is not admitted for third-party local apps while
  `artifacts.open` remains reserved. A future positive path requires the
  owner-controlled artifact picker and one-shot handle in P-PERM-017; a
  caller-supplied artifact id, session or internal operation id is not
  authority.
- `floating-window.*` operations act on the invoking window only.
  `beginManualDrag` is manual-only: it returns the current window origin with
  `mode: "manual"` so renderers can apply pointer-driven moves through
  `moveManualDrag`. System-level window dragging remains owned by
  `shell-ui.startWindowDrag`, not by floating-window manual drag. Hosts that
  cannot support an operation must fail closed with `capability-unavailable`,
  never simulate success.
- Local-app capability sets forbid all P-KIT-041F operations. Future external
  file, Artifact or cross-app access must enter through its admitted public
  permission and owner picker rather than a capability-set exception.

## P-KIT-042 — Renderer Shell Module

- `shell/renderer` is an infra module for shared renderer shell glue: host-neutral command wrappers, bridge primitives, and bootstrap skeleton for Tauri and Electron hosts.
- Existing surfaces are delivered as subpath exports of the single
  `@nimiplatform/kit` package: `./shell/renderer/bridge` and
  `./shell/renderer/bootstrap`. The admitted hard-cut addition is
  `./shell/renderer/host`; it is not consumable until its registry row,
  package export, source, tests, and `P-KIT-090` evidence agree.
- `./shell/renderer/host` owns the reusable `nimi.renderer.host/v1` seam once admitted:
  provider-scoped capabilities, localization, opaque instance identity scope,
  mandatory renderer/overlay targets, theme application, surface lifecycle,
  overlay lease/coordinator types, and host-neutral standard-shell result
  mapping. It cannot expose `hostKind`, `isSimulator`, `shellMode`, raw module
  or instance ids, Runtime transport, credentials, or production authority.
- The concrete host allocates roots, scopes, overlay/z-index leases, permitted
  browser effects, and lifecycle resources. Kit defines and enforces the seam;
  it does not allocate Simulator resources or infer the current host.
- Must not contain app-specific stores, navigation, UI rendering, or runtime readiness policy.
- Must not re-own auth session truth or telemetry normalization truth already owned by `kit/auth` (domain/auth) and `kit/telemetry` (domain/telemetry).
- Shared `parseRuntimeDefaults()` semantics consume the `shell/capabilities` runtime-defaults contract: missing required realm defaults must fail closed instead of normalizing to empty strings, and consumer apps must not fork a parallel parser contract.
- Renderer bridge code must source standard command names and standard error handling from `@nimiplatform/kit/shell/capabilities`.
- Renderer bridge code must fail closed when no standard host is installed. Browser/no-host fallbacks, renderer-owned Tauri truth, raw `@tauri-apps/api` imports, raw Tauri global probing as capability truth, raw `file://` fallback conversion, and silent UI no-ops are forbidden in standard shell mode.
- Bootstrap skeleton provides shared orchestration hooks; app-local code retains runtime readiness, daemon policy, and local data bootstrap.
- Consumer apps may retain app-local facade directories for app-specific bridge
  modules only when their own spec owns that boundary; shared core primitives
  come from this module.
- Consumer-specific UI adapter components must not be placed in this module.

## P-KIT-041E - Electron Shell Module

- `shell/electron` is shared Electron main/preload host glue that consumes
  `shell/protected-local` for exact typed protected calls and fixed-service
  status/start/restart while keeping preload IPC narrowed. There is no
  production external-daemon mode.
- Local-app hosts use the Kit-owned exact capability registration entrypoint;
  app input is limited to app id, exact renderer URLs, and Electron IPC
  registration. Runtime endpoint, ordinary gRPC client, native carrier,
  capability-set, command-handler, and local-app-session selection are not
  app inputs.
- Authority id and source location are `kit.shell.electron` at `kit/shell/electron/`.
- Delivered as subpath exports of the single `@nimiplatform/kit` package: `./shell/electron/main` and `./shell/electron/preload`.
- This module is Node/Electron-host only. Renderer application code must consume host-neutral renderer APIs from `shell/renderer` and standard command/error contracts from `shell/capabilities`, not import `shell/electron` directly.
- Must not contain app-specific stores, routes, product UI, business logic, Runtime/Realm typed API truth, or app-local command semantics.
- Generic Runtime bridge forwarding may preserve the public/binding-only wire
  shape, but must reject protected method ids and authorization-bearing
  renderer payloads. Protected session/origin material stays inside the native
  carrier and is neither injected by Electron main providers nor exposed to
  preload/renderer.
- The Windows x64 Node-API projection may expose the same closed Desktop
  control operation families as `shell/protected-local`, including the exact
  K-RPC-004 product-control method enum. It must validate the enum before
  opening the verified channel and must not expose an arbitrary method-id
  proxy, endpoint, metadata, credential, session, process, or boot-epoch
  selector. Electron main may forward generated request/response bytes only
  after this native exact-operation selection; preload and renderer never
  receive the native binding.
- Runtime restart invalidates public/binding-only host registration metadata
  and every native protected session. On the exact typed restart boundary,
  public/binding-only metadata may be rebuilt and a unary call or server stream
  retried at most once; a protected caller must reopen through the native
  carrier and must not be reconstructed as Electron metadata. The typed account
  probe may classify only `PRINCIPAL_UNAUTHORIZED` paired with
  `CALLER_UNAUTHORIZED` or `CALLER_ENVELOPE_MISMATCH`; explicit
  `APP_NOT_REGISTERED`, `LOCAL_APP_PERMISSION_REVOKED`, and `SESSION_EXPIRED` retain their
  owner-specific typed handling. Endpoint, business, other permission, and
  unclassified failures never enter this recovery path or retry indefinitely.
- Public/binding-only Runtime gRPC calls may use raw identity byte
  serialization/deserialization through `@grpc/grpc-js`; generated Runtime
  truth remains owned by Runtime proto/SDK. This path cannot carry protected
  account/lifecycle/Realm/Grant methods.
- Electron never owns Runtime lifecycle. It may carry exact typed fixed-service
  `status/start/restart` through `shell/protected-local`; stop, external-daemon
  mode, executable/config selection and generic mutation are forbidden.
  Unavailable/untrusted service status is a typed failure, never offline
  pseudo-success.
- Preload must expose only the narrowed Nimi bridge API needed by renderer code. It must not expose raw `ipcRenderer`, `electron`, `fs`, `child_process`, arbitrary channel senders, or unrestricted event listeners.
- Main-process IPC must enforce catalog-sourced command namespaces, app identity, and an explicit renderer origin allowlist. A missing app id or disallowed origin is a fail-closed host error.
- Standard Electron acceptance windows must enable `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false`.
- Local artifact URLs must be served through a registered protocol or same-origin host handler with path/root validation. The protocol registration, path/root validation, and readable-file registry are owned by `shell/electron`; consumer apps must not register parallel per-app file protocols or app-local URL resolvers for standard local-asset serving. Electron renderer code must not receive raw `file://` escape hatches for artifact inspection.

## P-KIT-044 - Local App Standard Shell Capability Set

Kit owns typed shell APIs and trusted carrier implementation only. It cannot
create account, principal, provenance, record, permission decision, launch,
process, session, or owner-operation truth. The final host-private carrier opens one common
request-empty local-app session after Runtime has bound the native connection
to a current launch lease and verified process/record. It never accepts these
facts from renderer, app, endpoint, environment, or caller metadata.

The Electron and Tauri host adapters consume the same local-app client and
typed failure model. Fixed production AppHost and native development remain
different execution profiles, but provenance has no permission effect. The
admitted surface is exact typed session posture, product permission
status/request, and the three P-KIT-044 local-app JSON storage operations; no
method-id/bytes proxy or generic protected Runtime forwarding is admitted.
Storage renderer input contains a canonical relative
path and, for write, one JSON value. The native host invokes the corresponding
closed RuntimeAppService methods; it does not call `GetAppStorage`, expose a
data root, accept an app/principal selector, or fall back to Node filesystem
access. Read/write return `{ value, sizeBytes }`; remove returns `{ removed }`.
`permission.status` and `permission.request` carry only an admitted public
`permissionId` and bounded user-facing reason and map to
`GetLocalAppPermissionStatus` / `RequestLocalAppPermission`. Internal operation,
resource, selector and owner-decision identity are forbidden. No public permission is
currently admitted, so every reserved permission request returns typed
unavailable. Artifact, Agent, conversation and voice methods are absent from
the renderer/SDK surface until their complete product permission slice is
admitted.

A valid session may use app-private storage without any permission. App-owned
SQLite, media, settings, cache, routes and exact product commands remain app
native-host authority and do not enter this Runtime permission client. Session,
lease, proof, account, principal, record, provenance, process, and boot-epoch
material remain native-host private and are absent from preload/renderer/status/logs.

The Windows fixed-service carrier is the positive path. Missing/untrusted
service or carrier, process mismatch, revoke, account switch, or Runtime restart
returns a typed failure and requires the admitted recovery flow. Ordinary gRPC,
external-daemon mode, renderer auth, manually started host, and pseudo-success
fallback are forbidden. Unsupported OS/profile combinations remain fail-closed.

## P-KIT-045 - Desktop Open Intent Kit Surfaces

- `core/desktop-open` is a pure-logic Kit surface that wraps SDK
  `NimiDesktopOpenIntent` parser/types and provides normalized result helpers.
  SDK owns TypeScript semantic parsing; Kit must not fork a second parser truth.
- `shell/capabilities` owns the standard operation id
  `desktop-open.openIntent` and command name
  `nimi.shell.desktopOpen.openIntent`.
- `shell/renderer` exposes a host-neutral renderer bridge whose payload may
  include only `intent` and optional `requestId`. Renderer payloads must not
  include `sourceApp`, `sourceHost`, Desktop endpoint, Desktop token, raw URL,
  or OS scheme.
- `shell/electron` and `shell/tauri` implement host clients that resolve the
  running Desktop presence descriptor and POST to Desktop's exact-loopback
  bridge. They must not start Desktop.
- Domain-level Desktop Open rejections return as successful command values
  shaped as `NimiDesktopOpenResult`. The standard shell error envelope remains
  reserved for missing capability, forbidden renderer access, malformed command
  payload, serialization failure, and host internal errors before a domain
  result can be produced.

## P-KIT-046 - Local-Development Host Bootstrap And Status

Kit owns one typed local-development bootstrap/status projection over the
common local-app host/client. Native adapters consume only the Runtime-created
carrier opened through Desktop's verified supervisor. They rotate and reopen a
new lease/session for controlled process replacement or Runtime restart; app
code cannot provide endpoint, bootstrap, session, proof, epoch, PID, principal,
record, root, capability fingerprint, account, or trust class.
While the same verified host connection remains live, Kit main/native code
renews the short-lived technical session through the request-empty,
host-only `RenewLocalAppSession` operation before expiry. Renewal is serialized
against business calls and is never projected as renderer authority.
If bootstrap or renewal fails, the Electron bridge unregisters renderer
commands before invoking one no-argument host-lifecycle close callback. The
Desktop supervisor may then reopen a new lease/session under an unchanged
durable authorization; app code receives no reason detail, recovery selector,
session material, or authority and cannot keep the failed bridge live.

Renderer-safe bootstrap state is the closed set `authorizing`, `ready`,
`denied`, `runtime-unavailable`, `revoked`, and `project-changed`, with typed
reason and retryability only. No protected material enters preload exports,
renderer globals, terminal output, logs, exceptions, or status payloads.
Electron and Tauri project identical state and operation semantics even though
their native host restart mechanics differ.

The positive surface contains session posture, public permission posture/request,
and app-private JSON storage. Kit must not expose account control, credential
material, permission lifecycle mutation, generic Runtime forwarding, or
unadmitted protected operation families. App-native commands remain separate
typed host commands. A missing/untrusted carrier fails closed and cannot fall
back to ordinary gRPC or inherit another principal's state.

## P-KIT-047 - Generated First-Party Protected Desktop Carriers

Kit owns one shared Electron/Tauri main/native adapter family for Runtime's exact
first-party protected profiles. The sole operation-set input is
`.nimi/spec/runtime/kernel/tables/first-party-protected-runtime-profiles.yaml`;
Kit, Desktop and app code cannot maintain another method/profile selector. The
compiler emits exact unary and stream entrypoint families for
`desktop_machine_product_v1`, `desktop_account_product_v1`, and
`bundled_avatar_v1` while preserving one physical `desktop_control` carrier.
The profiles remain logically distinct and Desktop never borrows Avatar app id,
origin role, sender registry, or principal.

Desktop supplies main-process authorization registries that recognize only the
exact `BrowserWindow`/`WebContents` objects it created. Kit binds every unary,
stream-open, stream-next, stream-close and cancel command to `event.sender` and
the current main frame before applying registered URL/navigation state as a
secondary integrity condition. URL or origin alone never establishes identity.
Native main selects a generated named intent entrypoint and fixes the profile
after renderer parsing. Renderer input cannot contain or override endpoint,
profile, role, principal, app id, account, owner, metadata, token, grant, scope,
capability, arbitrary method id, or host-equivalence marker.

Unary and server-stream calls use generated SDK request/response bytes. Kit may
carry those bytes only after exact generated intent/method selection; it owns
neither Runtime DTOs nor business policy. Machine streams bind sender,
connection and Runtime boot epoch. Account and Avatar streams additionally bind
the current Runtime account generation. Navigation, destruction, sender
replacement, logout/switch, account-generation change, connection loss, process
replacement, Runtime restart, window closure, or host shutdown closes every
applicable stream before later delivery or commit; streams never silently
reconnect across an invalidation boundary.

The compiler must emit matching Runtime, protected-native Rust, Electron, Tauri
and SDK projections plus one count/member/kind/digest manifest. Missing native
support, unbound/non-main-frame sender, wrong generated entrypoint, stale boot or
account generation, unsupported platform, and every profile-external method
fail before Runtime handler dispatch, without public gRPC, direct-Electron,
generic unary/stream, or another profile fallback. The existing
`bundled_avatar_v1` 31-method fingerprint remains parity-locked during the
compiler cut.

## P-KIT-043 — Runtime Capabilities Module

- `core/runtime-capabilities` is a logic sub-surface for pure-logic capability normalization, wildcard matching, and codegen capability catalog truth.
- Must be runtime-safe and renderer-safe: zero UI, CSS, app code, or shell-specific imports.
- May be consumed by runtime-side code (Go consumers via shared contract) in addition to renderer consumers.
- Must not be stranded in any single app's runtime directory; this is the single shared truth for capability semantics.
- Replaces any app-local capability catalog as the canonical owner.

## P-KIT-050 — Future Module Admission

- New shared capability modules are admitted to `nimi-kit` only when they are already reused by, or explicitly planned for, at least two apps.
- New modules must register their public surface before implementation lands.
- Registry entries must declare dependency direction against existing kit modules and external packages.
- New modules must add a dedicated hard gate or extend an existing gate before broad adoption.

## P-KIT-060 — Feature Module Topology

- `kit/features/*` is the product-capability layer for reusable Nimi AI surfaces.
- Feature modules are not restricted to pure UI components; they may contain `components`, `hooks`, headless logic, adapters, and styles inside one bounded module.
- Feature modules must not import app-layer code, app state stores, `dataSync`, or platform bridge implementations directly.
- Feature modules must remain portable across apps by consuming injected adapters only.

## P-KIT-061 — Chat Host Composition Adapter Boundary

`kit/features/chat` remains the shared conversation-shell parity owner across
apps and exposes adapter slots for host-provided layout or presentation inputs.
Those adapter inputs are caller-supplied data, not kit-owned product truth.

Fixed rules:

- host-local layout or presentation inputs do not by themselves reopen shared
  canonical shell ownership for `kit/features/chat`
- adapter callers may pass geometry, placement, or flow taxonomy into the
  canonical adapter path, but kit must not fork a private transcript shell,
  private scroll-root truth, or private grouping / virtualization truth
- `kit/features/chat` remains the shared parity owner outside explicit adapter
  inputs
- any future widening of a host-local flow into shared kit ownership requires
  an explicit separate authority cut

## P-KIT-065 — Kit-First Reuse Protocol

- Before adding or refactoring app-local UI or interaction logic, implementers must inspect `kit/ui`, `kit/auth`, relevant `kit/features/*` READMEs, and `tables/nimi-kit-registry.yaml`.
- If an existing kit surface covers the baseline styling and baseline interaction behavior for most of the need, apps must extend or compose that kit surface instead of recreating a parallel app-local shell.
- App-local implementation is permitted only when no matching kit surface exists, or when the remaining requirement is clearly app-specific.
- New app-local shells that are likely reusable across at least two apps must be treated as future kit admission candidates and documented as such before they become entrenched app-local patterns.

## P-KIT-070 — Headless and Default UI Surfaces

- Every feature module must expose both a headless surface and a default opinionated UI surface.
- Stable feature modules should publish explicit `/headless` and `/ui` subpath exports in addition to any aggregate module entry.
- Runtime-aware feature modules may additionally publish `/runtime` subpaths only when the integration binds `getPlatformClient().runtime` or runtime control-plane domains without app-layer stores or platform bridges.
- Realm-aware feature modules may publish `/realm` subpaths only when the integration binds `getPlatformClient().realm` without app-layer stores or platform bridges.
- Headless exports own state, filtering, submit protocols, and interaction contracts.
- UI exports may compose `ui` primitives and themes, but must not bypass headless contracts with app-local assumptions.
- Default UI surfaces should cover baseline styling and baseline interaction behavior so consuming apps do not need to rebuild the same shell.
- Runtime and realm are distinct first-party seams and must not be treated as interchangeable labels.

## P-KIT-071 — Avatar Feature Module

- `kit/features/avatar` is the admitted reusable avatar surface for agent presentation in Nimi apps.
- It must publish aggregate, `/headless`, `/ui`, and `/runtime` surfaces on the single `@nimiplatform/kit` package.
- It may additionally publish backend-specific optional renderer surfaces such as `/vrm` and future `/live2d` surfaces when those surfaces preserve the same avatar semantic contracts and do not force heavyweight renderer/runtime assumptions into the default `ui` surface.
- `headless` owns normalized avatar presentation inputs, transient interaction-state contracts, and reusable controller logic.
- `ui` owns the default opinionated avatar stage shell that consuming apps may place without rebuilding a parallel baseline renderer shell.
- `runtime` may bind `getPlatformClient().runtime` only for runtime-owned persistent agent presentation projection; it must not absorb app stores, platform bridges, or renderer-local transient state ownership.
- Optional backend-specific renderer surfaces must remain renderer-implementation seams only; they must not re-own persistent presentation truth, transient interaction truth, or app-specific placement policy.
- `kit/features/chat` and app-local shells may consume `kit/features/avatar`, but they must not re-own avatar semantics or create a parallel chat-private avatar contract.

## P-KIT-072 — Avatar Ownership Hardcut

- `kit/features/avatar` consumes runtime-owned persistent `AgentPresentationProfile` truth and app-owned transient `AvatarInteractionState`; it does not own either canonical layer.
- The module must not own canonical agent identity, canonical memory, voice workflow truth, voice asset truth, thread continuity truth, or app-specific permission policy.
- The module must not import app stores, Tauri/Electron bridges, or runtime internal code directly.
- Surface-specific placement, permissions, and orchestration remain app-owned; avatar renderer semantics remain reusable kit-owned.
- Runtime-aware avatar helpers must fail closed when required presentation profile fields are absent or unresolved; they must not invent fallback avatar assets, provider voices, or surface-local pseudo-success truth.

## P-KIT-073 — Avatar Backend Renderer Seam

Fixed rules:

- backend-specific optional exports such as `/vrm` and `/live2d` are renderer
  seams only
- backend renderer seams must preserve the normalized avatar presentation
  contract from `/headless` and must not re-own persistent presentation truth
- backend renderer seams must not own avatar asset import, storage, registry,
  per-agent binding, fallback policy, local runtime packaging, or viewport
  lifecycle truth
- backend renderer framing intent vocabulary is `auto`, `full-body`,
  `bottom-companion`, and `head-shoulders`; app/product synonyms such as
  `chat-focus`, `scene-presence`, or `showcase` must be mapped by the app before
  crossing into kit
- a backend renderer export must be registered and shipped explicitly before it
  is available package surface; registry prose must not fabricate a shipped
  export
- backend admission is bounded to avatar-stage rendering semantics; pointer
  interaction parity, camera choreography, authoring flows, and model inspection
  behavior require separate authority if promoted to reusable kit surface

## P-KIT-074 — Avatar Interaction Adapter Boundary

`kit/features/avatar` may expose typed interaction adapter fields for active
avatar surfaces. These fields are renderer inputs and do not make kit the owner
of raw attention intake.

Fixed rules:

- interaction adapter fields may include resolved attention targets, continuous
  presence state, and bounded follow intent when admitted by the feature module
  type surface
- kit must not own DOM pointer capture, viewport measurement, attention
  smoothing, clamp policy, speaking-vs-attention precedence, or surface
  stop-line policy
- backend-specific optional surfaces such as `/vrm` and `/live2d` remain
  renderer seams and must not become semantic owners of interaction truth
- widening raw interaction lifecycle ownership into kit requires a separate
  platform authority cut

## P-KIT-080 — Adapter Injection Contract

- Every feature module must publish its adapter contract in the registry before adoption.
- Adapter contracts are the only allowed seam for app-specific data sources, mutations, and platform capabilities.
- First-party runtime-aware integrations may bind SDK typed services only from explicit `kit/features/*/runtime` subpaths.
- First-party realm-aware integrations may bind SDK typed services only from explicit `kit/features/*/realm` subpaths.
- `runtime` must not be used as a generic label for all first-party integrations. Local AI/runtime engine and realm business services are distinct seams.
- Feature modules must not import Tauri/Electron bridges, runtime internals, or SDK typed services directly when the same behavior can be injected through adapters.
- Feature module exports must make the adapter seam obvious through typed public interfaces.
- Registry metadata, package exports, and on-disk surface files must agree on whether a feature publishes `headless`, `ui`, `runtime`, and `realm`.
- An App canonical renderer factory may receive a `nimi.renderer.host/v1`
  binding from its production host or from the Simulator. The factory must use
  the same provider/store/route/UI construction path for both bindings and may
  not select components, copy, styles, or behavior through a host discriminator.
- A Simulator App Adapter is App-owned integration code, not a Kit feature
  adapter. It may construct values for Kit's renderer-host seam, but Kit does
  not own App projection reducers, scenario commands/events, fixtures, or
  Simulator selection.

## P-KIT-090 — Kit Hard Gate

- `pnpm check:nimi-kit` is the hard gate for kit sub-module compliance.
- The gate must fail when:
  - a registered sub-module is missing from disk or an on-disk sub-module is unregistered
  - a package export is unregistered or a registered export is missing from `kit/package.json`
  - a registry row omits required governance metadata or declares unsupported `kind`
  - a feature registry row omits `reuse_entrypoints`, or a listed reuse entrypoint does not exist in `kit/package.json`
  - a module-level `README.md` is missing
  - a feature `README.md` omits the kit-first reuse guidance section for local implementation decisions
  - a kit sub-module imports from `apps/**`
  - the core sub-module contains UI/CSS imports
  - the telemetry sub-module contains Tauri or Node.js imports
  - the `shell/renderer` sub-module contains app-specific stores, navigation, or UI rendering
  - the `shell/renderer` sub-module re-owns auth session truth or telemetry normalization truth
  - the `shell/capabilities` sub-module is missing from the package export map, diverges from `tables/standard-shell-capabilities.yaml`, or omits any required standard Nimi ecosystem capability
  - the `shell/renderer` sub-module uses browser/no-host fallbacks, renderer-owned Tauri truth, raw Tauri globals as capability truth, raw `file://` conversion fallback paths, or command names not sourced from `shell/capabilities`
  - the `shell/protected-local` boundary is absent, renderer-visible, or claims
    Runtime/OS lifecycle, custody, origin, listener, configuration or executable
    selection authority
  - the `shell/electron` sub-module is imported by renderer application code,
    exposes raw Electron/Node/protected primitives through preload, omits origin
    allowlist enforcement, uses non-sandboxed standard acceptance windows,
    generically proxies protected methods, or claims Runtime lifecycle ownership
  - the `core/runtime-capabilities` sub-module contains UI, CSS, or shell-specific imports
  - the auth sub-module defines CSS custom properties outside the `--nimi-*` namespace (except scoped overrides within `data-shell-auth-theme`)
  - a feature module omits required registry metadata for `surface_level`, `adapter_contract`, `headless_exports`, or `ui_exports`
  - a feature module claims `runtime` or `realm` capability but does not publish the matching surface
  - a feature module publishes `runtime` while binding `getPlatformClient().realm`, or publishes `realm` while binding `getPlatformClient().runtime`
  - a feature module imports app aliases, SDK client packages, or platform bridge implementations directly

## Fact Sources

- `tables/nimi-kit-registry.yaml`
- `tables/rule-evidence.yaml`


---

<!-- source: .nimi/spec/platform/kernel/agent-center-contract.md -->

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


---

<!-- source: .nimi/spec/platform/kernel/nimi-ui-material-contract.md -->

# Nimi UI Material Contract

> Supplementary spec documentation for the `P-DESIGN-022 — Material Layering
> Contract` rule declared in `design-pattern-contract.md`. This file is a
> prose companion to the token catalog in
> `tables/nimi-ui-tokens.yaml` and the value table in
> `tables/nimi-ui-themes.yaml`. It does **not** introduce a new token
> table or a new rule ID. It pins the 5-tier material taxonomy, declares
> the perf-downgrade hook-point interface at the spec level, fixes the
> a11y contrast threshold, and reserves an empty admitted-exceptions
> section for future controlled exceptions.
>
> Compatibility: this contract supersedes the prior 3-tier material taxonomy
> (`solid`, `glass-regular`, `glass-thick`), preserving those tier names
> byte-for-byte while admitting `glass-thin` and `glass-chrome` and
> re-anchoring the backdrop blur radii gradient.

## 1. Material Consumption Boundary

The 5-tier taxonomy admitted under `P-DESIGN-022` is the single material
authority for all governed surfaces in the repo. No app or feature
module may author a parallel material axis.

UI Card v2.1 surface labels map to this material taxonomy only as semantic
roles: app background, regular glass card, elevated glass card, navigation
surface, floating panel, and modal shell. They do not introduce new material
tiers and do not provide canonical blur, opacity, border, or shadow values.

**Allowed tiers (in ascending opacity / blur intensity order):**

| Tier | Background token | Border token | Backdrop blur |
|---|---|---|---|
| `solid` | resolves through the surface-tone token family (`surface.*`) — no material bg/border token | — | — |
| `glass-thin` | `material.glass_thin.bg` (`--nimi-material-glass-thin-bg`) | `material.glass_thin.border` (`--nimi-material-glass-thin-border`) | `backdrop.blur_thin` (`--nimi-backdrop-blur-thin`) |
| `glass-regular` | `material.glass_regular.bg` (`--nimi-material-glass-regular-bg`) | `material.glass_regular.border` (`--nimi-material-glass-regular-border`) | `backdrop.blur_regular` (`--nimi-backdrop-blur-regular`) |
| `glass-thick` | `material.glass_thick.bg` (`--nimi-material-glass-thick-bg`) | `material.glass_thick.border` (`--nimi-material-glass-thick-border`) | `backdrop.blur_strong` (`--nimi-backdrop-blur-strong`) |
| `glass-chrome` | `material.glass_chrome.bg` (`--nimi-material-glass-chrome-bg`) | `material.glass_chrome.border` (`--nimi-material-glass-chrome-border`) | `backdrop.blur_chrome` (`--nimi-backdrop-blur-chrome`) |

**Blur radii gradient (in px):** `10 / 18 / 24 / 28` mapped to
`blur_thin / blur_regular / blur_strong / blur_chrome`. This supersedes
the W1 `24 / 32` two-value anchor.

**Consumer rules:**

- Governed surfaces must consume material only through the
  `<Surface material="...">` primitive in `@nimiplatform/kit/ui` or
  the equivalent `data-nimi-material="<tier>"` marker class.
- Inline `rgba(...)` material background fills, inline
  `backdrop-filter` declarations, and hand-picked `backdrop-blur-*`
  Tailwind named tokens outside kit-emitted utility classes are
  forbidden.
- Accent packs must not override `material.*` or `backdrop.*` tokens.
  Material tokens are neutral `foundation`-layer tokens.
- Adding a 6th tier requires a new admission; this contract does not
  pre-authorize future expansion.

## 2. Perf-Downgrade Hook-Point Interface (Spec-Level)

This contract declares the interface signature for runtime
perf-downgrade of material tiers. Runtime implementation remains a separate
consumer responsibility and does not change the material taxonomy.

**Interface signature (spec-level; React-context-free expression):**

```
TransparencyLevel = "auto" | "none" | "reduced" | "full"
SurfaceProvider.transparencyLevel: TransparencyLevel

downgrade(tier: MaterialTier, level: TransparencyLevel) => MaterialTier
```

**Downgrade ladder (authoritative):**

| Input tier | `level=auto` | `level=full` | `level=reduced` | `level=none` |
|---|---|---|---|---|
| `solid` | `solid` | `solid` | `solid` | `solid` |
| `glass-thin` | `glass-thin` | `glass-thin` | `solid` | `solid` |
| `glass-regular` | `glass-regular` | `glass-regular` | `glass-thin` | `solid` |
| `glass-thick` | `glass-thick` | `glass-thick` | `glass-regular` | `solid` |
| `glass-chrome` | `glass-chrome` | `glass-chrome` | `glass-thick` | `solid` |

- `auto` respects `prefers-reduced-transparency` and collapses to
  `reduced` (or further to `none` when the media feature reports
  `reduce` and the user's OS-level preference explicitly disables
  transparency). Runtime implementation defines the exact signal
  sources; this spec fixes the collapse semantics.
- `full` and `auto` MUST resolve identically when
  `prefers-reduced-transparency: no-preference`.
- Downgrade must be idempotent: `downgrade(downgrade(t, l), l) ===
  downgrade(t, l)` for every tier and level.
- Downgrade MUST NOT cross accent-pack boundaries. Accent tokens are
  not consulted.

Phase 3b is expected to implement `downgrade` inside
`@nimiplatform/kit/ui` as a pure function and wire
`SurfaceProvider.transparencyLevel` through the existing theme provider
without introducing a new context.

## 3. A11y Contrast Threshold

Every `(tier, tone)` combination rendered on top of the expected
`surface.app_background` beneath the material MUST meet **WCAG 2.1 AA
— 4.5:1** contrast ratio for normal body text and **3:1** for large
text.

- The 4.5:1 threshold is fixed at this contract. Future relaxation
  requires a new admission.
- `glass-thin` has the lowest inherent contrast margin; modules
  rendering body text inside a `glass-thin` surface over a noisy
  ambient background MUST NOT rely solely on the material's
  transparency — they must either (a) nest an opaque text surface, or
  (b) downgrade to `glass-regular` or `solid` under
  `prefers-reduced-transparency: reduce`.
- `glass-chrome` has the highest contrast headroom but imposes the
  largest blur cost; module authors should prefer `glass-thick` unless
  the surface is a full-chrome shell (top bar, nav rail, system
  chrome).

The enforcement script (`check:ui-contrast-matrix`) is **not** authored
by this contract. It requires a separate admitted implementation authority.
This contract fixes the threshold; that authority implements the CI gate.

## 4. Material Role Matrix

Material tiers map to fixed spatial roles. Material strength encodes
hierarchy; it is not decorative. This section supersedes free-choice
material usage on governed surfaces.

| Role | Admitted tiers | Rule |
|---|---|---|
| `canvas` | `solid` (app background, optional ambient `mesh` per P-DESIGN-023) | Operational surfaces default to a neutral solid canvas; ambient motion is off by default outside expressive boundaries. |
| `structural chrome` | `glass-chrome`, `glass-thick` | Sidebars, top bars, nav rails. At most one structural material layer per region. |
| `content` | `solid`, `glass-thin`, `glass-regular` | Cards and panels carrying content. A glass content surface must not nest another glass surface of equal or stronger tier. |
| `floating / modal` | `glass-regular` … `glass-chrome` per overlay kind | Popovers, menus, dialogs, drawers. At most one floating layer per region; stacked sheets progressively dim/push back instead of stacking equal-strength glass. |

Stacking rule: within one region, at most one structural-chrome layer,
one content material layer, and one floating layer may overlap. Equal
or stronger-tier glass must never sit directly on glass of the same
role chain — legibility collapses and hierarchy flattens.

Vibrancy rule: glass materials combine their blur token with the shared
`backdrop.saturate` token (`--nimi-backdrop-saturate`, `180%`) so
materials stay vivid over changing content instead of washing to gray.
Consumers use the kit-emitted material classes; hand-authored
`backdrop-filter` saturation remains forbidden per §1.

## 5. Admitted Exceptions

_None._

This section reserves room for per-combination exceptions admitted by
Phase 3a or later phases. Any exception filed here MUST include:

- the specific `(tier, tone, app, surface_slot)` tuple it covers
- the measured contrast ratio that falls below 4.5:1 / 3:1
- the rationale for the exception (typically: a signature visual where
  degraded contrast is visually critical and the surface is not a
  text-carrying surface)
- the admission authority ID and date

Exceptions are not backward-compatible retroactive relaxations of the
contract; they are narrow, named carve-outs with fixed scope. The
default enforcement threshold remains 4.5:1 / 3:1 for any
`(tier, tone, app, surface_slot)` not listed in this section.


---

<!-- source: .nimi/spec/platform/kernel/nimi-ui-motion-contract.md -->

# Nimi UI Motion Contract

> Supplementary spec documentation for the `P-DESIGN-027 — Interaction &
> Motion Contract` rule declared in `design-pattern-contract.md`. This file
> is the prose companion to the `motion.*` token family in
> `tables/nimi-ui-tokens.yaml` and `tables/nimi-ui-themes.yaml`. It does
> not introduce a new token table or a new rule ID. It pins the interaction
> state model, the unified duration/easing scale, the spring presets, the
> momentum projection model, and the reduced-motion substitution rules.
>
> Apple/WWDC fluid-interface material is a reference for these behaviors,
> not a visual target. The goal for Nimi is coordination: one motion
> vocabulary shared by every governed surface, not an Apple look-alike.

## 1. Interaction State Model

Every interactive primitive resolves these states through the motion
contract; none may be skipped and none may be faked with hover-only
styling.

| State | Trigger | Required behavior |
|---|---|---|
| `idle` | — | No looping or decorative motion on operational surfaces. |
| `hover` | pointer over | Subtle token-driven color/border change only; no elevation shifts or translate lifts on standard actions. |
| `pressed` | pointer-down | Immediate `motion.pressed_scale` (`0.97`) transform in the same frame; never delayed to release. |
| `dragging` | pointer move past threshold | 1:1 tracking of the pointer from the grab offset; UI updates continuously, not at gesture end. |
| `settling` | release / re-target | Spring animation from the current presentation value with inherited velocity (§4). |
| `interrupted` | new input mid-motion | New animation starts from the live on-screen value; input is never locked out during a transition. |

## 2. Unified Duration & Easing Scale

One scale serves CSS transitions and TypeScript animation code. The CSS
custom properties are canonical; `kit/ui/src/motion/*` mirrors must
resolve to identical values.

| Token | Value | Use |
|---|---|---|
| `motion.fast` | `120ms` | pressed feedback, hover color changes, toggle thumb |
| `motion.base` | `200ms` | standard state transitions (tabs, menu items, field focus) |
| `motion.slow` | `320ms` | overlay fades, non-spring fallbacks, reduced-motion cross-fades |
| `motion.ambient` | `600ms` | ambient and theme-change transitions only |

| Token | Value | Use |
|---|---|---|
| `motion.ease_standard` | `cubic-bezier(0.2, 0, 0, 1)` | default state transitions |
| `motion.ease_emphasized` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | reversible overlay paths; the outbound and return path share it so motion is mirrored |
| `motion.ease_decelerated` | `cubic-bezier(0, 0, 0, 1)` | enter-only non-spring fallbacks |
| `motion.ease_accelerated` | `cubic-bezier(0.3, 0, 1, 1)` | exit-only non-spring fallbacks |

## 3. Spring Presets

Springs are the admitted behavior model for overlays, gesture settle, and
any motion a user can interrupt. Presets use the designer-facing
(response, damping ratio) pair; the kit motion layer maps them onto the
`motion` package.

| Preset | Response | Damping ratio | Tokens | Use |
|---|---|---|---|---|
| `default` | `0.4s` (`motion.spring_default_response`) | `1.0` (`motion.spring_default_damping`) | critically damped, no overshoot | dialog/popover/drawer settle, repositioning |
| `momentum` | `0.35s` (`motion.spring_momentum_response`) | `0.8` (`motion.spring_momentum_damping`) | slight overshoot | only after velocity-carrying gestures (flick, throw, drag release) |

Rules:

- Bounce is admitted only when the preceding gesture carried momentum.
  A menu or dialog that simply appeared must not overshoot.
- Two-dimensional motion decomposes into independent X and Y springs.
- Re-targeting a running spring blends current velocity; it must not
  restart from the logical target value.

## 4. Velocity Handoff & Momentum Projection

When a gesture ends, the settle spring inherits the pointer's release
velocity so no seam is visible between dragging and animating.

- Spring APIs that accept absolute velocity receive the raw pointer
  velocity (px/s). APIs that expect relative velocity normalize it:
  `relativeVelocity = gestureVelocity / (targetValue − currentValue)`.
- Flick landing uses exponential-decay projection, then snaps to the
  snap point nearest the projected resting position:

```
projectedEndpoint = currentPosition + (releaseVelocity / 1000) * d / (1 - d)
d = decelerationRate; 0.998 for scroll-like feel, 0.99 for snappier settle
```

The kit motion layer (`kit/ui/src/motion/gestures.ts`) owns the admitted
`projectMomentum` and `nearestSnapTarget` helpers; app code must not
re-implement projection math.
- Commit/reverse decisions must receive both the origin and target values.
  A helper must not assume that the reverse destination is coordinate zero;
  low-velocity fallback compares the projected endpoint against both explicit
  destinations.

## 5. Overlay Motion Grammar

- **Dialog / modal panel:** fade + scale `0.95 → 1` on the `default`
  spring; exit is the exact reverse on the same spring. Scale origin is
  the panel center unless a triggering element is known, in which case
  the origin anchors to the trigger.
- **Drawer:** translates along its own edge axis only (right-edge drawer
  moves on X), `default` spring, no scale. Enter and exit paths are
  symmetric.
- **Popover / menu:** fade + scale `0.96 → 1` plus a 4px offset along the
  side it opens from, `transform-origin` pinned to the trigger-facing
  edge per side. Side-aware behavior is mandatory; a popover must read
  as emerging from its trigger.
- **Backdrop:** opacity only, `motion.slow` with `motion.ease_standard`;
  no blur or color animation.

## 6. Reduced Motion Substitution

`prefers-reduced-motion: reduce` keeps spatial causality and drops
travel. It does not mean "no feedback".

- Overlays cross-fade in place (`opacity`, `motion.slow`); no slide,
  scale, or spring.
- Pressed feedback remains (instant scale or color change with zero
  duration is acceptable feedback, not vestibular motion).
- Ambient, looping, and parallax motion stops (see P-DESIGN-023 for
  ambient backgrounds).
- The generated global duration guard is the floor; kit motion-layer
  code must additionally resolve spring presets to opacity-only
  transitions when reduced motion is requested.

## 7. Admitted Implementation Substrate

- The kit motion layer (`@nimiplatform/kit/ui/motion`) built on the
  `motion` package is the single animation substrate for governed
  surfaces.
- CSS transitions remain admitted for `idle/hover/pressed` micro-states
  and color transitions under `motion.fast`/`motion.base`.
- CSS keyframe animation is admitted only for ambient backgrounds under
  P-DESIGN-023 and loading indicators; it is not admitted for overlay
  enter/exit or gesture-driven motion.
- App code must not adopt a second animation library or hand-rolled
  `requestAnimationFrame` loops for governed surfaces.


---

