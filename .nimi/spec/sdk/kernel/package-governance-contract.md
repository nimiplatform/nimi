# SDK Package Governance Contract

> Owner Domain: `S-PKG-*`

## S-PKG-001 Root Package Metadata Ownership

`sdk/package.json`, `sdk/tsconfig.json`, `sdk/tsconfig.build.json`, and root SDK support documents are SDK package governance evidence. They must align with the single-package layout, public subpath contract, TypeScript build contract, and SDK release gates defined by the SDK kernel.

## S-PKG-002 Root Documentation Boundary

Root SDK documents such as `sdk/README.md`, `sdk/context.md`, and `sdk/AGENTS.md` are package support evidence, not independent semantic authority. If they conflict with `.nimi/spec/sdk/**`, the SDK spec wins and the support document must be corrected.

## S-PKG-003 Package Release Gate Alignment

SDK root package metadata must stay aligned with SDK testing and release gates. It must not introduce unpublished package names, ungoverned exports, hidden build entrypoints, or release behavior outside `S-GATE-*`, `S-SURFACE-*`, and `S-BOUNDARY-*` authority.

## S-PKG-004 Audit Evidence Admission

Spec-first full audit may cover SDK root support files only through explicit evidence-root admission. Audit tools must not infer SDK root support ownership from package names or workspace membership alone.
