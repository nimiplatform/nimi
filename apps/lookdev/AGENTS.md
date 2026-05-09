# Lookdev — AGENTS.md

## Scope
- Applies to `apps/lookdev/**` except `apps/lookdev/spec/**` which has its own AGENTS.md.
- Lookdev is a standalone batch portrait control-plane Tauri app for world-scoped portrait standardization, capture selection, generation, evaluation, and commit.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- Auth identity is owned by RuntimeAccountService (LD-SHELL-010 / LD-SHELL-011). Construct the platform client via `createLocalFirstPartyRuntimePlatformClient` only. Do NOT use `createPlatformClient` directly. Do NOT pass `accessToken`, `accessTokenProvider`, `refreshTokenProvider`, `subjectUserIdProvider`, or `sessionStore` from the Lookdev renderer.
- App-owned token / refresh-token custody is forbidden. `applyToken` and `persistSession` MUST throw. Logout goes through `runtime.account.logout({ caller })`.
- App production code must use generated Realm services or typed data clients. Do not add `realm.raw.request`, `realm.unsafeRaw.request`, ad hoc `/api/` fetches, or fake success stubs for missing backend contracts.
- Rust owns transport and daemon lifecycle only. No business logic on the Rust side.
- Do not redefine Realm binding law inside the Lookdev spec tree (per `apps/lookdev/spec/AGENTS.md`).

## Retrieval Defaults
- Start in `apps/lookdev/src/shell/renderer` and `apps/lookdev/src-tauri/src`.
- Skip `apps/lookdev/src-tauri/gen/**`, `dist/**`, and large asset bundles.

## Verification Commands
- `pnpm --filter @nimiplatform/lookdev typecheck`
- `pnpm --filter @nimiplatform/lookdev build`
- `pnpm --filter @nimiplatform/lookdev test`
