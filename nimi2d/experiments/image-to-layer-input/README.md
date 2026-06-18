# Nimi2D Image To Layer Input Experiment

This experiment owns upstream producer workflow practice for:

```text
image / layer atlas -> Nimi2D layer-input contract
```

Codex Image2 provider workflows are admitted under
`.nimi/spec/nimi2d/kernel/codex-image2-provider-contract.md`, but provider image
artifacts remain upstream evidence. Formal Nimi2D package admission still starts
at `layer-input.yaml`.

## Current Workflow

```text
atlas prompt
-> atlas PNG
-> atlas spec
-> nimi2d cut-layer-atlas
-> nimi2d validate-layer-input
-> nimi2d run-image-input-workflow-bench
```

The deterministic demo atlas validates the workflow mechanics. Image 2 output
can replace `atlas.png` when it follows the same atlas spec.

See-through PSD output uses a separate direct-layer path:

```text
see-through PSD + .psd.json
-> extract-see-through-psd-layers.py
-> see-through-psd-to-layer-input.mjs
-> layer-input.yaml + direct-layer-quality-report.yaml
```

The converter reads extracted RGBA PSD layers and measured PSD metadata. It does
not treat upstream layer names as Nimi2D validation authority; it maps them into
the existing `LayerInputContract` and records direct layer quality separately.

Generated artifacts for this experiment must live under:

```text
.nimi/local/nimi2d/experiments/image-to-layer-input/fixtures
```

Do not write generated atlas PNGs, cut layer PNGs, workflow reports, or quality
reports under `nimi2d/experiments/**`.

See-through direct-layer outputs must also write outside the package source
tree, for example under a local plan artifact directory or `.nimi/local/nimi2d`.

## Codex Image2 Provider

Use the standard `nimi2d` Codex Image2 provider commands. Do not rely on
session-local manual prompts as evidence.

Plan one of the four admitted provider workflows:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-provider-plan \
  --workflow <prompt-to-image|image-prompt-to-image|image-to-layer-atlas|companion-asset> \
  --description-file <brief.md> \
  --image <optional-source.png> \
  --out-dir <artifact-root>
```

Execute the planned request through Codex CLI:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-provider-run \
  --request <artifact-root>/provider-request.yaml \
  --model <optional-codex-model> \
  --execute
```

The provider writes `prompt.md`, `codex-image2-output.schema.json`,
`provider-request.yaml`, `run-codex-image2.ps1`, `codex-response.json`, and
`codex-image2.artifact.yaml`. If Codex cannot generate and persist a PNG, the
provider must fail closed.

`--model` records an actual selected model for this run. Without it, the
artifact manifest keeps only the request `model_hint`; it does not invent a
producer model fact.

Accepted Image2 persistence routes:

- official generated-image attachment/download path
- official local generated-image path
- locally persisted PNG whose decoded pixels are proven identical to Image Gen
  output evidence

Rejected routes:

- prompt reconstruction
- blank-canvas semantic redraw
- screenshot/downsample/crop unless explicitly marked as preview-derived
- any fallback that changes decoded pixels

`System.Drawing`, PIL, ImageMagick, or equivalent writers are acceptable only as
persistence/encoding steps when they read Image Gen pixels and preserve decoded
pixels. Byte-level PNG differences are allowed when decoded pixels are
identical.

Register a generated image with optional pixel-identity evidence:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-register-output \
  --image <persisted-image2.png> \
  --evidence-image <direct-ui-copy-or-official-output.png> \
  --request <artifact-root>/provider-request.yaml \
  --prompt-file nimi2d/experiments/image-to-layer-input/prompts/codex-image2-layer-source-v1.md \
  --surface codex_app \
  --out <artifact-root>/codex-image2.artifact.yaml
```

Run the atlas-to-layer workflow from that producer record:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-layer-workflow \
  --producer-manifest <artifact-root>/codex-image2.artifact.yaml \
  --out-dir .nimi/local/nimi2d/experiments/image-to-layer-input/runs/<run-id>
```

The workflow copies the admitted producer manifest into
`source/codex-image2-producer-manifest.yaml`, re-hashes and decodes the PNG, and
fails closed if the producer manifest artifact does not match the actual image.
The producer record remains upstream evidence only; formal Nimi2D admission is
still decided by the generated `layer-input.yaml`, atlas quality gate, and
workflow bench.

The run manifest exposes a `quality_summary` with separate verdicts for:

- upstream producer persistence evidence
- upstream raw Image2 atlas quality
- normalized atlas quality
- transparent atlas conversion
- atlas quality gate
- formal Nimi2D admission

Summarize a local run directory as a distribution gate:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-distribution-report \
  --runs-dir .nimi/local/nimi2d/experiments/image-to-layer-input/runs \
  --out .nimi/local/nimi2d/experiments/image-to-layer-input/runs/<report-id>/distribution-report.yaml \
  --min-samples 5 \
  --source-surface codex_cli
```

The distribution report groups runs by source image SHA. Re-running the same
atlas through improved workflow steps counts as one unique source sample, not
as real distribution coverage.

Use `--source-surface codex_cli` for live provider evidence so deterministic
`demo_fixture` runs and manual handoff evidence do not satisfy the live
distribution gate.

Run the deterministic local demo suite when no live Image2 sample set is
available:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-demo-suite \
  --out-dir .nimi/local/nimi2d/experiments/image-to-layer-input/runs/<suite-id> \
  --sample-count 11 \
  --grid-size 4
```

The demo suite exercises all four provider workflow families and runs
`image2-layer-workflow` for each atlas sample. Its artifacts are intentionally
marked `demo_fixture`; they are repaired-workflow regression evidence, not live
Codex Image2 generation evidence or formal provider admission evidence.

Compare two PNGs at decoded RGBA pixel level:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-compare-pixels \
  --left <persisted-image2.png> \
  --right <direct-ui-copy-or-official-output.png> \
  --out <artifact-root>/pixel-identity.yaml
```

Create a transparent-background PNG for see-through or layer tooling:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-postprocess \
  --input <persisted-image2.png> \
  --transparent-background corner \
  --tolerance 24 \
  --crop-alpha \
  --padding 16 \
  --out <artifact-root>/image2-transparent-crop.png \
  --report <artifact-root>/image2-transparent-crop.report.yaml
```

For atlas prompts, prefer a flat generated chroma key (`#00ff00`) over asking
Image Gen for a transparent or checkerboard background. The provider step above
is the authority that turns the generated chroma-key pixels into real alpha
PNG output.

## Codex Execution Boundary

Codex repair prompt construction may support failure interpretation and
repair-loop decisions. Direct `@openai/codex-sdk` execution from experiment
scripts is disabled so live execution does not bypass the standard provider
surface. Use `image2-provider-plan`, `image2-provider-run`,
`image2-register-output`, and `image2-layer-workflow`.

Pass/fail authority remains:

```text
validate-atlas-spec
validate-layer-input
solve-package
run-generation-bench
run-runtime-proof-matrix
```

Run a dry repair prompt from an existing workflow report and upstream Image2
quality report:

```bash
pnpm --filter @nimiplatform/nimi2d codex-orchestrated-atlas -- \
  --atlas-spec .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/atlas/atlas-spec.yaml \
  --report .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/output/workflow-report.yaml \
  --upstream-quality .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/quality/upstream-quality.yaml \
  --producer-manifest .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/source/codex-image2-producer-manifest.yaml \
  --out /tmp/nimi2d-next-atlas-prompt.md
```

The old `--run` path is intentionally disabled.
