# Nimi2D Image To Layer Input Experiment

This experiment owns upstream producer workflow practice for:

```text
image / layer atlas -> Nimi2D layer-input contract
```

It is intentionally outside Nimi2D core admission. Core still starts at
`layer-input.yaml`.

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

Generated artifacts for this experiment must live under:

```text
.nimi/local/nimi2d/experiments/image-to-layer-input/fixtures
```

Do not write generated atlas PNGs, cut layer PNGs, workflow reports, or quality
reports under `nimi2d/experiments/**`.

## Codex SDK Role

Codex SDK should orchestrate prompt construction, failure interpretation, and
repair-loop decisions. It must not decide whether a generated atlas passes.

Pass/fail authority remains:

```text
validate-atlas-spec
validate-layer-input
solve-package
run-generation-bench
run-runtime-proof-matrix
```

Run a dry repair prompt from an existing workflow report:

```bash
node nimi2d/experiments/image-to-layer-input/workflows/codex-orchestrated-atlas.mjs \
  --atlas-spec .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/atlas/atlas-spec.yaml \
  --report .nimi/local/nimi2d/experiments/image-to-layer-input/fixtures/output/workflow-report.yaml \
  --out /tmp/nimi2d-next-atlas-prompt.md
```

Use `--run` only in an environment that intentionally installs and authorizes
`@openai/codex-sdk`.
