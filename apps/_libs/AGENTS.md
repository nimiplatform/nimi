# Shell Shared Libs (_libs) — AGENTS.md

## Scope
- Applies to `apps/_libs/**`.
- Shared libraries for Tauri app shells (Forge, Realm Drift, Desktop).
- Packages: `shell-core`, `shell-auth`, `shell-telemetry`.

## Hard Boundaries
- Zero runtime dependencies; TypeScript types and logic only.
- Do not import app-layer code from `apps/**`.
- OAuth helpers are parameterized on `TauriOAuthBridge`; do not add Tauri-specific imports.
- Shell mode detection reads `VITE_NIMI_SHELL_MODE` env; do not hardcode mode values.
- Telemetry helpers must stay renderer-safe; do not add Node/Tauri/Electron-specific imports.
- Consumers import through published package subpaths only.

## Retrieval Defaults
- Start in the exact package being changed:
- `apps/_libs/shell-core/src/`
- `apps/_libs/shell-auth/src/`
- `apps/_libs/shell-telemetry/src/`

## Verification Commands
- `pnpm --filter @nimiplatform/shell-core build`
- `pnpm --filter @nimiplatform/shell-core test`
- `pnpm --filter @nimiplatform/shell-auth build`
- `pnpm --filter @nimiplatform/shell-telemetry build`
