# AGENTS.md - nimi-kit
## Scope
- Applies to `kit/**`.
- `@nimiplatform/kit` is the single cross-app toolkit package.
- Active modules: `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/shell/tauri`, `kit/shell/renderer`, and `kit/features`.
## Hard Boundaries
- Kit UI is a reusable projection of `.nimi/spec/platform/kernel`; do not create app-local design truth in `kit/auth` or `kit/features`.
- Before adding UI or interaction logic, inspect `kit/README.md`, the target module README, and `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`.
- `kit/core` must stay pure logic: no React, CSS, app code, or presentation imports.
- `kit/telemetry` must stay renderer-safe: no Node.js, Electron, or Tauri bridge imports.
- `kit/shell/tauri` is shared Rust host glue; do not import JS/TS runtime code or app-local Rust.
- `kit/shell/renderer` is renderer glue only; it must not own app stores, navigation, UI rendering, auth truth, or telemetry truth.
- `kit/features/*` must not import `apps/**`, `runtime/internal/**`, app aliases, `dataSync`, app stores, or navigation directly.
- `kit/features/avatar` is the admitted reusable avatar surface. Backend-specific renderer seams such as VRM and Live2D own reusable renderer semantics only; launched Avatar product authority stays in `.nimi/spec/avatar/**`, and app-specific placement/orchestration stays app-owned.
- SDK typed services may only bind from explicit `runtime` or `realm` feature surfaces; runtime integrations must not bind realm clients, realm integrations must not bind runtime clients, and apps consume toolkit functionality through `@nimiplatform/kit/*` once it exists.
## Retrieval Defaults
- Start in `kit/ui`, `kit/auth`, `kit/core`, `kit/telemetry`, `kit/features`, `.nimi/spec/platform/kernel`, and `scripts/check-nimi-kit.mjs`.
- Skip generated output except token/theme drift and generated platform docs.
## Verification Commands
- `pnpm --filter @nimiplatform/kit build && pnpm --filter @nimiplatform/kit test`; `pnpm check:nimi-kit && pnpm exec nimicoding validate-spec-governance --profile nimi --scope platform-consistency && pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope platform --check`
## Semver Discipline
- Public exports are governed by `kit/package.json`; classify every public export change before merge.
- Patch: compatible fixes only. Minor: new export, widening, or 0.x breaking change. Major: explicit 1.0.0 or post-1.0 breaking change.
- Every breaking 0.x minor needs a migration note in `kit/CHANGELOG.md`; experimental exports still need documented changes.
- `@nimiplatform/kit` tracks `@nimiplatform/sdk` compatibility during 0.x, but kit 1.0.0 requires an explicit readiness decision.
## Cross-Feature And SDK Edges
- Cross-feature imports must be declared as `kit.features.*` dependencies in `.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`; `pnpm check:kit-feature-edge-boundary` enforces that actual feature imports stay inside the registry graph.
- All static `@nimiplatform/sdk*` imports in kit non-test code route through `kit/core/src/sdk-contract.ts`.
- The admitted dynamic SDK boundary is the chat app-AI runtime adapter importing `@nimiplatform/kit/core/sdk-contract`; new SDK consumption adds a re-export to `kit/core/src/sdk-contract.ts`.
