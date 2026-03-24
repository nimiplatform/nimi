# Video Food Map App Shell Contract

> Rule namespace: VFM-SHELL-*

## VFM-SHELL-001 — Standalone App Boundary

Video Food Map is a standalone app under `apps/video-food-map/`. It must not be specified as a tab or feature slice inside the existing Desktop shell.

## VFM-SHELL-002 — Core Product Surfaces

The app shell must reserve first-class space for:

- video intake
- creator search
- map surface
- review queue
- menu advisor

Review queue and menu advisor may launch later, but they remain product-level surfaces, not hidden debug panels.

## VFM-SHELL-003 — Runtime and SDK Dependency Boundary

The app consumes `nimi-runtime` through typed SDK runtime surfaces. Product code must not depend on ad hoc provider requests as its mainline path.

## VFM-SHELL-004 — Stage Separation

Stage 1 map discovery, stage 2 store confirmation, and stage 3 menu advice must remain separable. A blocked stage 2 or stage 3 feature must not block stage 1 map discovery from shipping.
