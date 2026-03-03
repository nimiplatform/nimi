# Landing AGENTS.md

> Conventions for AI agents working on `@nimiplatform/landing`.

## Context

`apps/landing/` is an independent static marketing/entry site for Nimi.
It is intentionally decoupled from `apps/web` application shell flows.

## Stack

- Build tool: Vite 7
- UI: React 19 + Tailwind 4
- Runtime: static client-side site (no runtime/realm API dependency)

## Environment Variables

- `VITE_LANDING_APP_URL`
- `VITE_LANDING_DOCS_URL`
- `VITE_LANDING_GITHUB_URL`
- `VITE_LANDING_PROTOCOL_URL`
- `VITE_LANDING_DEFAULT_LOCALE`

## Coding Rules

- Keep all external links configurable via env with safe defaults.
- Keep content claims aligned with `spec/` and `README.md`; avoid unverified marketing claims.
- Maintain bilingual parity (`en` and `zh`) for user-facing copy.
- Prefer semantic HTML and keyboard-accessible controls.
- Do not import from `runtime/internal/` or desktop/web private internals.

## Build and Verification

```bash
pnpm --filter @nimiplatform/landing typecheck
pnpm --filter @nimiplatform/landing test
pnpm --filter @nimiplatform/landing build
```
