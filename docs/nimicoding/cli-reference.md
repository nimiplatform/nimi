# Nimi Coding CLI Reference

The `nimicoding` CLI is the official interface for Nimi Coding. Machine consumers and automation pipelines should inspect both the command exit code and the returned structured JSON payload; an empty result indicates only that no matches were found within the explicitly requested query boundaries, not an evaluation of code correctness or overall conformance.

From the repository root, invoke commands via `pnpm exec nimicoding ...` to resolve the workspace-pinned package. Command prefixes are omitted in the table below for brevity.

## Command Overview

| Category | Primary Commands |
| --- | --- |
| Authoring & Formatting | `authority fmt`, `authority check`, `authority compile` |
| Usage & Consumer Inspection | `authority anchors`, `authority consumers`, `authority terms`, `authority closed-sets` |
| Discovery & Context Retrieval | `authority discover`, `authority query`, `authority context` |
| Relationship & Graph Navigation | `authority refs`, `authority path`, `authority subgraph` |
| Change Impact & Verification | `authority diff`, `authority change-candidates`, `authority impact`, `authority audit`, `authority review` |
| Static Source Context (0.6+) | `code context` |
| Code-Authority Link Query (0.6.1+) | `code authority` |
| Repository Integration Maintenance | `start`, `sync`, `doctor`, `clear` |

## Key Parameters and Invocation Constraints

- **Explicit budgets**: Bounded commands require explicit positive limits (e.g. `--max-units`, `--max-edges`, `--max-bytes`). When results exceed the budget, commands fail closed rather than returning misleadingly truncated sets.
- **Candidate recall (`change-candidates`)**: Returns deterministic recall justifications across caller-selected channels without automated semantic arbitration.
- **Static code context (`code context`)**: Accepts an explicit TypeScript or TSX file, top-level symbol, `tsconfig`, and byte budget, returning root-direct outbound static references without tracing dynamic runtime dispatch.
- **Authority marker scanning (`code authority`)**: Scans source files for reserved standalone physical comment lines:
  - TypeScript, TSX, Go, and Rust:
    ```text
    // @nimi-authority: <exact-authority-id>
    // @nimi-deprecated: <exact-authority-id>
    ```
  - Python:
    ```text
    # @nimi-authority: <exact-authority-id>
    # @nimi-deprecated: <exact-authority-id>
    ```
  - The scanner uses exact physical-line matching; markers should be placed selectively on key domain owners rather than blanketed across trivial helpers or test suites.
- **Host maintenance tools**: `start`, `sync`, and `doctor` maintain workspace configuration health without intercepting tasks or altering AI agent lifecycles.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
