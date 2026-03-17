# CLAUDE.md

> AGENTS.md files are authoritative. A PreToolUse hook auto-injects the nearest module `AGENTS.md` before every Edit/Write.

## Pre-Task Protocol

Before editing files in a module, Read that module's `AGENTS.md` first. The hook covers Edit/Write, but exploration and planning also need module context.

| File path prefix | AGENTS.md to read |
|---|---|
| `runtime/**` | `runtime/AGENTS.md` |
| `sdk/**` | `sdk/AGENTS.md` |
| `apps/desktop/**` | `apps/desktop/AGENTS.md` |
| `apps/web/**` | `apps/web/AGENTS.md` |
| `nimi-mods/**` | `nimi-mods/AGENTS.md` |
| `proto/**` | `proto/AGENTS.md` |
| `scripts/**` | `scripts/AGENTS.md` |
| `spec/**` | `spec/AGENTS.md` |
| `nimi-mods/runtime/<name>/spec/**` | That mod's `spec/AGENTS.md` |

If the module has sub-level `AGENTS.md` files, read the nearest one to the file being edited.

## Methodology: Nimi Coding

Core lifecycle: `Rule -> Table -> Generate -> Check -> Evidence`.
- **Spec-first**: `spec/**` is the only normative source.
- **Table-first**: structured facts live in `spec/**/kernel/tables/*.yaml`, not in prose or source code.
- **Projection-last**: never edit generated files; regenerate from source.
- **Evidence over assertion**: every change requires executed commands and outputs.

Before any capability/evaluation/architecture question:
1. Read `spec/INDEX.md` — match the question to a reading path.
2. Read kernel YAML tables — these are structured facts.
3. Read the relevant domain spec — normative rules with Rule IDs.
4. Read source code ONLY to verify or fill gaps.

## Repo-Wide Hard Boundaries

- `spec/**` is the only normative contract source. Evidence → `dev/report/**`; plans → `dev/plan/**`.
- Layer debug order: `runtime` → `sdk` → `apps/desktop` / `apps/web` → `nimi-mods`.
- No legacy shims, compatibility shells, hardcoded provider/model lists, or downstream workarounds.
- Boundary enforcement:
  - Desktop/Web must not import `runtime/internal/**`.
  - SDK must not cross `realm` / `runtime` private boundaries.
  - Mods must not bypass `nimi-hook` to call `@nimiplatform/sdk/runtime`.
  - Runtime must not import from `sdk/**` or `apps/**`.
- No file/directory collisions, no forwarding shells outside `index.ts`, max 3-hop debug trace.

## Retrieval Defaults

- Start with: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`.
- Skip: `_external/**`, `dev/plan/**`, `dev/report/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.

## Repo-Wide Verification

- Guardrails: `pnpm check:agents-freshness`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`.
- Spec gates: run affected consistency + docs drift commands.

## Conflict Resolution

- `AGENTS.md` files are authoritative.
- If this file diverges from an `AGENTS.md`, the `AGENTS.md` is correct.
