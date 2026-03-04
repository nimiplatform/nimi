# Desktop AGENTS.md

> Conventions for AI agents working on `nimi/apps/desktop` (Tauri + React).

## Context

`nimi/apps/desktop` is the first-party Nimi application. It is architecturally a regular nimi-app with no special platform privileges — it accesses realm and runtime through the same SDK as third-party apps.

Its unique role is hosting the mod ecosystem (nimi-hook) and providing the Core UI.

## Project Structure

```
apps/desktop/
├── src/
│   ├── shell/
│   │   └── renderer/        React UI
│   │       ├── app-shell/   Layout, routing, navigation
│   │       ├── features/    Feature modules (see below)
│   │       ├── components/  Shared UI components
│   │       ├── hooks/       React hooks
│   │       ├── stores/      Zustand stores
│   │       ├── services/    API service layer
│   │       ├── utils/       Utilities
│   │       └── assets/      Static assets
│   ├── runtime/             Runtime integration layer
│   ├── mods/                Mod system (hook, sandbox, governance)
│   └── types/               Type definitions
├── src-tauri/               Tauri Rust backend
│   ├── src/                 Rust source
│   ├── capabilities/        Tauri capability declarations
│   └── resources/           Default mod manifests
├── scripts/                 Build and config scripts
└── package.json             @nimiplatform/desktop
```

### Feature Modules

```
features/
├── agent-detail/     Agent profile and management
├── auth/             Login and authentication
├── chats/            Chat interface
├── contacts/         Contact list
├── economy/          Gifts, assets, transactions
├── explore/          Discovery and explore feed
├── home/             Home feed
├── marketplace/      App store / mod circle browser
├── mod-workspace/    Mod panel rendering
├── notification/     Notification center
├── profile/          User profile
├── runtime-config/   Runtime settings and provider config
├── settings/         App settings
├── turns/            Conversation turns and play protocol
└── world-detail/     World detail and management
```

## Tech Stack

- **Framework:** Tauri 2.x (Rust backend + Web frontend)
- **UI:** React 19 + React Router 7 + Tailwind CSS 4
- **State:** Zustand 5
- **Data Fetching:** TanStack Query 5
- **Validation:** Zod 4
- **Real-time:** Socket.IO Client
- **3D:** Three.js (for world visualization)
- **i18n:** i18next (Chinese primary)
- **AI:** Vercel AI SDK v6

## Coding Conventions

- **ESM imports** with `.js` extension for `.ts` files
- **Zustand** for global state (not Redux, not Context)
- **TanStack Query** for all server state
- **Zod `safeParse`** for runtime validation
- **No `console.log`** — use structured logging
- Features are self-contained modules under `features/`
- Shared components go in `components/`, not duplicated across features
- Path aliases: `@renderer/*`, `@runtime/*`, `@types/*`

## AI Retrieval Defaults

- Default code search SHOULD focus on `src/` and `src-tauri/src/`
- Default retrieval SHOULD skip generated/lock/asset noise (`src-tauri/gen/**`, `**/generated/**`, `**/gen/**`, `Cargo.lock`, binary image assets)
- If debugging requires generated/schema artifacts, agents MUST declare the exception before reading those files

## Platform Access Rules

**MUST:**
- All realm access goes through `@nimiplatform/sdk/realm`
- All runtime access goes through `@nimiplatform/sdk/runtime`
- Desktop uses the same SDK APIs as third-party apps

**MUST NOT:**
- No direct HTTP calls to realm backend
- No direct gRPC calls bypassing SDK
- No runtime internal package imports
- No special "first-party" API shortcuts

## Architecture: Thin Presentation Layer

Desktop is a **presentation layer**. It renders data from runtime (via SDK) and realm (via SDK). It does NOT own domain data or business logic.

**When a feature is broken or data is missing, trace the data flow before writing any fix:**

```
runtime (owns data/logic) → SDK (surfaces API) → desktop (renders UI)
```

Fix at the source layer. For example: if TTS connectors don't return TTS models, the fix belongs in the runtime model catalog or SDK connector capability surface — NOT in desktop by hardcoding a TTS model list.

**Forbidden in desktop:**
- Hardcoding model lists, provider capabilities, supported modalities, or feature gates that should come from runtime/SDK
- Duplicating runtime logic (health evaluation, model filtering, provider routing, capability detection)
- Working around a runtime/SDK data gap with a desktop-only shim — fix the upstream layer instead

**Allowed in desktop:**
- UI-only constants (layout, animation, color tokens)
- Presentation transforms (formatting, truncating, display sorting)
- Local UI state (panel open/closed, selected tab, scroll position)
- Mapping SDK response data to UI view-models (but not inventing data the SDK doesn't provide)

## Test Placement

Tests live in `apps/desktop/test/` as flat test files. Test file names describe the feature under test (e.g., `runtime-daemon-state.test.ts`, `runtime-bridge-config.test.ts`). Tests import from `../src/` using relative paths.

## nimi-hook (Mod Host)

Desktop hosts the mod ecosystem through 5 hook subsystems:

| Subsystem | Path | Purpose |
|-----------|------|---------|
| event-bus | `src/mods/hook/event-bus/` | Pub/sub events |
| data-api | `src/mods/hook/data-api/` | Data registration and query |
| ui-extension | `src/mods/hook/ui-extension/` | UI slot registration |
| turn-hook | `src/mods/hook/turn-hook/` | Conversation pipeline intercept |
| inter-mod | `src/mods/hook/inter-mod/` | Cross-mod messaging |

Hook internals call SDK to access platform capabilities. Mods never call SDK directly.

## Governance Chain

Mods go through 8 stages:
discovery → manifest → signature → dependency → sandbox → load → lifecycle → audit

This is managed in `src/mods/execution-kernel/`.

## Build & Development

```bash
# Development
pnpm dev:shell        # Full Tauri dev mode
pnpm dev:renderer     # Vite renderer only (fast iteration)
pnpm dev:cli          # CLI mode

# Build
pnpm build            # Full production build with mods
```

## Web Adapter

`/apps/web/` reuses desktop renderer via path aliases but removes desktop-only runtime/mod paths. Web-specific adapters are in `apps/web/src/desktop-adapter/`.

## What NOT to Do

- Don't bypass SDK to call realm/runtime directly
- Don't put platform logic in desktop — it belongs in runtime or realm
- Don't hardcode domain data (model lists, provider capabilities, modality support) — if the data isn't available from SDK, the fix belongs upstream
- Don't add hook capabilities that leak outside desktop
- Don't modify `src-tauri/` Rust code without understanding Tauri security model
- Don't import from `apps/web/` — dependency flows the other direction
