# Nimi2D Agent Guidance

## Scope

- Applies to `nimi2d/**`, especially live Image2 provider generation and admission work.

## Hard Boundaries

- Use the standard `@nimiplatform/nimi2d` surface: `image2-provider-plan`, `image2-provider-run`, `image2-register-output`, `image2-compare-pixels`, `image2-postprocess`, and `image2-layer-workflow`.
- On Windows, if PowerShell blocks the `codex.ps1` shim, run `image2-provider-run --codex-bin codex.cmd`.
- Provider execution must fail closed when generation or persistence fails.
- Keep provider execution, artifact registration, pixel comparison, postprocessing,
  layer materialization, and direct layer/package validation on the declared
  command surface.

## Retrieval Defaults

- Start with the requested Image2 command, its direct inputs/outputs, the nearest package manifest, and the exact contract named by the first failure.
- Do not load unrelated provider history or repo-wide design material before a real command failure points there.

## Verification Commands

- Run the exact affected Image2 command and its nearest package tests; rerun that same command after the smallest causal fix.
- Do not substitute an aggregation command for the affected owner command.
