# @nimiplatform/nimi2d

Nimi2D owns the layer-input and package contracts, validation, reference
rendering/action behavior, atlas cutting, and the Codex
Image2 provider integration. It does not own production Avatar embodiment,
Runtime projection truth, carrier lifecycle, audio consumer semantics, or app
adapter behavior.

## Current character package availability

Layer input validation, asset byte/structure checks, and atlas materialization are currently available.

However, character package solving and admission return `NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE`: while inputs provide hints and the package wire carries references, no implementation currently produces or validates the required solved skeleton, morphology, deformation, and action data. Complete hint names or opaque IDs do not establish a proven character package, even for tier-0. `solve-package` writes no package on rejection, and package-based CLI render, visual proof, and action commands require prior admission. The current tier matrix also requires a proven base-body channel for non-character packages; an absent channel does not count as proof, leaving those packages unadmitted as well.

The pure reference helpers remain usable with explicit test fixtures, but their results do not establish package admission or production readiness.

## Package Entries

- `@nimiplatform/nimi2d`: layer-input, package, atlas, and Image2 helpers.
- `@nimiplatform/nimi2d/runtime`: runtime composition and render-plan helpers.
- `@nimiplatform/nimi2d/reference-player`: reference action stream and runner.
- `@nimiplatform/nimi2d/renderer-pixi`: PixiJS renderer for Nimi2D render plans.
- `@nimiplatform/nimi2d/proof`: visual frame and alpha-hit checks used by the
  package owner.

## Direct Development Commands

- `nimi2d validate-layer-input <manifest>`
- `nimi2d solve-package <layer-input-manifest> --out <package-manifest>`
- `nimi2d validate-package <manifest>`
- `nimi2d render-plan <package-manifest> [--capability-profile <profile>]`
- `nimi2d prove-visual-frame <package-manifest> [--grid-size <n>]`
- `nimi2d run-reference-action-bench <package-manifest>`
- `nimi2d run-reference-action-stress <package-manifest>`
- `nimi2d validate-atlas-spec <atlas-spec>`
- `nimi2d cut-layer-atlas <atlas-spec> --out <output-dir>`

## Codex Image2 Commands

- `nimi2d image2-provider-plan --workflow <workflow> --out-dir <dir> ...`
- `nimi2d image2-provider-run --request <provider-request.yaml> ...`
- `nimi2d image2-register-output --image <png> --out <manifest.yaml> ...`
- `nimi2d image2-compare-pixels --left <png> --right <png> --out <report.yaml>`
- `nimi2d image2-postprocess --input <png> --out <png> --report <report.yaml> ...`
- `nimi2d image2-layer-workflow (--image <atlas.png>|--producer-manifest <artifact.yaml>) --out-dir <dir>`

The layer workflow verifies a supplied provider artifact against the actual PNG,
normalizes the atlas, writes a transparent copy and atlas spec, cuts layer PNGs,
validates the generated layer input, and attempts package solving. Because the
character topology producer is currently unavailable, it exits unsuccessfully at
`package_solve`, retains the completed source, atlas, and layer files, and reports
their paths without package or render-plan success. These retained files can
be inspected using the direct layer and atlas commands.

Use the nearest direct command while developing. Command success confirms only
the behavior checked by that owner; final product experience and cross-app
connectivity require user validation.
