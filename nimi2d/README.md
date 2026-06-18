# @nimiplatform/nimi2d

Nimi2D package validators and deterministic package-solving tools.

This package implements host authority from `.nimi/spec/nimi2d/**`. It does not
own package-local spec authority and does not implement host application
adapter execution.

## Package Entries

- `@nimiplatform/nimi2d`: layer input validation, package solving, package
  manifest validation, and Generation Bench.
- `@nimiplatform/nimi2d/runtime`: package parsing, render plans, composer,
  amplitude mouth lane, semantic Live Action Stream, and Live Action Bench
  primitives.
- `@nimiplatform/nimi2d/renderer-pixi`: PixiJS renderer substrate for Nimi2D
  render plans.
- `@nimiplatform/nimi2d/proof`: visual proof, mounted frame capture, and alpha
  hit probing.

## Commands

- `nimi2d validate-layer-input <manifest>`
- `nimi2d admit-layer-input <manifest>`
- `nimi2d solve-package <layer-input-manifest> --out <package-manifest>`
- `nimi2d validate-package <manifest>`
- `nimi2d admit-package <manifest>`
- `nimi2d render-plan <package-manifest> [--capability-profile <profile>]`
- `nimi2d prove-visual-frame <package-manifest> [--capability-profile <profile>] [--grid-size <n>]`
- `nimi2d validate-bench-corpus <manifest>`
- `nimi2d validate-bench-result <manifest>`
- `nimi2d run-generation-bench <corpus-manifest> --out <result>`
- `nimi2d run-live-action-bench <package-manifest> [--capability-profile <profile>]`
