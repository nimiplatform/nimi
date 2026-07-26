# Nimi2D Agent Guidance

## Scope

- Applies to `nimi2d/**`, especially live Image2 provider generation and admission work.

## Hard Boundaries

- Use the standard `@nimiplatform/nimi2d` surface: `image2-provider-plan`, `image2-provider-run`, `image2-register-output`, `image2-compare-pixels`, `image2-postprocess`, `image2-layer-workflow`, `image2-distribution-report`, and `image2-demo-suite`.
- On Windows, if PowerShell blocks the `codex.ps1` shim, run `image2-provider-run --codex-bin codex.cmd`.
- Ad hoc session prompts are not provider evidence.
- Provider artifacts are not formal admission until the atlas, layer-input, Generation Bench, and Runtime proof gates pass.
- Keep provider execution, artifact registration, pixel comparison, postprocessing, layer workflow, distribution reporting, and demo validation on the declared command surface.

## Retrieval Defaults

- Start with the requested Image2 command, its direct inputs/outputs, the nearest package manifest, and the exact gate or authority named by the first failure.
- Do not load unrelated provider history, admission evidence, or repo-wide design material before a real command failure points there.

## Verification Commands

- Run the exact affected Image2 command and its nearest package tests; rerun that same command after the smallest causal fix.
- Run atlas, layer-input, Generation Bench, and Runtime proof gates only when making a formal admission claim.
