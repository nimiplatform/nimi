# Install Gateway — AGENTS.md

## Scope
- Applies to `apps/install-gateway/**`.
- Cloudflare Worker serving release distribution: install scripts, platform manifests, updater metadata.

## Hard Boundaries
- Pure ESM, no build transpilation. No frameworks or React.
- Release data sourced from GitHub API only; do not add alternative release backends.
- Cache responses via the Cache API; do not add external cache stores.
- Checksum validation is required for all platform archives before serving manifests.

## Retrieval Defaults
- Start in `apps/install-gateway/src/`.
- Skip `dist/assets/` (generated install script copy).

## Verification Commands
- `pnpm --filter @nimiplatform/install-gateway test`
- `pnpm --filter @nimiplatform/install-gateway build`
