# CLAUDE.md

- Think before acting. Read existing files before writing code.
- Be concise in output but thorough in reasoning.
- Prefer editing over rewriting whole files.
- Do not re-read files you have already read.
- Test your code before declaring done.
- No sycophantic openers or closing fluff.
- Keep solutions simple and direct.
- User instructions always override this file.

> AGENTS.md files are authoritative. A PreToolUse hook auto-injects the nearest module `AGENTS.md` before every Edit/Write.

## Pre-Task Protocol

Before editing files in a module, Read that module's `AGENTS.md` first. The hook covers Edit/Write, but exploration and planning also need module context.

When iterating app UI or interaction flows, inspect `kit/README.md`, the relevant module README under `kit/**`, and `spec/platform/kernel/tables/nimi-kit-registry.yaml` before designing a new app-local shell.

| File path prefix | AGENTS.md to read |
|---|---|
| `runtime/**` | `runtime/AGENTS.md` |
| `sdk/**` | `sdk/AGENTS.md` |
| `apps/desktop/**` | `apps/desktop/AGENTS.md` |
| `apps/web/**` | `apps/web/AGENTS.md` |
| `apps/overtone/**` | `apps/overtone/AGENTS.md` |
| `archive/apps/relay/**` | `archive/apps/relay/AGENTS.md` |
| `apps/forge/**` | `apps/forge/AGENTS.md` |
| `apps/realm-drift/**` | `apps/realm-drift/AGENTS.md` |
| `apps/install-gateway/**` | `apps/install-gateway/AGENTS.md` |
| `kit/**` | `kit/AGENTS.md` |
| `nimi-mods/**` | `nimi-mods/AGENTS.md` |
| `proto/**` | `proto/AGENTS.md` |
| `scripts/**` | `scripts/AGENTS.md` |
| `spec/**` | `spec/AGENTS.md` |
| `nimi-mods/runtime/<name>/spec/**` | That mod's `spec/AGENTS.md` |

If the module has sub-level `AGENTS.md` files, read the nearest one to the file being edited.

## Methodology

There is no currently admitted in-repo methodology package.

- `spec/**` is the only normative source.
- High-risk work still requires explicit authority preflight.
- Small, local, low-risk fixes do not need a formal execution workspace when
  the authority boundary is already clear.
- For high-risk work, follow the nearest authoritative `AGENTS.md` and include
  `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth` in the
  design/plan surface when required.

## Repo-Wide Hard Boundaries

- `spec/**` is the only normative contract source. No in-repo methodology package is currently admitted as execution-system authority. Local-only execution workspaces and reports may live under `.local/**`; tracked support inputs live under `config/**`. `dev/**` is not an active execution-doc surface.
- Layer debug order: `runtime` → `sdk` → `apps/desktop` / `apps/web` → `nimi-mods`.
- Reuse `nimi-kit` first for app UI and interaction work. If a matching kit surface already covers the baseline styling and baseline interaction behavior, extend or compose it instead of recreating a parallel app-local shell.
- No legacy shims, compatibility shells, hardcoded provider/model lists, or downstream workarounds.
- No fallback that hides contract violations. Missing typed output, MIME type, discriminator, required JSON shape, or schema fields must fail-close.
- No pseudo-success on stable product paths. Do not synthesize placeholder artifacts, guessed MIME types, fabricated IDs, default payloads, or "unchanged" success after a typed/cached path fails.
- App-facing SDK surfaces must not expose fallback knobs for route/provider rescue. Internal runtime fallback may exist only as an observable low-level strategy and must not weaken typed public contracts.
- Retry and auth refresh are transport/auth mechanisms only. They must never rescue decode, content-type, schema, or contract failures.
- Boundary enforcement:
  - Desktop/Web must not import `runtime/internal/**`.
  - SDK must not cross `realm` / `runtime` private boundaries.
  - Mods must not bypass `nimi-hook` to call `@nimiplatform/sdk/runtime`.
  - Runtime must not import from `sdk/**` or `apps/**`.
- No file/directory collisions, no forwarding shells outside `index.ts`, max 3-hop debug trace.

## Retrieval Defaults

- Start with: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`, `.local/**`, `config/**`.
- Skip: `_external/**`, `.iterate/**`, `.cache/**`, `archive/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.

`.local/**` is the active local execution workspace family. It is local-only and non-authoritative. Do not use `.iterate/**` or `.cache/**` as execution-state substitutes.

## Repo-Wide Verification

- Guardrails: `pnpm check:agents-freshness`, `pnpm check:high-risk-doc-metadata`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`.
- Spec gates: run affected consistency + docs drift commands.

## Conflict Resolution

- `AGENTS.md` files are authoritative.
- If this file diverges from an `AGENTS.md`, the `AGENTS.md` is correct.
