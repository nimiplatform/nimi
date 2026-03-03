# Nimi Landing

`@nimiplatform/landing` is an independent static landing site for Nimi.

## Goals

- Ship a production-grade public landing experience decoupled from `apps/web` shell flows.
- Serve both developer and user audiences with one-page anchored navigation.
- Keep claims aligned with `spec/` and public docs.

## Environment Variables

- `VITE_LANDING_APP_URL` - user-facing app entry (default: `https://nimi.xyz/app`)
- `VITE_LANDING_DOCS_URL` - developer docs entry (default: `https://nimi.xyz/docs`)
- `VITE_LANDING_GITHUB_URL` - repository link (default: `https://github.com/nimiplatform/nimi`)
- `VITE_LANDING_PROTOCOL_URL` - protocol/spec entry
- `VITE_LANDING_DEFAULT_LOCALE` - `en` or `zh` fallback locale

## Commands

```bash
pnpm --filter @nimiplatform/landing dev
pnpm --filter @nimiplatform/landing typecheck
pnpm --filter @nimiplatform/landing test
pnpm --filter @nimiplatform/landing build
```
