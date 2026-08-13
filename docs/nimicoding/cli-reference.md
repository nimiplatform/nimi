# Nimi Coding CLI Reference

The public integration surface is the `nimicoding` CLI. Machine consumers must
use the command exit status and its JSON product; an empty result never implies
completeness outside that product's explicitly declared scope.

From the repository root, invoke the pinned package as
`pnpm exec nimicoding ...`. A global binary in `PATH` is not a supported
availability check. Command names in the table omit this prefix for brevity.

| Purpose | Commands |
| --- | --- |
| Author and admit | `authority fmt`, `authority check`, `authority compile` |
| Inspect repository use | `authority anchors`, `authority consumers`, `authority terms`, `authority closed-sets` |
| Find and read | `authority discover`, `authority query`, `authority context` |
| Navigate relations | `authority refs`, `authority path`, `authority subgraph` |
| Analyze and review change | `authority diff`, `authority change-candidates`, `authority impact`, `authority audit`, `authority review` |
| Read bounded implementation context (0.6+) | `code context` |
| Follow explicit code-authority links (0.6+) | `code authority` |
| Repository integration | `start`, `sync`, `doctor`, `clear` |

Bounded commands require explicit positive limits such as `--max-units`,
`--max-edges`, or `--max-bytes`. If the requested complete product does not fit
the budget, the command refuses rather than publishing a truncated
blocking-capable result.

`change-candidates` returns deterministic recall reasons for caller-selected
channels, not semantic decisions. `audit` reports configured graph and exact
lexical violations. `review` keeps business semantics and implementation
conformance explicitly `not_evaluated`.

`code context` accepts one explicit TypeScript or TSX file, top-level symbol,
tsconfig, and byte budget. It returns root-direct outbound static context, not
inbound impact, runtime dispatch, or complete task context.

`code authority` scans optional standalone source markers:

```text
// nimi-authority: <exact-authority-id>
// nimi-deprecated: <exact-authority-id>
```

Use authority markers only near the small number of semantic owners that need
direct recall. A deprecated marker records a developer judgment already
supported by direct authority evidence or a real product failure; remove it
with the hard cut. Marker lookup does not evaluate unannotated code or prove
declaration ownership, conformance, or hard-cut completion.

Both code commands require Nimi Coding 0.6.0 or newer; this workspace pins
0.6.0 exactly.

`start` bootstraps only documented managed surfaces. `sync` checks or updates
those exact projections, while `doctor` inspects package and projection
compatibility. None of them intercepts an AI task, installs a required
preflight, validates implementation conformance, or owns task state.

Nimi's guarded shortcuts are listed in the root `package.json`. For authority
authoring requirements, use
`.nimi/methodology/authority-authoring.yaml` rather than copying command
recipes into another configuration or workflow artifact.

## Source Basis

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
