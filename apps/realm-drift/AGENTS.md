# Realm Drift — AGENTS.md

## Scope
- Applies to `apps/realm-drift/**` except `apps/realm-drift/spec/**` which has its own AGENTS.md.
- Realm Drift is a world exploration and agent chat Tauri app with 3D marble visualization.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- App production code must use typed Realm services or an approved typed adapter. Do not call `realm.raw.request`, `realm.unsafeRaw.request`, or hardcode Realm `/api/` paths.
- Rust owns transport and daemon lifecycle only. No business logic on the Rust side.
- Human chat uses Socket.IO client; do not add alternative transport.
- Marble 3D visualization is rendered via external iframe. Do not embed rendering logic.

## Retrieval Defaults
- Start in `apps/realm-drift/src/shell/renderer`, `apps/realm-drift/src/runtime`, `apps/realm-drift/src-tauri/src`.
- Skip `apps/realm-drift/src-tauri/gen/**`, `dist/**`, and large asset bundles.

## Verification Commands
- `pnpm --filter @nimiplatform/realm-drift typecheck`
- `pnpm --filter @nimiplatform/realm-drift build`
- `pnpm --filter @nimiplatform/realm-drift test`
