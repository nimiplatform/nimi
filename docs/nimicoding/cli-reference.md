# Nimi Coding CLI Reference

The public integration surface is the `nimicoding` CLI. Machine consumers must
use the command exit status and its JSON product; an empty result never implies
completeness outside that product's explicitly declared scope.

| Purpose | Commands |
| --- | --- |
| Author and admit | `authority fmt`, `authority check`, `authority compile` |
| Inspect repository use | `authority anchors`, `authority consumers`, `authority terms`, `authority closed-sets` |
| Find and read | `authority discover`, `authority query`, `authority context` |
| Navigate relations | `authority refs`, `authority path`, `authority subgraph` |
| Analyze and review change | `authority diff`, `authority change-candidates`, `authority impact`, `authority audit`, `authority review` |
| Repository integration | `start`, `sync`, `doctor`, `clear` |

Bounded commands require explicit positive limits such as `--max-units`,
`--max-edges`, or `--max-bytes`. If the requested complete product does not fit
the budget, the command refuses rather than publishing a truncated
blocking-capable result.

`change-candidates` returns deterministic recall reasons for caller-selected
channels, not semantic decisions. `audit` reports configured graph and exact
lexical violations. `review` keeps business semantics and implementation
conformance explicitly `not_evaluated`.

Nimi's guarded shortcuts are listed in the root `package.json`. For authority
authoring requirements, use
`.nimi/methodology/authority-authoring.yaml` rather than copying command
recipes into another configuration or workflow artifact.

## Source Basis

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
