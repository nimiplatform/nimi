# Nimi Coding

Nimi Coding provides deterministic access to project-owned canonical authority for AI hosts and repository tooling. It handles authority formatting, schema validation, relationship queries, dependency navigation, and impact review; it is designed as a focused specification tool rather than an autonomous AI agent, code generator, or product-spec synthesizer.

This documentation corresponds to `@nimiplatform/nimi-coding@0.7.0` pinned by this workspace. Command ergonomics and parameters are described authoritatively in the package's CLI help and bundled README.

## Specification and Configuration Boundaries

| Path Pattern | Role & Scope |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | The single canonical product authority source |
| `.nimi/config/**` | Repository-owned Nimi Coding host execution configuration |
| `.nimi/methodology/authority-authoring.yaml` | Official methodology guide for authoring authority |
| `.nimi/local/**` | Local verification artifacts and cache outputs (git-ignored; never authoritative) |
| `config/**` | Static inputs for apps, code generators, and host implementations; outside Nimi Coding configuration |

Nimi Coding maintains a strict single source of truth: downstream developer documentation, test fixtures, compiler outputs, or audit reports must never override or redefine product authority.

## Bounded Code Context Reads

- **`code context`**: Analyzes a specified TypeScript or TSX file, an admitted top-level symbol (exported or unexported), and `tsconfig` to extract a bounded outbound static context.
- **`code authority`**: Locates explicit `@nimi-authority` and `@nimi-deprecated` marker comments in Git-tracked TypeScript, TSX, Go, Python, and Rust source files, or inspects authority bindings for a given file.

Both commands are request-local and read-only. AI hosts invoke them on demand; they do not install mandatory preflight hooks, alter host task state, or attempt to evaluate unannotated code.

## Authority Maintenance Workflow

1. **Discovery**: When the exact authority identifier is unknown, run `authority discover` within a bounded scope to locate candidate units.
2. **Context resolution**: Before making changes, retrieve the declared outbound context via `authority context`.
3. **Format and validate**: After editing, format each changed file with `authority fmt` and run `authority check` across the full `.nimi/spec` corpus.
4. **Impact analysis**: Run `authority diff` and `authority impact` with explicit byte budgets to review semantic blast radius.
5. **Refactoring sweep**: When planning architectural changes, use `authority change-candidates` to recall impacted nodes across deterministic channels. This output serves as recall input rather than automated arbitration.

The repository instructions in `AGENTS.md` and `.nimi/methodology/authority-authoring.yaml` define authoring guidelines in detail.

## Next Steps

- [Host Integration Guide](/nimicoding/installation)
- [CLI Reference](/nimicoding/cli-reference)

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
