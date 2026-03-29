# Lookdev App Shell Contract

> Rule namespace: `LD-SHELL-*`
> Normative Imports: `P-ARCH-*`, `P-DESIGN-*`, `P-KIT-*`

## LD-SHELL-001 — Standalone App Boundary

Lookdev is a standalone app under `apps/lookdev/`. It must not be specified as a Desktop feature slice or as a runtime mod.

## LD-SHELL-002 — Style-to-Batch Navigation

The shell is world-style-and-batch centric.

- the primary home surface is still the batch list
- batch creation is a first-class flow
- batch creation must include world style definition, portrait brief compilation, and capture selection
- batch detail remains the main operating surface after creation
- item inspection lives inside batch detail rather than as a separate product line

Authoritative route and surface mapping lives in `tables/routes.yaml`.

## LD-SHELL-003 — App-Local Working State

The app shell must present Lookdev's own working state directly.

- world style pack records
- portrait brief records
- batch summaries
- item progress
- current result previews
- evaluation results
- commit progress

The shell must not imply that working packs, briefs, or generated results are already Realm truth before explicit batch commit.

## LD-SHELL-004 — Frozen Batch Context

When the operator creates a batch, the shell must present that batch as a frozen run context.

- target selection freezes into batch snapshot
- capture selection freezes into batch snapshot
- style pack version freezes into batch snapshot
- portrait brief snapshots freeze into batch items
- batch policy freezes into policy snapshot
- later changes to global defaults do not retroactively mutate the batch

## LD-SHELL-005 — Formal Operational Controls

The shell must expose the formal operating controls:

- create batch
- define or edit world style pack
- compile portrait briefs
- choose capture selection
- pause batch
- resume batch
- rerun all failed items
- rerun selected failed items
- commit passed items

Per-item model override, advanced queue orchestration, and multi-reviewer controls are out of scope.

## LD-SHELL-006 — Kit-First UI Direction

Lookdev should follow the shared app-shell pattern and compose first-version shell surfaces from shared kit primitives wherever feasible. App-local UI is permitted for batch grids, item progress views, and result preview surfaces that are specific to batch portrait operations.
