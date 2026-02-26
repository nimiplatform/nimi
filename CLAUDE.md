# CLAUDE.md

> Claude Code specific instructions for the Nimi open-source monorepo.

## Project Overview

Nimi is an AI-native open world platform. This monorepo contains:

- `runtime/` — Go 1.24 gRPC daemon (AI inference, models, workflows, auth)
- `sdk/` — TypeScript SDK (`@nimiplatform/sdk`)
- `apps/desktop/` — Tauri + React desktop app
- `apps/web/` — Web adapter (reuses desktop renderer)
- `nimi-mods/` — External desktop mini-programs repository (tracked as repo ref)
- `proto/` — Protocol buffer definitions

## Build Commands

```bash
pnpm install                           # Install all dependencies
pnpm build                             # Build SDK + Desktop + Web
pnpm build:sdk                         # Build SDK only
pnpm --filter @nimiplatform/desktop dev:shell  # Desktop shell mode
pnpm dev:web                           # Web dev mode
cd runtime && go build ./cmd/nimi      # Build runtime
cd runtime && go test ./...            # Test runtime
buf lint proto/                        # Lint proto
buf generate                           # Regenerate proto stubs
```

## Key Conventions

- Read [AGENTS.md](AGENTS.md) for full project conventions
- ESM imports with `.js` extension for `.ts` files
- ULID for new IDs
- Zod `safeParse` for validation
- No `console.log` — structured errors only
- Maximum 3-hop debug trace

## Cross-Component Boundaries

- Desktop/Web → Runtime/Realm only through `@nimiplatform/sdk`
- SDK `realm` and `runtime` packages must not cross-import
- Mods → platform only through nimi-hook (never SDK directly)
- Runtime (Go) is a standalone module — no imports from SDK/Desktop

## Sensitive Paths

Changes to these paths require extra care:

- `**/auth/**`, `**/grant/**` — Security
- `**/economy/**`, `**/gift/**` — Financial accuracy
- `**/ai/**`, `**/services/ai/**` — AI behavior
- `**/audit/**` — Compliance

## Documentation

- `docs/` — Human-facing documentation (CC-BY-4.0)
- `AGENTS.md` — Root AI agent conventions
- `runtime/AGENTS.md` — Go runtime conventions
- `sdk/AGENTS.md` — TypeScript SDK conventions
- `apps/desktop/AGENTS.md` — Tauri + React conventions
- `*/context.md` — Per-package quick context for AI agents

## Proto Workflow

After modifying `.proto` files:

```bash
buf lint proto/
buf generate
# Verify: git diff runtime/gen/ sdk/src/runtime/generated/
```

Generated code is committed. CI fails on drift.
