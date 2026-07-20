# SDKS Package Governance Contract

> Owner Domain: `S-PKG-*`

## S-PKG-001 TypeScript Package Metadata Ownership

`sdks/typescript/package.json`, `sdks/typescript/tsconfig.json`, and
`sdks/typescript/tsconfig.build.json` are the active TypeScript package
governance evidence. They must align with the single base-package layout,
public subpath contract, TypeScript build contract, and SDK release gates
defined by the sdks kernel.

## S-PKG-002 Root Documentation Boundary

SDK package support documents are package evidence, not independent semantic
authority. If they conflict with `.nimi/spec/sdks/**`, the sdks spec wins and
the support document must be corrected.

## S-PKG-003 Package Release Gate Alignment

SDK root package metadata must stay aligned with SDK testing and release gates. It must not introduce unpublished package names, ungoverned exports, hidden build entrypoints, or release behavior outside `S-GATE-*`, `S-SURFACE-*`, and `S-BOUNDARY-*` authority.

Simulator support uses the already public `@nimiplatform/sdk/testing` subpath;
it does not create a Simulator-specific SDK package, root export, transport, or
compatibility layer. Its implementation and package evidence must remain
reachable from the ordinary SDK build/test/coverage gates and from the
Simulator final-graph qualification gate.

## S-PKG-004 Audit Evidence Admission

Spec-first full audit may cover SDK root support files only through explicit evidence-root admission. Audit tools must not infer SDK root support ownership from package names or workspace membership alone.

## S-PKG-005 SDKS Family Metadata Boundary

`sdks/**` is the SDK-family workspace boundary governed by `S-SURFACE-019`.
Its support documents and package metadata are family evidence only after they
exist and are explicitly admitted by the sdks kernel.

`sdks/**` package metadata must not introduce public package names, release
commands, conformance commands, or export manifests before the corresponding
generator/conformance authority is admitted. No forwarding package or
compatibility shim may be created to bridge archived old SDK source and
`sdks/`.
