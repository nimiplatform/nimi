# @nimiplatform/kit

The product-grade cross-app toolkit for Nimi apps. `@nimiplatform/kit`
packages the shared UI primitives, auth flows, telemetry, shell glue,
Platform catalog projections, and feature modules that every Nimi consumer
needs, so app authors do not have to rebuild baseline styling, interaction
shells, or platform wiring. The kit is a reusable projection of
platform-governed design and integration contracts; canonical semantics remain
in `.nimi/spec/platform/kernel/**`.

## Installation

```bash
pnpm add @nimiplatform/kit
```

The kit depends on `@nimiplatform/sdk`. During the 0.x phase, SDK
alignment is directional (see "Version Policy" below). React 19 is
required; `react-dom` and `react-i18next` are optional peers.

## Version Policy

`@nimiplatform/kit` publishes first at `0.1.0` and remains in a
pre-1.0 iteration phase. Under semver, `0.x.y` minor bumps may include
breaking changes while the public surface matures. Breaking 0.x minor
bumps still require migration notes in `CHANGELOG.md`.

Alignment with `@nimiplatform/sdk` is directional until SDK reaches
`1.0.0`. At that future event, kit must make an explicit `1.0.0`
readiness decision; kit does not automatically claim stable-release
semantics before then.

| Bump | Trigger |
|---|---|
| Patch | Compatible fix only, no public API change |
| Minor | New export, compatible type widening, or breaking change during 0.x |
| Major | Explicit 1.0.0 readiness decision, or post-1.0 breaking change |

Semver classification rules are documented in detail in `kit/AGENTS.md`
under "Semver Discipline".

## Reuse First

Before building app-local UI, shell glue, auth flows, telemetry, model
configuration, chat, avatar, generation, commerce, or runtime-bound
adapter code, check this README, the target module README, and
`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`. Reuse an
existing `@nimiplatform/kit` export when it covers the baseline behavior;
extend the kit surface first when the missing behavior is cross-app.

## v0.1.0 Initial Public Surface

v0.1.0 publishes 58 public subpath exports for the initial public
surface:

- 11 UI entries (`./ui`, `./ui/glass`, `./ui/motion`, `./ui/a11y`,
  `./ui/styles.css`, and six `./ui/themes/*` files)
- 3 auth entries (`./auth`, `./auth/styles.css`, `./auth/native-oauth-result-page`)
- 6 core entries (`./core/shell-mode`, `./core/oauth`,
  `./core/runtime-capabilities`, `./core/model-config`,
  `./core/character-card`, `./core/sdk-contract`)
- 2 renderer-shell entries (`./shell/renderer/bridge`,
  `./shell/renderer/bootstrap`)
- 2 telemetry entries (`./telemetry`, `./telemetry/error-boundary`)
- 34 feature entries across `./features/chat`, `./features/avatar`,
  `./features/model-picker`, `./features/model-config`,
  `./features/generation`, and `./features/commerce`

The complete inventory is enumerated in
`.nimi/topics/ongoing/2026-05-23-nimi-kit-component-library-standardization/kit-public-surface-inventory.yaml`.

## Import Patterns by Sub-module

### UI primitives

```ts
import { Button, IconButton, cn } from '@nimiplatform/kit/ui';
import { GlassSurface, glassMaterial } from '@nimiplatform/kit/ui/glass';
import { usePrefersReducedMotion, MOTION_TIMING } from '@nimiplatform/kit/ui/motion';
import { FOCUS_RING_CLASS_NAME, VisuallyHidden } from '@nimiplatform/kit/ui/a11y';
```

### Themes

```css
@import '@nimiplatform/kit/ui/styles.css';
@import '@nimiplatform/kit/ui/themes/light.css';
/* swap or layer accent themes */
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
```

Available themes: `light`, `dark`, and `nimi-accent`. Theme tokens are
projected from `.nimi/spec/platform/kernel/tables/nimi-ui-themes.yaml`.

### Auth

```ts
import { useAuthFlow, AuthEmailFlow } from '@nimiplatform/kit/auth';
import '@nimiplatform/kit/auth/styles.css';
```

### Core

```ts
import { ShellMode } from '@nimiplatform/kit/core/shell-mode';
import { OAuthShellContract } from '@nimiplatform/kit/core/oauth';
import { classifyCapability } from '@nimiplatform/kit/core/runtime-capabilities';
import { parseCharacterCard } from '@nimiplatform/kit/core/character-card';
```

`./core/*` modules are React-free and renderer/runtime-safe.

### Renderer shell

```ts
import { invokeTauri } from '@nimiplatform/kit/shell/renderer/bridge';
import { bootstrapAuthSession } from '@nimiplatform/kit/shell/renderer/bootstrap';
```

### Tauri shell crate

```rust
use nimi_shell_tauri::platform_catalog::ai_profile_factory;
use nimi_shell_tauri::platform_catalog::nimi_app_registry;
use nimi_shell_tauri::platform_projection::apps_bridge;
use nimi_shell_tauri::platform_projection::apps_packages;
use nimi_shell_tauri::platform_projection::apps_registry;
use nimi_shell_tauri::platform_projection::factory_profile_index;
```

### Telemetry

```ts
import { emitTelemetry, traceSession } from '@nimiplatform/kit/telemetry';
import { ShellErrorBoundary } from '@nimiplatform/kit/telemetry/error-boundary';
```

### Features

```ts
import { useRuntimeChatSession } from '@nimiplatform/kit/features/chat/runtime';
import { useRealmChatComposer } from '@nimiplatform/kit/features/chat/realm';
import { CanonicalConversationShell } from '@nimiplatform/kit/features/chat/components/canonical-conversation-shell';
import { AvatarStage } from '@nimiplatform/kit/features/avatar';
import { RuntimeModelPickerPanel } from '@nimiplatform/kit/features/model-picker/ui';
import { useRuntimeGenerationPanel } from '@nimiplatform/kit/features/generation/runtime';
import { useRealmSendGiftDialog } from '@nimiplatform/kit/features/commerce/realm';
import { ModelConfigPanel } from '@nimiplatform/kit/features/model-config/ui';
```

Each feature exposes the four-surface taxonomy where applicable:

- `headless`: logic, state, adapter contracts (no UI)
- `ui`: opinionated React surfaces built on kit primitives
- `runtime`: bindings to the local AI / runtime engine
- `realm`: bindings to the logged-in platform business services

## SDK Contract Boundary

Every kit consumption of `@nimiplatform/sdk*` routes through one file:
`./core/sdk-contract`. If you need an SDK type or value inside kit code,
import it from `@nimiplatform/kit/core/sdk-contract` (kit-internal)
rather than `@nimiplatform/sdk`. App consumers should continue importing
directly from `@nimiplatform/sdk` — the single-boundary rule applies
inside kit only.

Why: when the upstream SDK reshapes a type, the breakage surfaces as a
compile-time error in one file, not deep in feature code. The file also
documents the admitted dynamic-import escape hatch used by
`kit/features/chat/src/runtime/orchestration.ts`.

## Accessibility

`@nimiplatform/kit/ui/a11y` ships the kit's accessibility primitives:

- `FOCUS_RING_CLASS_NAME` is applied to `Button` and `IconButton` by
  default, providing a keyboard-visible focus ring that meets WCAG 2.1
  AA contrast.
- `VisuallyHidden` hides content from sighted users while keeping it
  available to assistive tech.
- `useFocusTrap` enforces modal focus containment.

`@nimiplatform/kit/ui/motion` ships:

- `usePrefersReducedMotion()` — SSR-safe hook that respects
  `prefers-reduced-motion: reduce`.
- `MOTION_TIMING` — canonical duration/easing tokens.

Authors building new animations MUST gate non-essential motion behind
`usePrefersReducedMotion()`.

## Theming Integration

The kit ships base styles plus theme overlays. Apply exactly one
**base theme** (`light.css` or `dark.css`) and optionally the Nimi **accent
overlay** (`nimi-accent.css`). Themes set CSS
custom properties that kit primitives consume; do not override the
property names — extend by adding scoped overlays.

## Contributing

See `kit/AGENTS.md` for module boundaries, semver discipline, counting
vocabulary for SDK-coupling audits, and verification commands.

## Verification

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```
