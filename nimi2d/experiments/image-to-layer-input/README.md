# Nimi2D Image To Layer Input

This directory contains the maintained prompt and thin wrapper for the real
Image2-to-layer path:

```text
provider generation
-> registered PNG
-> atlas normalization
-> atlas cutting
-> layer-input validation
-> package solve and validation
-> runtime render-plan construction
```

Plan and execute generation with `image2-provider-plan` and
`image2-provider-run`. Register the actual persisted PNG with
`image2-register-output`; `--evidence-image` is optional and is used only for a
decoded-pixel identity comparison.

Run materialization with:

```bash
pnpm --filter @nimiplatform/nimi2d cli -- image2-layer-workflow \
  --producer-manifest <artifact-root>/codex-image2.artifact.yaml \
  --out-dir <artifact-root>/layer-output
```

The workflow fails closed if a supplied artifact descriptor does not match the
PNG. It writes only the source, atlas, layer, and package artifacts needed by
the direct consumer.

The remaining wrapper
`workflows/codex-image2-layer-workflow.mjs` invokes the same package-owned
implementation. Generated outputs belong outside `nimi2d/experiments/**`.
