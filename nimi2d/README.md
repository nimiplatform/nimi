# @nimiplatform/nimi2d

Nimi2D is the standalone package layer for Nimi 2D character assets. It owns
layer-input validation, package solving, package validation, reference rendering
proof, reference action proof, Image2 provider evidence ingestion, and release
gate benches.

It does not own production Avatar embodiment, Runtime projection truth, carrier
lifecycle, audio consumer semantics, or app adapter behavior.

## Package Entries

- `@nimiplatform/nimi2d`: layer-input validation, package solving, package
  validation, corpus certification, Generation Bench, runtime proof matrix, and
  Image2 workflow helpers.
- `@nimiplatform/nimi2d/reference-player`: reference package-player proof API,
  including composer, amplitude mouth lane, semantic reference action stream,
  bench, and stress runner. This is package proof only.
- `@nimiplatform/nimi2d/renderer-pixi`: PixiJS renderer substrate for Nimi2D
  render plans.
- `@nimiplatform/nimi2d/proof`: visual proof, mounted frame capture, and alpha
  hit probing.

`@nimiplatform/nimi2d/runtime` remains a lower-level helper path for current
adapter migration, but release-facing package proof code should use
`@nimiplatform/nimi2d/reference-player`.

## Core Commands

- `nimi2d validate-layer-input <manifest>`
- `nimi2d admit-layer-input <manifest>`
- `nimi2d solve-package <layer-input-manifest> --out <package-manifest>`
- `nimi2d validate-package <manifest>`
- `nimi2d admit-package <manifest>`
- `nimi2d render-plan <package-manifest> [--capability-profile <profile>]`
- `nimi2d prove-visual-frame <package-manifest> [--capability-profile <profile>] [--grid-size <n>]`
- `nimi2d inspect-package <package-manifest> [--capability-profile <profile>] [--grid-size <n>] [--out <report.yaml>]`
- `nimi2d validate-bench-corpus <manifest>`
- `nimi2d certify-corpus <corpus-manifest> [--out <report.yaml>] [--min-certified <n>] [--min-invalid <n>]`
- `nimi2d validate-bench-result <manifest>`
- `nimi2d run-generation-bench <corpus-manifest> --out <result>`
- `nimi2d run-runtime-proof-matrix <corpus-manifest> [--grid-size <n>]`
- `nimi2d run-reference-action-bench <package-manifest> [--capability-profile <profile>]`
- `nimi2d run-reference-action-stress <package-manifest> [--capability-profile <profile>]`

## Image And Atlas Commands

- `nimi2d generate-demo-corpus <output-dir>`
- `nimi2d validate-atlas-spec <atlas-spec>`
- `nimi2d generate-demo-atlas <output-dir>`
- `nimi2d cut-layer-atlas <atlas-spec> --out <output-dir>`
- `nimi2d run-atlas-quality-gate <atlas-spec> [--out <quality-report>]`
- `nimi2d run-image-input-workflow-bench <atlas-spec> --out <output-dir> [--grid-size <n>]`

## Codex Image2 Provider Commands

- `nimi2d image2-provider-plan --workflow <workflow> --out-dir <dir> [--description <text>] [--description-file <file>] [--image <png>]`
- `nimi2d image2-provider-run --request <provider-request.yaml> [--dry-run|--execute|--response-file <json>] [--codex-bin <cmd>] [--model <model>]`
- `nimi2d image2-register-output --image <png> --out <manifest.yaml> --surface codex_cli [--request <provider-request.yaml>] [--evidence-image <png>] [--model <model>] [--model-hint <hint>]`
- `nimi2d image2-compare-pixels --left <png> --right <png> --out <report.yaml>`
- `nimi2d image2-postprocess --input <png> --out <png> --report <report.yaml> [--transparent-background none|corner|color]`
- `nimi2d image2-layer-workflow (--image <atlas.png>|--producer-manifest <artifact.yaml>) --out-dir <dir>`
- `nimi2d image2-distribution-report --runs-dir <dir> --out <report.yaml> [--min-samples <n>] [--source-surface <surface>]`
- `nimi2d image2-demo-suite --out-dir <dir> [--sample-count <n>] [--grid-size <n>]`

Use `--source-surface codex_cli` for live provider distribution evidence. Runs
marked `demo_fixture` are regression evidence only.

Image2 formal admission is stricter than repaired workflow success. It requires
admitted producer evidence with pixel identity, upstream raw atlas quality,
normalization, transparent atlas conversion, atlas quality, layer/package, and
bench gates. Demo fixtures and artifacts without pixel identity are not formal
provider admission evidence.

## Release Gate Order

1. Validate layer input.
2. Solve and validate package.
3. Inspect package.
4. Certify corpus eligibility.
5. Run Generation Bench.
6. Run Runtime Proof Matrix.
7. Run reference action bench/stress for package proof.
8. Run atlas/image workflow and quality gates when the source is image/atlas.
9. Run Image2 distribution report with `--source-surface codex_cli` for live
   provider evidence.

Passing reference action proof does not close production Avatar runtime
readiness. Avatar adapter re-entry requires a separate boundary decision.
