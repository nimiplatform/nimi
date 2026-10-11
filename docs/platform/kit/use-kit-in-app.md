# Use Kit in an App

Use `@nimiplatform/kit` when an application needs shared Nimi UI components, authentication surfaces, Shell host integration glue, telemetry, AI capability configuration, or reusable feature surfaces.

Application code should import Kit exclusively through public subpaths declared in `kit/package.json`; never import internal source modules directly (e.g. `kit/**/src`), and avoid re-implementing capabilities that Kit already provides.

## Installation and Dependencies

Applications scaffolded via official templates already include Kit dependencies. To add Kit to an existing project alongside the SDK:

```bash
pnpm add @nimiplatform/kit @nimiplatform/sdk
```

Kit is built atop React 19. `react-dom`, `react-i18next`, and `electron` are peer dependencies used on demand by specific subpaths.

## Public Import Subpaths

| Requirement | Import Path |
| --- | --- |
| Shared UI primitives, themes, accessibility, motion | `@nimiplatform/kit/ui`, `@nimiplatform/kit/ui/a11y`, `@nimiplatform/kit/ui/motion`, and designated theme CSS files |
| Runtime account login and auth UI | `@nimiplatform/kit/auth` |
| Pure logic and capability utilities | Specific `@nimiplatform/kit/core/...` subpaths |
| Standard shell renderer bridge & bootstrap | `@nimiplatform/kit/shell/renderer/bridge`, `@nimiplatform/kit/shell/renderer/bootstrap` |
| Electron host process bridge | `@nimiplatform/kit/shell/electron/main`, `@nimiplatform/kit/shell/electron/preload` |
| Telemetry and React error boundaries | `@nimiplatform/kit/telemetry`, `@nimiplatform/kit/telemetry/error-boundary` |
| Agent Center, chat, avatar, generation, and commerce surfaces | Specific `@nimiplatform/kit/features/...` subpaths |

Kit does not expose wildcard exports; the authoritative list of public entry points is defined in `kit/package.json` under `exports`.

## UI Components and Themes

Import standard UI primitives in your React components:

```ts
import { Button, IconButton, Dialog, cn } from '@nimiplatform/kit/ui';
import { VISUALLY_HIDDEN_CLASS_NAME, VISUALLY_HIDDEN_STYLE } from '@nimiplatform/kit/ui/a11y';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
```

Import theme stylesheets in your application entry point:

```css
@import '@nimiplatform/kit/ui/styles.css';
@import '@nimiplatform/kit/ui/themes/light.css';
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
```

Apply one foundational base theme (`light.css` or `dark.css`) and overlay your application's accent package as needed. Do not redefine Kit's global `--nimi-*` CSS variables in application stylesheets.

## Shell Integration and Authentication

In renderer code, use renderer-safe Shell exports:

```ts
import {
  createNimiLocalAppStandardShellSurface,
  installNimiShellRuntimeBridge,
} from '@nimiplatform/kit/shell/renderer/bridge';
import { createRendererEntryModuleLoader } from '@nimiplatform/kit/shell/renderer/bootstrap';
```

The renderer bootstrap calls `installNimiShellRuntimeBridge()` once. `createNimiLocalAppStandardShellSurface()` provides the standard Shell implementation for the host-bound SDK client created via `createNimiClient({ localApp: { standardShell } })`. Lower-level helpers like `invokeShell` and `invokeTauri` are host-level integration glue and should not be invoked by daily business logic.

In Electron main and preload scripts, use dedicated exports:

```ts
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload';
```

Never import Electron host modules into renderer code, and never bypass the Shell bridge to invoke internal Runtime private APIs.

## AI Capability Configuration

Applications can render AI settings out of the box using standard model-config components:

```ts
import { ModelConfigAIConfigSurface } from '@nimiplatform/kit/features/model-config';
```

The standard configuration panel binds `client.aiConfig.get()`, `client.aiConfig.listOptions(query)`, and `client.aiConfig.overwrite(input)`:

- **Local capabilities**: Saves route markers and adheres to the host machine's selected Loadout for that capability.
- **Cloud capabilities**: Allows selecting an authorized connector and target model, persisting exact `connectorRef`, `implementation`, and `providerModelTarget` settings in AIConfig.
- **Clear boundaries**: These are persistent configuration preferences, not runtime execution overrides; Runtime validates and snapshots settings upon submission, while capability readiness and inference execution remain independent assessments. See [AI Config](/sdk/ai-config-surface).

Agent Center surfaces equivalent configuration controls via `AgentCenterAIConfigSection` from `@nimiplatform/kit/features/agent-center/ui`.

## Reuse and Integration Guidelines

- Check Kit before hand-coding local UI primitives, auth dialogs, shell adapters, AI configuration panels, or chat windows.
- Rely strictly on public subpaths. If a needed capability exists only inside `kit/**/src`, export it officially from Kit first.
- Keep application-specific layouts, copy, and product logic inside the application.
- Keep execution semantics within Runtime and SDK calls.

## Verification

In the monorepo root:

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```

In an independent application repository:

```bash
pnpm run check
pnpm run test
```

## Source Basis

- [`kit/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/README.md)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`.nimi/spec/platform/ui-design-system.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ui-design-system.authority.yaml)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
