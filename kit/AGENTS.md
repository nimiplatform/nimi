# AGENTS.md — nimi-kit
## Scope
- Applies to `kit/**`.
- `@nimiplatform/nimi-kit` is the single cross-app toolkit package.
- Modules: `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/shell/tauri` (Rust crate), `kit/shell/renderer`, `kit/features/chat`, `kit/features/model-picker`, `kit/features/model-config`, `kit/features/generation`, `kit/features/commerce`.
## Hard Boundaries
- `ui` is the design authority; `auth` and `kit/features/*` must not bypass it.
- Before building new app UI or interaction logic, inspect `kit/README.md`, the target module README, and `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml` to confirm whether a reusable kit surface already exists.
- `kit/core` must not import React, CSS, app code, or presentation modules.
- `kit/telemetry` must remain renderer-safe and must not import Node.js, Electron, or Tauri bridges.
- `kit/shell/tauri` is a Rust crate for shared Tauri host glue; it must not import JS/TS runtime code or app-local Rust.
- `kit/shell/renderer` is renderer shell glue; it must not contain app stores, navigation, UI rendering, or re-own auth/telemetry truth.
- `kit/core` runtime-capabilities sub-surface must be pure logic (runtime-safe + renderer-safe); no UI, CSS, or shell imports.
- `kit/features/*` must not import `apps/**`, `runtime/internal/**`, app aliases, `dataSync`, app stores, or navigation directly.
- SDK typed services may only be bound from explicit `runtime` or `realm` feature surfaces.
- Runtime integrations must not bind realm clients; realm integrations must not bind runtime clients.
- Apps must consume shared kit functionality through `@nimiplatform/nimi-kit/*` and must not recreate the same baseline shell locally once the kit surface exists.
## Retrieval Defaults
- Start in `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/features/*`, `.nimi/spec/platform/kernel`, and `scripts/check-nimi-kit.mjs`.
- Skip generated output except for token/theme drift and generated platform docs.
## Verification Commands
- `pnpm --filter @nimiplatform/nimi-kit build && pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit && pnpm exec nimicoding validate-spec-governance --profile nimi --scope platform-consistency && pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope platform --check`
