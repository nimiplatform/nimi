# Shell Core (_libs) — AGENTS.md

## Scope
- Applies to `apps/_libs/**`.
- Shared library providing OAuth flows and shell-mode feature flags for Tauri apps (Forge, Realm Drift, Desktop).

## Hard Boundaries
- Zero runtime dependencies; TypeScript types and logic only.
- OAuth helpers are parameterized on `TauriOAuthBridge`; do not add Tauri-specific imports.
- Shell mode detection reads `VITE_NIMI_SHELL_MODE` env; do not hardcode mode values.
- Consumers import via `@nimiplatform/shell-core/oauth` and `@nimiplatform/shell-core/shell-mode`.

## Retrieval Defaults
- Start in `apps/_libs/shell-core/src/`.

## Verification Commands
- `pnpm --filter @nimiplatform/shell-core build`
- `pnpm --filter @nimiplatform/shell-core test`
