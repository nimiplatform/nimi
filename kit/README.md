# Nimi Kit

`@nimiplatform/nimi-kit` is the product-grade cross-app toolkit for Nimi apps. It packages shared foundations, reusable feature modules, and first-party integration seams so Nimi-coding consumers do not need to rebuild baseline styling, interaction shells, or platform wiring.

## What It Is
- The single authoritative package for cross-app shared UI, auth, logic, telemetry, and feature modules.
- A single package with subpath exports such as `@nimiplatform/nimi-kit/ui` and `@nimiplatform/nimi-kit/features/chat/runtime`.
- The home for reusable Nimi-coding surfaces, not app-local implementations.

## Layer Model
```text
@nimiplatform/nimi-kit
├── foundation
│   ├── ui
│   ├── core
│   └── telemetry
├── auth
└── features
    ├── chat
    ├── model-picker
    ├── generation
    └── commerce
```

- Foundation modules:
  - `ui`: design authority, tokens, primitives, themes, generated contracts.
  - `core`: pure logic and shell/runtime capability helpers.
  - `telemetry`: renderer-safe telemetry and error boundary primitives.
- Top-level capability module:
  - `auth`: shared authentication flows and auth-facing UI.
- Feature modules:
  - `features/chat`: AI chat and human chat surfaces.
  - `features/model-picker`: model browse/select surfaces.
  - `features/generation`: runtime generation workflow shells.
  - `features/commerce`: gifting and lightweight transactional surfaces.

## Surface Taxonomy
- `headless`: logic, state, and adapter contracts without UI.
- `ui`: default opinionated UI shell built on kit primitives.
- `runtime`: integration with local AI/runtime engine or runtime control plane only.
- `realm`: integration with logged-in platform business or social services only.

## Recommended Imports
```ts
import { Button } from '@nimiplatform/nimi-kit/ui';
import { ChatComposer, RuntimeChatPanel } from '@nimiplatform/nimi-kit/features/chat/ui';
import { useRuntimeChatSession } from '@nimiplatform/nimi-kit/features/chat/runtime';
import { useRealmChatComposer, useRealmMessageTimeline } from '@nimiplatform/nimi-kit/features/chat/realm';
import { RuntimeModelPickerPanel } from '@nimiplatform/nimi-kit/features/model-picker/ui';
import { useRuntimeGenerationPanel } from '@nimiplatform/nimi-kit/features/generation/runtime';
import { useRealmSendGiftDialog, useRealmGiftInbox } from '@nimiplatform/nimi-kit/features/commerce/realm';
```

## Reuse First
- Start with `@nimiplatform/nimi-kit/ui` to confirm whether the shared design authority already covers the needed primitive or shell.
- Check `@nimiplatform/nimi-kit/auth` next for login, session, callback, or auth-window flows.
- Check the relevant `kit/features/*` README and registry entry before building app-local interaction logic.
- Only build app-local UI or interaction shells when kit has no matching surface, or when the remaining requirement is clearly app-specific.
- If a new app-local shell is likely reusable across at least two apps, treat it as a future `nimi-kit` admission candidate instead of a permanent app-local pattern.

## What Stays Outside
- App stores, app navigation, and app-owned side effects remain in `apps/**`.
- Runtime internals remain in `runtime/internal/**`.
- Socket construction, query clients, notification side effects, artifact persistence, and avatar/profile shells remain app-local unless reused by at least two apps and explicitly admitted into kit.
- Feature-specific admin overlays and back-office flows stay app-local unless already proven cross-app.

## Current Consumers
- `desktop`: foundation modules plus `chat`, `model-picker`, `generation`, and `commerce`.
- `relay`: foundation modules plus `chat` and `model-picker`.
- `forge`: foundation modules plus `chat`.
- `overtone`: foundation modules plus `generation`.
- `realm-drift`: foundation modules plus `chat`.
- `web`: foundation modules and auth/runtime bootstrap seams.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit`
