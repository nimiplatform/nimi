# Overtone — AGENTS.md

## Scope

Applies to `apps/overtone/**` except `apps/overtone/spec/**` which has its own AGENTS.md.

## Architecture Rules

- Renderer owns all product logic (brief, lyrics, takes, compare, publish).
- Rust owns transport and daemon lifecycle only. Do not add business logic to the Rust side.
- No Overtone-specific backend. All AI flows go through `@nimiplatform/sdk/runtime`, all social flows through `@nimiplatform/sdk/realm`.
- The runtime bridge is a minimal subset of `apps/desktop/src-tauri/src/runtime_bridge/`. Do not copy modules listed as "No" in `spec/architecture.md`.

## Tech Stack

- Tauri 2 + React 19 + Vite 7 + Tailwind 4
- Zustand 5 for local state, TanStack Query 5 for server/async state
- Web Audio API for playback
- React Router 7 with HashRouter

## Code Conventions

- ESM imports use `.js` extension even for `.ts` files.
- Alias `@renderer` maps to `src/shell/renderer/`.
- Alias `@nimiplatform/sdk` maps to `../../sdk/src`.
- Feature code lives under `src/shell/renderer/features/<feature>/`.
- Shared hooks live under `src/shell/renderer/hooks/`.
- Bridge code lives under `src/shell/renderer/bridge/`.
- Do not use `console.log` in production code.

## Spec Authority

- `apps/overtone/spec/` is the product spec. Implementation must follow it.
- For runtime/SDK surface questions, defer to `spec/runtime/**` and repo source code.
- Features are tiered P0/P1/P2. Do not implement P1/P2 features before all P0 features work.

## Build & Dev

```bash
pnpm --filter @nimiplatform/overtone dev:renderer   # Vite dev server on :1421
pnpm --filter @nimiplatform/overtone dev:shell       # Tauri dev (renderer + Rust)
pnpm --filter @nimiplatform/overtone build           # Full build
pnpm --filter @nimiplatform/overtone typecheck        # TypeScript check
```
