# Shell Telemetry — AGENTS.md

## Scope
- Applies to `apps/_libs/shell-telemetry/**`.
- Shared renderer-side telemetry helpers and React error-boundary components used across app shells.

## Public Surface
- `@nimiplatform/shell-telemetry/telemetry`
- `@nimiplatform/shell-telemetry/error-boundary`

## Hard Boundaries
- Do not import app-layer code from `apps/**`.
- Keep the package renderer-safe: no Tauri, Node.js, or Electron-specific imports.
- Limit dependencies to React, browser APIs, and local package modules.
- Error-boundary components must remain generic and reusable across shells.
- Telemetry emitters must not encode app-specific event schemas inline; accept structured input from callers.

## Retrieval Defaults
- Start in `apps/_libs/shell-telemetry/src/telemetry/` for event emission.
- Start in `apps/_libs/shell-telemetry/src/error-boundary/` for React boundary components.

## Verification Commands
- `pnpm --filter @nimiplatform/shell-telemetry build`
- `pnpm --filter @nimiplatform/shell-telemetry test`
