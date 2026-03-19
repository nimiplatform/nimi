# AGENTS.md

## Scope
- Applies to the whole monorepo. Nearest path-scoped `AGENTS.md` may add stricter rules.
- `spec/AGENTS.md` is authoritative for anything under `spec/**`.
- Compatibility files such as `CLAUDE.md`, `.github/copilot-instructions.md`, and `*context.md` are navigation only.

## Hard Boundaries
- Treat `spec/**` as the only normative contract source. Execution evidence belongs in `dev/report/**`; plans belong in `dev/plan/**`.
- Debug and fix by layer order only: `runtime` first, then `sdk`, then `apps/desktop` / `apps/web`, then `nimi-mods`.
- Do not add legacy shims, compatibility shells, hardcoded provider/model lists, or downstream workarounds for upstream contract gaps.
- Do not cross boundaries:
  - Desktop/Web must not import `runtime/internal/**`.
  - SDK must not cross `realm` and `runtime` private implementation boundaries.
  - Mods must not bypass `nimi-hook` to call `@nimiplatform/sdk/runtime`.
  - Runtime must not import from `sdk/**` or `apps/desktop/**`.
- App production code must not bypass Realm typed services with `realm.raw.request`, literal `/api/` fetches, or ad hoc REST path assembly. Use generated services or an explicitly approved typed adapter module only.
- Keep AI-facing structure shallow: no file/directory collisions, no forwarding shells outside `index.ts`, and no new debug paths longer than three hops from UI to business logic.
- Structure budget depth is measured from each layer's source root (`runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/*/src`, `apps/desktop/src-tauri/src`, `scripts`), not repo root.

## Retrieval Defaults
- Start with targeted source paths: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`.
- Skip noise by default: `_external/**`, `dev/plan/**`, `dev/report/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large binary/image assets.
- If you must inspect generated files or external mirrors, state the exception first and keep reads narrow.

## Verification Commands
- Repo-wide guardrails: `pnpm check:agents-freshness`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`, `pnpm check:no-app-realm-rest-bypass`.
- Spec gates: run the affected spec consistency command and the matching docs drift command.
- Runtime chain order:
  - `runtime`: `go build ./...`, `go vet ./...`, `go test ./...`, `go run ./cmd/runtime-compliance --gate`
  - `sdk`: `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`
  - `desktop and web`: `pnpm --filter @nimiplatform/desktop test`, `pnpm --filter @nimiplatform/web build`
- Live/provider hard gates: `pnpm check:live-provider-invariants`, `pnpm check:runtime-mod-hook-hardcut`, `pnpm check:mods-no-runtime-sdk`, `pnpm check:local-chat-e2e`.
