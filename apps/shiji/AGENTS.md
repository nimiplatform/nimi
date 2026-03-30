# ShiJi — AGENTS.md

## Scope
- Applies to `apps/shiji/**` except `apps/shiji/spec/**` which has its own AGENTS.md.
- ShiJi (时迹) is an immersive historical education Tauri app for K-12 students.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- App production code must use generated Realm services or typed data clients. Do not add `realm.raw.request`, `realm.unsafeRaw.request`, ad hoc `/api/` fetches, or fake success stubs for missing backend contracts.
- Rust owns transport and daemon lifecycle only. No business logic on the Rust side.
- OAuth flows go through `@nimiplatform/nimi-kit/core/oauth` and Rust `oauth_commands`.
- Do not add direct HTTP/gRPC calls or hardcoded provider/model lists.
- Dialogue engine logic lives in `src/shell/renderer/engine/`. Do not scatter pipeline logic across feature components.
- SQLite schema changes must be documented in `spec/kernel/tables/` before implementation.

## Retrieval Defaults
- Start in `apps/shiji/src/shell/renderer` and `apps/shiji/src-tauri/src`.
- Skip `apps/shiji/src-tauri/gen/**`, `dist/**`, and large asset bundles.

## Verification Commands
- `pnpm --filter @nimiplatform/shiji typecheck`
- `pnpm --filter @nimiplatform/shiji build`
- `pnpm --filter @nimiplatform/shiji test`
