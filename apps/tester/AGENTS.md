# AGENTS.md
- Treat `.nimi/app-scaffold/intent.json` and `.nimi/app-scaffold/lock.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections created by `pnpm run init`.
- Keep auth, Runtime, permission, manifest, and Tauri shell glue in scaffold-managed files.
- The app-owned area is `src/shell/routes/product-area.tsx`, `src/tester/**`, app-owned tester Tauri modules under `src-tauri/src/{tester_storage.rs,world_tour.rs}`, and tester contract tests.
- `.nimi/admission/**` and `ADMISSION.md` are developer-submitted review inputs, not platform admission truth.
- Local checks are pre-submission self-checks only.

## Core Boundary Model

New app code must follow the platform ownership chain:

`Runtime / Realm truth -> @nimiplatform/sdk interface -> app consumer`

The app may compose product UI and app-specific workflows, but it must not create
a second source of truth for platform-owned data, execution state, permissions,
identity, model routing, memory, or admission.

## What Goes Where

### Runtime

Use Runtime for local execution and runtime-owned capability truth:

- AI/model execution, local model catalog, readiness, route selection, warm state, and runtime config.
- Runtime Agent execution, agent turn/session projection, runtime cognition/memory, and future Runtime-owned External Agent action plane.
- Local capability facts that require Runtime authority, validation, audit, or fail-closed semantics.

Do not reimplement Runtime facts in the app with local stores, ad hoc provider/model constants, local HTTP bypasses, or direct private endpoints.

### Realm

Use Realm for cloud canonical business truth:

- Account/profile identity, relationship/social truth, backend-owned entities, cloud persistence, entitlement-like product data, and server-audited state.
- Any data that must be shared across devices, users, or backend workflows.

Do not keep a parallel app-local database that claims to be the canonical copy of Realm-owned data.

### `@nimiplatform/sdk`

Use SDK as the only app-facing interface layer for Runtime and Realm:

- Typed clients, method IDs, request/response schemas, projections, pagination, and platform error/reason-code handling.
- SDK may aggregate typed projections, but it must not become a hidden truth owner.

Do not call Runtime/Realm private REST endpoints directly from app code when a SDK projection exists or should exist.

### `@nimiplatform/kit`

Use Kit for reusable UI and headless product primitives:

- Shared controls, layout primitives, chat/panel/headless composition helpers, accessibility behavior, tokens, and platform-aligned interaction patterns.
- Prefer Kit primitives before creating local components for common platform UI.

Do not fork Kit behavior into app-local copies unless the app has a genuinely product-specific interaction that Kit does not cover.

### `nimi-shell-tauri`

Use `nimi-shell-tauri` / scaffold-managed Tauri glue only for shell and OS integration:

- Window lifecycle, file picker/reveal, clipboard, drag/drop, native dialogs, shell-safe local handles, and app-owned OS helpers.
- Tauri commands must be bounded, app-specific, and unable to become platform truth.

Do not implement Runtime/Realm authority, permission grants, app admission, model routing, token custody, or canonical transcript/history truth in Tauri.

### Kit UI Glass Style

Use Nimi Kit UI tokens and glass style for product surfaces unless the app has an admitted product-specific visual system:

- Prefer Kit surfaces, buttons, inputs, overlays, navigation, focus rings, spacing, typography, and glass tokens.
- Keep local CSS limited to app-specific layout and content treatment.

Do not recreate one-off glass cards, shadows, gradients, or control styling when Kit already provides the pattern.

## App-Owned Scope

The app owns product-specific screens, user intent wiring, view-model projection, ephemeral UI state, and product-specific data that is not Runtime-owned or Realm-owned.

Before adding any durable local store, new Tauri command, private endpoint call, or platform-like registry, decide and document why the data is app-owned rather than Runtime/Realm-owned.

## Boundary Checklist

- Durable canonical data? Use Realm or Runtime, then consume through SDK.
- Execution/capability/readiness/model/memory truth? Use Runtime through SDK.
- Backend business object or relationship/account truth? Use Realm through SDK.
- Shared UI, layout, chat shell, controls, or glass styling? Use Kit.
- OS helper or native shell action? Use scaffold-managed Tauri / `nimi-shell-tauri`.
- Unsure who owns it? Stop and write an authority note before implementing.

## Forbidden Shortcuts

- No app-level REST bypass around SDK.
- No duplicate auth/session/permission/admission truth.
- No local canonical mirror of Runtime/Realm data.
- No provider/model hardcoding as product truth.
- No compatibility dual-write or pseudo-success state.
- No importing Runtime internals, generated private clients, or Desktop product source.
