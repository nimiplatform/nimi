# SDK Package Governance Contract

> Owner Domain: `S-PKG-*`

## S-PKG-001 Current Root Package Metadata Ownership

`sdk/package.json`, `sdk/tsconfig.json`, `sdk/tsconfig.build.json`, and root SDK support documents are current TypeScript package governance evidence. They must align with the single-package layout, public subpath contract, TypeScript build contract, and SDK release gates defined by the SDK kernel.

## S-PKG-002 Root Documentation Boundary

Root SDK documents such as `sdk/README.md`, `sdk/context.md`, and `sdk/AGENTS.md` are package support evidence, not independent semantic authority. If they conflict with `.nimi/spec/sdk/**`, the SDK spec wins and the support document must be corrected.

## S-PKG-003 Package Release Gate Alignment

SDK root package metadata must stay aligned with SDK testing and release gates. It must not introduce unpublished package names, ungoverned exports, hidden build entrypoints, or release behavior outside `S-GATE-*`, `S-SURFACE-*`, and `S-BOUNDARY-*` authority.

## S-PKG-004 Audit Evidence Admission

Spec-first full audit may cover SDK root support files only through explicit evidence-root admission. Audit tools must not infer SDK root support ownership from package names or workspace membership alone.

## S-PKG-005 SDKS Family Metadata Boundary

`sdks/**` is the Phase 1 core-family workspace boundary governed by
`S-SURFACE-019`. Its support documents and package metadata are family
evidence only after they exist and are explicitly admitted by the SDK kernel.

Current `sdk/package.json` and current `@nimiplatform/sdk` npm subpath metadata
remain evidence for the active TypeScript package only. They must not be
promoted into cross-language family truth, and they must not be used as a
reason to move Desktop/Web consumers during Phase 1.

`sdks/**` package metadata must not introduce public package names, release
commands, conformance commands, or export manifests before the corresponding
generator/conformance authority is admitted. No forwarding package or
compatibility shim may be created to bridge `sdk/` and `sdks/`.
