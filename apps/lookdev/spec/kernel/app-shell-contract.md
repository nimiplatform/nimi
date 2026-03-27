# Lookdev App Shell Contract

> Rule namespace: `LD-SHELL-*`
> Normative Imports: `P-ARCH-*`, `P-DESIGN-*`, `P-KIT-*`

## LD-SHELL-001 — Standalone App Boundary

Lookdev is a standalone app under `apps/lookdev/`. It must not be specified as a Desktop feature slice or as a runtime mod.

## LD-SHELL-002 — Batch-Centric Navigation

The shell is batch-centric.

- the primary home surface is the batch list
- batch creation is a first-class flow
- batch detail is the main operating surface
- item inspection lives inside batch detail rather than as a separate product line

Authoritative route and surface mapping lives in `tables/routes.yaml`.

## LD-SHELL-003 — App-Local Working State

The app shell must present Lookdev's own working state directly.

- batch summaries
- item progress
- current result previews
- evaluation results
- commit progress

The shell must not imply that a generated result is already Realm truth before explicit batch commit.

## LD-SHELL-004 — Frozen Batch Context

When the operator creates a batch, the shell must present that batch as a frozen run context.

- target selection freezes into batch snapshot
- batch policy freezes into policy snapshot
- later changes to global defaults do not retroactively mutate the batch

## LD-SHELL-005 — First-Version Operational Controls

The shell must expose only first-version operational controls:

- create batch
- pause batch
- resume batch
- rerun all failed items
- rerun selected failed items
- commit passed items

Per-item policy editing, advanced queue orchestration, and multi-reviewer controls are out of scope.

## LD-SHELL-006 — Kit-First UI Direction

Lookdev should follow the shared app-shell pattern and compose first-version shell surfaces from shared kit primitives wherever feasible. App-local UI is permitted for batch grids, item progress views, and result preview surfaces that are specific to batch portrait operations.
