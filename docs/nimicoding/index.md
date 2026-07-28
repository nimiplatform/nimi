# Nimi Coding

Nimi Coding gives AI hosts and repository tools deterministic access to
project-owned canonical authority. It formats, checks, queries, relates, and
reviews authority units; it is not an AI agent, planner, code generator,
approval workflow, or product-spec generator.

This page is an explanatory projection of the pinned
`@nimiplatform/nimi-coding` package. The package CLI and its bundled README are
the operational reference for command behavior.

## Truth Boundaries

| Path | Role |
| --- | --- |
| `.nimi/spec/**/*.authority.{yaml,md}` | The only canonical product authority |
| `.nimi/config/**` | Repository-owned Nimi Coding host configuration |
| `.nimi/methodology/authority-authoring.yaml` | Managed authoring instructions |
| `.nimi/local/**` | Ignored local diagnostics and derived evidence; never authority |
| `config/**` | Product, generator, and host implementation inputs; not Nimi Coding host configuration |

Nimi Coding does not turn documentation, fixtures, generated output, audit
results, or `config/**` projections into product authority.

## Current Workflow

When an exact authority ID is not already known, use bounded discovery and
then select the exact unit through project or owner evidence. Before changing
authority, obtain its declared context. After editing, format every changed
container, run the complete-root authority check, and use semantic diff and
impact with explicit byte budgets.

Nimi's repository instructions in `AGENTS.md` and
`.nimi/methodology/authority-authoring.yaml` define the required authoring
workflow. Nimi Coding never owns the host task lifecycle.

## Continue

- [Host integration](/nimicoding/installation)
- [CLI reference](/nimicoding/cli-reference)

## Source Basis

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`.nimi/methodology/authority-authoring.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-authoring.yaml)
