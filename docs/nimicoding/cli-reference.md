# Nimi Coding CLI Reference

The public integration surface is the `nimicoding` CLI. Machine consumers must
use the command exit status and its JSON product; an empty result is never an
implicit proof of completeness.

| Purpose | Commands |
| --- | --- |
| Author and admit | `authority fmt`, `authority check`, `authority compile` |
| Find and read | `authority discover`, `authority query`, `authority context` |
| Navigate relations | `authority refs`, `authority path`, `authority subgraph` |
| Review change | `authority diff`, `authority impact`, `authority audit`, `authority review` |
| Repository integration | `start`, `sync`, `doctor`, `clear` |

Bounded commands require explicit positive limits such as `--max-units`,
`--max-edges`, or `--max-bytes`. If the requested complete product does not fit
the budget, the command refuses rather than publishing a truncated
blocking-capable result.

Nimi's guarded shortcuts are listed in the root `package.json`. For authority
authoring requirements, use
`.nimi/methodology/authority-authoring.yaml` rather than copying command
recipes into another configuration or evidence file.

## Source Basis

- [`@nimiplatform/nimi-coding` README](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
