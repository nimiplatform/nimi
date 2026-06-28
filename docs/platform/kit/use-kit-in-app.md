# Use Kit In An App

Use `@nimiplatform/kit` when an app needs shared Nimi UI, auth, shell glue,
telemetry, model configuration, or reusable feature surfaces. App code should
import Kit through public subpaths from `kit/package.json`; it should not import
from `kit/**/src` or duplicate a Kit-owned capability locally.

## Install

Generated Nimi App scaffolds already depend on Kit. In a standalone app that
does not, install Kit next to the SDK:

```bash
pnpm add @nimiplatform/kit @nimiplatform/sdk
```

Kit requires React 19. `react-dom`, `react-i18next`, and `electron` are peer
dependencies used by specific subpaths.

## Public Import Groups

| Need | Import from |
| --- | --- |
| Shared UI primitives, themes, accessibility, motion | `@nimiplatform/kit/ui`, `@nimiplatform/kit/ui/a11y`, `@nimiplatform/kit/ui/motion`, listed theme CSS exports |
| Runtime account login and auth UI | `@nimiplatform/kit/auth` |
| Pure logic helpers | Enumerated `@nimiplatform/kit/core/...` subpaths |
| Standard shell renderer bridge | `@nimiplatform/kit/shell/renderer/bridge`, `@nimiplatform/kit/shell/renderer/bootstrap` |
| Electron host bridge | `@nimiplatform/kit/shell/electron/main`, `@nimiplatform/kit/shell/electron/preload` |
| Telemetry and error boundaries | `@nimiplatform/kit/telemetry`, `@nimiplatform/kit/telemetry/error-boundary` |
| Chat, avatar, model picker, model config, generation, commerce | Enumerated `@nimiplatform/kit/features/...` subpaths |

Kit does not publish wildcard subpaths. The complete public import list is the
`exports` object in `kit/package.json`.

## UI And Themes

```ts
import { Button, IconButton, Dialog, cn } from '@nimiplatform/kit/ui';
import { VISUALLY_HIDDEN_CLASS_NAME, VISUALLY_HIDDEN_STYLE } from '@nimiplatform/kit/ui/a11y';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
```

```css
@import '@nimiplatform/kit/ui/styles.css';
@import '@nimiplatform/kit/ui/themes/light.css';
@import '@nimiplatform/kit/ui/themes/nimi-accent.css';
```

Apply one base theme (`light.css` or `dark.css`) and optionally the Nimi accent
overlay. Do not redefine Kit token names in app CSS.

## Shell And Auth

Renderer app code uses renderer-safe shell exports:

```ts
import { invokeTauri } from '@nimiplatform/kit/shell/renderer/bridge';
import { resolveBootstrapAuthSession } from '@nimiplatform/kit/shell/renderer/bootstrap';
```

Electron main/preload code uses Electron-only exports:

```ts
import { createElectronRuntimeBridgeCommandNames } from '@nimiplatform/kit/shell/electron/main';
import { installNimiElectronRuntimeBridge } from '@nimiplatform/kit/shell/electron/preload';
```

Do not import Electron host modules from renderer app code. Do not call Runtime
private APIs from shell code; the shell bridge preserves the SDK and standard
capability boundary.

## AI Model Configuration

For model selection and AIConfig editing, start with the Kit model-config
feature:

```ts
import { ModelConfigAiModelHub } from '@nimiplatform/kit/features/model-config/ui';
import { useModelConfigProfileController } from '@nimiplatform/kit/features/model-config/headless';
import { createNimiAIConfigStore, createNimiAppAIScopeRef } from '@nimiplatform/sdk/ai';
```

The app owns the `AppModelConfigSurface`: scope ref, AIConfig service,
provider resolver, projection resolver, local asset source, user profile
source, and i18n. The SDK owns AIConfig stores and scope refs. Kit owns the
reusable UI, headless contracts, and profile controller helpers. Runtime owns
readiness and execution evidence.

## Reuse Rules

- Check Kit before writing app-local UI primitives, auth flows, shell glue,
  telemetry, model config, chat shell, avatar stage, generation panels, or
  commerce surfaces.
- Use only public subpath exports. If a required shared behavior exists only in
  `kit/**/src`, it needs a Kit export before apps consume it.
- Keep app-specific layout and product workflows in the app.
- Keep Runtime execution semantics in Runtime and SDK calls.

## Verification

For this repository:

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```

For generated app repositories:

```bash
pnpm run validate
pnpm run doctor
```

## Source Basis

- [`kit/README.md`](https://github.com/nimiplatform/nimi/blob/main/kit/README.md)
- [`kit/package.json`](https://github.com/nimiplatform/nimi/blob/main/kit/package.json)
- [`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml)
- [`apps/tester/src/tester/tester-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-ai-config-store.ts)
