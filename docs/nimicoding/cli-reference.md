<!-- nimi-docs: {"authority":[],"sources":["package.json",".nimi/methodology/authority-authoring.yaml","scripts/check-docs-source.mjs","scripts/lib/docs-source.mjs","scripts/detect-ci-scope.mjs"]} -->

# Nimi Coding CLI Reference

The `nimicoding` CLI is the official command-line interface for Nimi Coding. Automation pipelines and machine callers should evaluate both the process exit code and the returned structured JSON payload: an empty result indicates only that no matches were found within the specified query boundaries, not an evaluation of code correctness or overall conformance.

From the repository root, run commands via `pnpm exec nimicoding ...` to resolve the workspace-pinned package. Command prefixes are omitted in the table below for brevity.

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
- **Candidate recall (`change-candidates`)**: Gathers deterministic recall evidence across caller-selected channels without attempting automated semantic arbitration.
- **Static code context (`code context`)**: Accepts an explicit TypeScript or TSX file, a top-level symbol, a `tsconfig` path, and a byte budget, returning direct outbound static references without tracing dynamic runtime dispatch.
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
  - The scanner uses exact physical-line matching. Place markers intentionally on core domain owner files rather than scattering them across utility helpers or test suites.
- **Host maintenance tools**: `start`, `sync`, and `doctor` keep workspace configuration healthy without intercepting everyday development tasks or altering AI agent lifecycles.

## Review Documentation Consumers

This repository's `pnpm check:docs-source` checks Source Basis paths, code includes and exact authority IDs on mapped pages. The `nimi-docs` JSON comment contains references only; see `docs/AGENTS.md` for its format. CI uses these references to list candidate pages and select documentation checks without requiring a Nimi Coding upgrade.

To list candidates after a commit, pass `--changed-from` and its full 40-character SHA to that repository script. Selection conservatively follows authority files and source paths; it does not prove semantic synchronization. `authority diff`, `impact`, `review` and reader-journey verification retain their separate responsibilities.

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi-coding/blob/main/README.md)
- [`package.json`](https://github.com/nimiplatform/nimi/blob/main/package.json)
