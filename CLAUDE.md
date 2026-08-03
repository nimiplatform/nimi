# CLAUDE.md

> `AGENTS.md` files are authoritative. This file is only a navigation shim.

## Navigation

- A `PreToolUse` hook auto-injects the nearest module `AGENTS.md` before every Read/Edit/Write.
- For Grep, Glob, Bash, or planning, read the repository-root `AGENTS.md` and the nearest descendant `AGENTS.md` for the target path before acting.
- Apply root guidance first; the nearest descendant narrows its subtree.
- Do not duplicate project conventions here. If this file diverges from an `AGENTS.md`, follow the `AGENTS.md`.

<!-- nimicoding:managed:claude:start -->
# Nimi Coding Managed Block

- Product authority lives under `.nimi/spec/**`.
- For canonical authority authoring, read only `.nimi/methodology/authority-authoring.yaml`, the affected authority files or bounded task context, and CLI diagnostics.
- Use `nimicoding authority context <path> <id> --max-units <n> --max-bytes <n> --json` only for the complete declared outgoing interpretation closure; it is not complete task context, and failure never permits guessed or partial context.
- Use `nimicoding authority diff` and `authority impact` with explicit `--max-bytes`; impact reports declared review obligations and does not prove implementation, consumers, or tests are synchronized.
- Use `nimicoding authority change-candidates` only with explicit channels and budgets; its complete union is recall input, never conflict, retirement, absence, authority, or conformance judgment.
- Under `.nimi/spec/**`, author only closed multi-unit `*.authority.yaml` containers or single-unit `*.authority.md`; historical document formats are unsupported and never inferred.
- Run `nimicoding authority fmt` on each changed file, then `nimicoding authority check` on the complete authority input set.
- Never bypass a failure with inferred or fallback semantics; choose repair values only from product/task authority.
- Keep derived and local verification output under `.nimi/local/**`; it is never product authority.
<!-- nimicoding:managed:claude:end -->
