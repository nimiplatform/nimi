# Web AGENTS.md

## Scope
- Applies to `apps/web/**`.
- Web is the desktop renderer running in web shell mode, not an independent app stack.

## Hard Boundaries
- Keep renderer logic in desktop first; web only provides adapter replacements under `apps/web/src/desktop-adapter/**`.
- Do not import `@tauri-apps/*` in `apps/web/**`.
- Do not add local mod file access or runtime-only behaviors to web adapters.
- Preserve alias contracts for `@renderer/*`, `@runtime/*`, and `@mods/*`.

## Retrieval Defaults
- Start in `apps/web/src/desktop-adapter/**` and the desktop module it overrides.
- Skip desktop-only runtime/mod internals unless the adapter contract changed.

## Verification Commands
- `pnpm --filter @nimiplatform/web typecheck`
- `pnpm --filter @nimiplatform/web build`
