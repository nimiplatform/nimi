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
| `apps/relay/**` | `apps/relay/AGENTS.md` |
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
4. Identify the current authority owner and classify the work as `alignment` or `redesign`.
5. If the work is `redesign`, do not proceed to implementation planning before the relevant `spec/**` delta is defined.
6. Read source code ONLY to verify or fill gaps.

For high-risk design / refactor / implementation plans involving route, state, persistence, bridge, canonical model, or ownership:
- The doc must include `Spec Status`, `Authority Owner`, `Work Type`, and `Parallel Truth`.
- `alignment` work must not introduce parallel truth.
- `redesign` work requires prior spec alignment.

## Nimi Coding Instantiation

This project instantiates nimi-coding with domain-prefix Rule IDs:

| Prefix | Domain | Kernel Location |
|--------|--------|-----------------|
| K- | Runtime | spec/runtime/kernel/ |
| D- | Desktop | spec/desktop/kernel/ |
| S- | SDK | spec/sdk/kernel/ |
| P- | Platform | spec/platform/kernel/ |
| R- | Realm | spec/realm/kernel/ |
| F- | Future | spec/future/kernel/ |

Validation regex: `^[A-Z]-[A-Z]{2,12}-[0-9]{3}$`

## Repo-Wide Hard Boundaries

- `spec/**` is the only normative contract source. Evidence → `dev/report/**`; plans → `dev/plan/**`.
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

- Start with: `runtime/internal`, `runtime/cmd/nimi`, `sdk/src`, `apps/**/src`, `apps/**/src-tauri/src`, `spec/*/kernel`, `scripts`.
- Skip: `_external/**`, `dev/plan/**`, `dev/report/**`, `docs/**`, `**/generated/**`, `**/gen/**`, lockfiles, large assets.

## Repo-Wide Verification

- Guardrails: `pnpm check:agents-freshness`, `pnpm check:high-risk-doc-metadata`, `pnpm check:ai-context-budget`, `pnpm check:ai-structure-budget`, `pnpm check:no-legacy-imports`, `pnpm check:no-absolute-user-paths`.
- Spec gates: run affected consistency + docs drift commands.

## Conflict Resolution

- `AGENTS.md` files are authoritative.
- If this file diverges from an `AGENTS.md`, the `AGENTS.md` is correct.
