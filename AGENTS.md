# AGENTS.md

- Think before acting. Read existing files before writing code. Prefer editing over rewriting.
- Be concise in output but thorough in reasoning. No sycophantic openers or closing fluff.
- Test your code before declaring done. User instructions always override this file.

## Scope
- Applies to the whole monorepo. Nearest path-scoped `AGENTS.md` may add stricter rules.
- `spec/AGENTS.md` is authoritative for anything under `spec/**`.

## Hard Boundaries
- Repo-wide normative product authority lives under `spec/**`. Admitted app-local product authority slices may also live under `apps/**/spec/**` when the owning app declares that landing, keeps normative content inside `kernel/*.md` and `kernel/tables/**`, and does not create parallel truth against `spec/**`. No in-repo methodology package is currently admitted as execution-system authority. Local-only execution workspaces and reports may live under `.local/**`; tracked support inputs live under `config/**`. `dev/**` is not an active execution-doc surface.
- High-risk design/refactor/implementation work must complete authority preflight before implementation. Required fields in the design/plan doc: `Spec Status`, `Authority Owner`, `Work Type`, `Parallel Truth`.
- `Work Type=alignment` means align to existing spec authority and must not introduce parallel truth. `Work Type=redesign` means authority/canonical-model/ownership change and must not proceed to implementation without prior `spec/**` alignment.
- High-risk, authority-bearing, cross-layer, or multi-phase work must complete authority preflight before implementation. Small, local, low-risk fixes do not need a formal execution workspace when the authority boundary is already clear.
- Debug/fix by layer order: `runtime` → `sdk` → `apps/desktop`/`apps/web` → `nimi-mods`.
- Reuse `nimi-kit` first for app UI and interaction work; check `kit/README.md` and `spec/platform/kernel/tables/nimi-kit-registry.yaml`.
- No legacy shims, compatibility shells, hardcoded provider/model lists, or downstream workarounds.
- No fallback logic hiding contract violations. Missing typed output, MIME type, discriminator, required JSON shape, or schema fields must fail-close.
- No pseudo-success on stable product paths. Do not synthesize empty artifacts, guessed MIME types, fabricated IDs, default payloads.
- App-facing SDK must not expose fallback knobs for route/provider recovery. Internal runtime fallback may exist only as observable low-level strategy.
- Transport retry and single-flight auth refresh: only for transient transport/auth failures; never rescue decode/content-type/schema/contract errors.
- Boundary enforcement: Desktop/Web must not import `runtime/internal/**`; SDK must not cross `realm`/`runtime` private boundaries; Mods must not bypass `nimi-hook`; Runtime must not import from `sdk/**` or `apps/**`.
- App code must not bypass Realm typed services with raw/unsafe requests or ad hoc REST paths.
- No file/directory collisions, no forwarding shells outside `index.ts`, max 3-hop debug trace. Structure depth measured from layer source root.

## Retrieval Defaults
- Start: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`, `.local/**`, `config/**`.
- Skip: `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.

## Verification Commands
- Guardrails: `pnpm check:agents-freshness`, `pnpm check:high-risk-doc-metadata`, `pnpm check:no-retired-methodology-refs`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`, `pnpm check:no-app-realm-rest-bypass`.
- Spec: run affected consistency + docs drift commands. For `spec/**/kernel/**` changes, also run `pnpm check:spec-human-doc-drift`; if fail, `pnpm generate:spec-human-doc`.
- Runtime: `go build ./...`, `go vet ./...`, `go test ./...`, `go run ./cmd/runtime-compliance --gate`
- SDK: `pnpm --filter @nimiplatform/sdk test`, `pnpm check:sdk-coverage`, `pnpm check:sdk-consumer-smoke`
- Desktop/Web: `pnpm --filter @nimiplatform/desktop test`, `pnpm --filter @nimiplatform/web build`
- Live gates: `pnpm check:live-provider-invariants`, `pnpm check:runtime-mod-hook-hardcut`, `pnpm check:mods-no-runtime-sdk`, `pnpm check:local-chat-e2e`.
