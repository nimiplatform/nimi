# CLAUDE.md

> `AGENTS.md` files are authoritative. This file is only a navigation shim.

## Navigation

- A `PreToolUse` hook auto-injects the nearest module `AGENTS.md` before every Read/Edit/Write.
- For Grep, Glob, Bash, or planning, read the repository-root `AGENTS.md` and the nearest descendant `AGENTS.md` for the target path before acting.
- Apply root guidance first; the nearest descendant narrows its subtree.
- Do not duplicate project conventions here. If this file diverges from an `AGENTS.md`, follow the `AGENTS.md`.

<!-- nimicoding:managed:claude:start -->
# Nimi Coding Managed Block

- From the repository root, invoke the pinned project-local CLI as `pnpm exec nimicoding`; do not probe or rely on a global `nimicoding` binary in `PATH`.
- Product authority lives under `.nimi/spec/**`.
- Choose authority and code queries when their declared scope can resolve an uncertainty that affects the current task; reuse sufficient current evidence. Query scope is not the limit of host reasoning or authorized work, and hypotheses are not product authority.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `pnpm exec nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `pnpm exec nimicoding authority diff` and `pnpm exec nimicoding authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Use `pnpm exec nimicoding authority change-candidates` only with explicit channels and budgets; its complete union is recall input, never conflict, retirement, absence, authority, or conformance judgment.
- When explicit authority links are needed, use `pnpm exec nimicoding code authority --repo <root> --authority <id> --max-files <n> --max-bytes <n>` to locate annotated code, and use `--source <path>` for code-to-authority lookup. Results cover only explicit markers and authority lifecycle; they do not prove implementation conformance or evaluate unannotated code.
- For a new or changed authority-governed feature, add the reserved standalone physical line `// @nimi-authority: <exact-id>` in TypeScript/TSX, Go, or Rust, and `# @nimi-authority: <exact-id>` in Python. The scanner does not prove language comment context, so use this reserved form only for intentional links at a few key semantic owners.
- Use `// @nimi-deprecated: <exact-id>`, or `# @nimi-deprecated: <exact-id>` in Python, only after direct authority evidence or a real product failure confirms obsolete semantics; find it with `pnpm exec nimicoding code authority --repo <root> --audit --max-files <n> --max-bytes <n>` and remove it with the hard cut.
- When a selected TypeScript or TSX consumer still has a static-dependency question, use `pnpm exec nimicoding code context <path> --repo <root> --symbol <identifier> --tsconfig <path> --max-bytes <n>` for bounded root-direct static dependencies; it is not inbound impact, runtime dispatch, or complete task context.
- Use `pnpm exec nimicoding sync --check` to diagnose drift in package-owned managed projections, `pnpm exec nimicoding sync --apply` to restore them, and `pnpm exec nimicoding doctor` to diagnose package/managed compatibility. These commands do not validate product authority, implementation conformance, or task readiness.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `pnpm exec nimicoding authority fmt` on each changed file, then `pnpm exec nimicoding authority check` on the complete authority input set.
- A failed project-local `pnpm exec nimicoding ...` invocation supplies no usable result. Pause decisions that require refused, missing, or incomplete results; continue independent authorized work. Never substitute guessed, corpus-wide, or fallback context, or treat diagnostics or partial output as complete context; choose repair values only from product/task authority.
- Keep derived and local verification output under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:claude:end -->
