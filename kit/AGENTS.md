# AGENTS.md — nimi-kit

## Scope
- Applies to `kit/**`.
- `@nimiplatform/nimi-kit` is the root cross-app shared toolkit package.

## Hard Boundaries
- `ui` is the design authority for shared tokens, primitives, themes, and generated visual contracts.
- `auth` is a feature module and may contain UI, hooks, logic, storage, adapters, and CSS, but must not bypass `ui` token authority.
- `core` is pure logic only: no UI dependencies, no CSS imports, no app-layer imports.
- `telemetry` is renderer-side infrastructure and must remain renderer-safe.
- Kit code must not import app-layer code from `apps/**` or runtime internals from `runtime/internal/**`.
- Apps must consume shared kit functionality through `@nimiplatform/nimi-kit/*`.

## Retrieval Defaults
- Start in `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `spec/platform/kernel`, and `scripts/check-nimi-kit.mjs`.
- Skip generated output except when validating token/theme drift under `kit/ui/src/generated/**`.

## Verification Commands
- `pnpm --filter @nimiplatform/nimi-kit build`
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit`
