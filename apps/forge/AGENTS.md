# Forge — AGENTS.md

## Scope
- Applies to `apps/forge/**` except `apps/forge/spec/**` which has its own AGENTS.md.
- Forge is a creator studio Tauri app for world/agent/content management, publishing, and analytics.

## Hard Boundaries
- All runtime access goes through `@nimiplatform/sdk/runtime`; all realm access goes through `@nimiplatform/sdk/realm`.
- App production code must use generated Realm services or typed data clients. Do not add `realm.raw.request`, `realm.unsafeRaw.request`, ad hoc `/api/` fetches, or fake success stubs for missing backend contracts.
- Rust owns transport and daemon lifecycle only. No business logic on the Rust side.
- OAuth flows (Twitter/TikTok) go through `@nimiplatform/nimi-kit/core/oauth` and Rust `oauth_commands`.
- Do not add direct HTTP/gRPC calls or hardcoded provider/model lists.

## Retrieval Defaults
- Start in `apps/forge/src/shell/renderer` and `apps/forge/src-tauri/src`.
- Skip `apps/forge/src-tauri/gen/**`, `dist/**`, and large asset bundles.

## Verification Commands
- `pnpm --filter @nimiplatform/forge typecheck`
- `pnpm --filter @nimiplatform/forge build`
- `pnpm --filter @nimiplatform/forge test`
