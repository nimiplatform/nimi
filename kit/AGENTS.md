# AGENTS.md — nimi-kit
## Scope
- Applies to `kit/**`.
- `@nimiplatform/nimi-kit` is the single cross-app toolkit package.
- Modules: `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/features/chat`, `kit/features/model-picker`, `kit/features/generation`, `kit/features/commerce`.
## Hard Boundaries
- `ui` is the design authority; `auth` and `kit/features/*` must not bypass it.
- `kit/core` must not import React, CSS, app code, or presentation modules.
- `kit/telemetry` must remain renderer-safe and must not import Node.js, Electron, or Tauri bridges.
- `kit/features/*` must not import `apps/**`, `runtime/internal/**`, app aliases, `dataSync`, app stores, or navigation directly.
- SDK typed services may only be bound from explicit `runtime` or `realm` feature surfaces.
- Runtime integrations must not bind realm clients; realm integrations must not bind runtime clients.
- Apps must consume shared kit functionality through `@nimiplatform/nimi-kit/*` and must not recreate the same baseline shell locally once the kit surface exists.
## Retrieval Defaults
- Start in `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/features/*`, `spec/platform/kernel`, and `scripts/check-nimi-kit.mjs`.
- Skip generated output except for token/theme drift and generated platform docs.
## Verification Commands
- `pnpm --filter @nimiplatform/nimi-kit build && pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit && pnpm check:platform-spec-kernel-consistency && pnpm check:platform-spec-kernel-docs-drift`
