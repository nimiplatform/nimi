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
- `nimi2d inspect-layer-input <layer-input-manifest> --out-dir <dir> [--capability-profile <profile>] [--grid-size <n>] [--package-id <id>]`
- `nimi2d audit-release-candidate --distribution-report <report.yaml> --certified-corpus-report <report.yaml> --generation-bench-result <result.yaml> --runtime-proof-matrix <result.json|yaml> [--manual-correction-report <report.yaml>] [--product-review-report <report.yaml>] [--out <report.yaml>]`
- `nimi2d validate-release-product-evidence --manual-correction-report <report.yaml> --product-review-report <report.yaml> [--generation-bench-result <result.yaml>] [--out <report.yaml>]`
- `nimi2d build-release-review-packet --corpus <corpus.yaml> --release-candidate-audit <audit.yaml> --out-dir <dir> [--source-references <refs.yaml>]`
- `nimi2d validate-release-review-packet --packet-dir <dir> [--out <report.yaml>]`
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
- `nimi2d image2-distribution-report --runs-dir <dir> --out <report.yaml> [--min-samples <n>] [--min-underlying-sources <n>] [--require-layer-input-full-chain] [--source-surface <surface>] [--gate-mode source_to_layer_pipeline|repaired_workflow|raw_provider_atlas|formal_admission]`
- `nimi2d image2-demo-suite --out-dir <dir> [--sample-count <n>] [--grid-size <n>]`

Use `--source-surface codex_cli` for live provider distribution evidence. Runs
marked `demo_fixture` are regression evidence only.

`--min-samples` gates unique atlas/source file hashes. Use
`--min-underlying-sources` for stricter release audits that require distinct
provider request `inputs.source_image_sha256` values, so multiple atlas outputs
from the same character/source image cannot be overcounted as source diversity.
Use `--require-layer-input-full-chain` when a release audit must also require
package inspection, visual proof, and reference action proof for every counted
sample. That full-chain proof is separate from the source-to-layer admission
boundary.

Image2 source-to-layer admission uses a raw-plus-repaired evidence model.
Raw provider PNGs remain provenance evidence, not package input. A live sample
can count only when admitted producer evidence with pixel identity is paired
with deterministic normalization, transparent atlas conversion, atlas quality,
and image-input workflow gates. Raw atlas quality is recorded as diagnostic
evidence; use `--gate-mode raw_provider_atlas` when measuring strict raw prompt
quality. Demo fixtures and artifacts without pixel identity are not live
source-to-layer admission evidence.

## Release Gate Order

1. Validate layer input.
2. Solve and validate package.
3. Inspect package, or use `inspect-layer-input` to run layer validation,
   package solve, package inspection, visual proof, and reference action proof
   as one package-owned full-chain report.
4. Certify corpus eligibility.
5. Run Generation Bench.
6. Run Runtime Proof Matrix.
7. Run reference action bench/stress for package proof.
8. Run atlas/image workflow and quality gates when the source is image/atlas.
9. Run Image2 distribution report with `--source-surface codex_cli` and, for
   release audits, `--min-underlying-sources <n>` for live provider evidence.
10. Run `audit-release-candidate` to aggregate the T1-T4 candidate chain:
    provider distribution, certified corpus, Generation Bench, Runtime Proof
    Matrix, visual proof, and reference action proof.
11. Supply `--manual-correction-report` and `--product-review-report` only
    when those measurements have been recorded. Missing or malformed reports
    keep product readiness blocked.
12. Use `validate-release-product-evidence` to check those reports before
    rerunning `audit-release-candidate`.
13. Use `build-release-review-packet` to create a local static review packet
    with copied layer assets and pending manual correction/product review
    templates. For Browser/product QA, pass `--source-references <refs.yaml>`
    to copy optional source-reference thumbnails from a release-review sidecar;
    do not add raw image refs to the certified corpus.
14. Use `validate-release-review-packet` to confirm the packet is
    self-contained before review.

Passing reference action proof does not close production Avatar runtime
readiness. Avatar adapter re-entry requires a separate boundary decision.
Passing `audit-release-candidate` without product blockers is still package
release-candidate evidence; it does not move production Avatar embodiment
authority into Nimi2D.

Manual correction reports are tracking evidence. They record measured case
minutes and p50/p90/max summaries; they do not lower quality gates. Product
review reports are human/product evidence and must pass identity preservation,
layer alignment, expression readability, wardrobe readiness, and product fit.
Nimi2D validates those reports, but it does not invent their contents.
Release review packets help humans produce those reports; packet generation is
not itself product approval.
Packet validation checks the static review packet manifest, templates, HTML
image refs, optional source-reference refs, and copied layer assets. It also
requires review templates to remain pending; filled reports should be validated
separately with `validate-release-product-evidence`.
