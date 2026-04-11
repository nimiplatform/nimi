# Web AGENTS.md

## Scope
- Applies to `apps/web/**`.
- Web is the primary web site target: landing at `/`, static legal pages, and the desktop renderer running in web shell mode for `#/...`.

## Hard Boundaries
- Keep renderer logic in desktop first; web only provides adapter replacements under `apps/web/src/desktop-adapter/**`.
- Keep landing-specific code under `apps/web/src/landing/**`; do not split the landing surface back out into a separate app.
- Do not import `@tauri-apps/*` in `apps/web/**`.
- Do not add local mod file access or runtime-only behaviors to web adapters.
- Web source files must import desktop surfaces through `@desktop-public/*` (the admitted public-for-web boundary at `apps/desktop/src/public-web/`). Do not add new direct `@renderer/*` or `@runtime/*` imports in web source files — those wide aliases are kept only for App.tsx transitive resolution.
- Preserve adapter override aliases for `@renderer/bridge`, `@renderer/infra/bootstrap/runtime-bootstrap`, and other desktop-specific entry points replaced by web stubs.

## Retrieval Defaults
- Start in `apps/web/src/landing/**` for marketing/legal entry work, or `apps/web/src/desktop-adapter/**` for web-shell adapter work.
- Skip desktop-only runtime/mod internals unless the adapter contract changed.

## Verification Commands
- `pnpm --filter @nimiplatform/web typecheck`
- `pnpm --filter @nimiplatform/web build`
