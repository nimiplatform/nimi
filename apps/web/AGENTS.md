# Web AGENTS.md

## Scope
- Applies to `apps/web/**`.
- Web is the primary web site target: landing at `/`, static legal pages, and the desktop renderer running in web shell mode for `#/...`.

## Hard Boundaries
- Keep renderer logic in desktop first; web only provides adapter replacements under `apps/web/src/desktop-adapter/**`.
- Keep landing-specific code under `apps/web/src/landing/**`; do not reintroduce a separate `apps/landing` app.
- Do not import `@tauri-apps/*` in `apps/web/**`.
- Do not add local mod file access or runtime-only behaviors to web adapters.
- Preserve alias contracts for `@renderer/*`, `@runtime/*`, and `@mods/*`.

## Retrieval Defaults
- Start in `apps/web/src/landing/**` for marketing/legal entry work, or `apps/web/src/desktop-adapter/**` for web-shell adapter work.
- Skip desktop-only runtime/mod internals unless the adapter contract changed.

## Verification Commands
- `pnpm --filter @nimiplatform/web typecheck`
- `pnpm --filter @nimiplatform/web build`
