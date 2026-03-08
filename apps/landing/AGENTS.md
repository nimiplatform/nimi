# Landing AGENTS.md

## Scope
- Applies to `apps/landing/**`.
- Landing is a standalone static site, not part of runtime or desktop execution flows.

## Hard Boundaries
- Keep external links configurable by env vars.
- Keep user-facing claims aligned with repo reality; do not invent product/runtime guarantees.
- Do not import private runtime or desktop internals.

## Retrieval Defaults
- Start in `apps/landing/src/**`.
- Skip unrelated app shells and generated assets.

## Verification Commands
- `pnpm --filter @nimiplatform/landing typecheck`
- `pnpm --filter @nimiplatform/landing test`
- `pnpm --filter @nimiplatform/landing build`
