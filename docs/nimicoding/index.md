# Nimi Coding

Nimi Coding gives AI hosts and repository tools deterministic access to
project-owned canonical authority. It formats, checks, queries, relates, and
reviews authority units; it is not an AI agent, planner, code generator,
approval workflow, or product-spec generator.

This page is an explanatory projection of the exact
`@nimiplatform/nimi-coding@0.6.0` package pinned by this workspace. The package
CLI and its bundled README are the operational reference for command behavior.

## Truth Boundaries

| Path | Role |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | The only canonical product authority |
| `.nimi/config/**` | Repository-owned Nimi Coding host configuration |
| `.nimi/methodology/authority-authoring.yaml` | Managed authoring instructions |
| `.nimi/local/**` | Ignored local verification and derived output; never authority |
| `config/**` | Product, generator, and host implementation inputs; not Nimi Coding host configuration |

Nimi Coding does not turn documentation, fixtures, generated output, audit
results, or `config/**` projections into product authority.

## Bounded Code Reads

`code context` derives a bounded, outbound TypeScript or TSX context from one
explicit source file, top-level symbol, and tsconfig. `code authority` locates
optional exact `nimi-authority` and `nimi-deprecated` markers in tracked current
TypeScript, TSX, and Go source, or reads those links back from one source file.

Both operations are request-local and read-only. The AI host decides when to
call them. They do not add a task preflight, change host task state, evaluate
unannotated code, or prove that implementation conforms to authority.

## Current Workflow

When an exact authority ID is not already known, use bounded discovery and
then let project authority or its responsible owner select the exact unit.
Before changing authority, obtain its declared context. After editing, format
every changed container, run the complete-root authority check, and use
semantic diff and impact with explicit byte budgets.

For redesigns that may leave unchanged active survivors outside authored
relations, `authority change-candidates` recalls the complete union of only the
explicitly requested deterministic channels. It does not decide relevance,
conflict, retirement, or conformance. `authority audit` evaluates only the
project's configured graph and exact lexical bindings; a clear result does not
evaluate business semantics or implementation alignment.

Nimi's repository instructions in `AGENTS.md` and
`.nimi/methodology/authority-authoring.yaml` define the required authoring
rules. Their managed text guides AI hosts; it does not intercept prompts or own
the host task lifecycle.

## Continue

- [Host integration](/nimicoding/installation)
- [CLI reference](/nimicoding/cli-reference)

## Source Basis

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
