# AGENTS.md — shell-auth

## Scope

Applies to `apps/_libs/shell-auth/**`.

Shared authentication UI library providing login flows (email, OTP, 2FA, wallet, social OAuth) for Tauri/Electron shell apps (Desktop, Relay).

## Hard Boundaries

- All platform-specific logic is injected via `AuthPlatformAdapter` — no direct imports of Desktop `dataSync`, Relay `getBridge()`, or any app-specific module.
- Components use CSS custom properties (`--auth-*`) for theming — no hardcoded color values that cannot be overridden.
- No direct dependency on E2E test ID constants — test IDs are passed as optional props.
- No asset imports (logo, images) — passed as props or CSS variables.
- Peer dependencies only: `react`, `react-i18next`. Runtime deps: `@nimiplatform/shell-core`, `@nimiplatform/sdk`.

## Retrieval Defaults

Start in `apps/_libs/shell-auth/src/`.

## Verification Commands

- `pnpm --filter @nimiplatform/shell-auth build`
