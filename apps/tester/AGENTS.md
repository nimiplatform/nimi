# AGENTS.md

## Scope
- Applies to `apps/tester/**`; treat `.nimi/app-scaffold/{intent,lock}.json` as app-scaffold intent and lock state.
- Treat `.nimi/{config,contracts,methodology}/**` as `@nimiplatform/nimi-coding` managed projections; keep auth, Runtime, permission, manifest, and shell glue in scaffold-managed files.
- The app-owned area is `src/shell/routes/product-area.tsx`, `src/tester/**`, `src-tauri/src/world_tour.rs`, `src-electron/**`, and tester contract tests.

## Hard Boundaries
- Consume Runtime and Realm only through SDK and reusable UI through Kit; do not create app-local platform truth, private transport, provider/model constants, or admission truth.
- Do not add app-local persistence commands or modules; history, export, artifacts, and storage use admitted Kit shell capabilities.
- `.nimi/admission/**` is developer-owned release submission input, not product acceptance truth.

## Retrieval Defaults
- Read the affected tester route, its direct SDK/Kit or shell dependency, and the matching tester contract test.

## Verification Commands
- Run the focused test, then `pnpm --filter @nimiplatform/tester test` and `pnpm --filter @nimiplatform/tester run validate`.
