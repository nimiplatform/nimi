# Lookdev App Shell Contract

> Rule namespace: `LD-SHELL-*`
> Normative Imports: `P-ARCH-*`, `P-DESIGN-*`, `P-KIT-*`

## LD-SHELL-001 — Standalone App Boundary

Lookdev is a standalone app under `apps/lookdev/`. It must not be specified as a Desktop feature slice or as a runtime mod.

## LD-SHELL-002 — Style-to-Batch Navigation

The shell is world-style-and-batch centric.

- the primary home surface is still the batch list
- batch creation is a first-class flow
- batch creation must include world style session, style-pack synthesis, portrait brief compilation, and capture selection
- batch creation must include silent capture-state synthesis for every selected agent and focused interactive capture for the selected subset
- world style session must behave like understanding-led dialogue rather than a rigid multi-step questionnaire
- shell-level route settings must define one dialogue route, one generation route, and one evaluation route for the current workspace
- route settings should persist across app restarts so the operator does not need to reselect them each session
- batch creation must visibly review the current route selections and freeze the current generation/evaluation routes into batch snapshot at create time
- batch detail remains the main operating surface after creation
- once a batch record is created, the shell should navigate into batch detail immediately while processing continues in the background
- item inspection lives inside batch detail rather than as a separate product line

Authoritative route and surface mapping lives in `tables/routes.yaml`.

## LD-SHELL-003 — App-Local Working State

The app shell must present Lookdev's own working state directly.

- world style pack records
- capture state records
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
- explicit generation/evaluation targets freeze into policy snapshot
- later changes to global defaults do not retroactively mutate the batch

## LD-SHELL-005 — Formal Operational Controls

The shell must expose the formal operating controls:

- create batch
- run world style session
- synthesize and confirm world style pack
- compile portrait briefs
- synthesize silent capture states
- refine interactive capture states
- reset interactive capture states back to the current-lane initial synthesis
- choose capture selection
- choose one dialogue route
- choose one generation target
- choose one evaluation target
- pause batch
- resume batch
- rerun all failed items
- rerun selected failed items
- commit passed items
- delete a local batch record after it is paused or closed

Per-item model override, advanced queue orchestration, and multi-reviewer controls are out of scope.

## LD-SHELL-006 — Kit-First UI Direction

Lookdev should follow the shared app-shell pattern and compose first-version shell surfaces from shared kit primitives wherever feasible. App-local UI is permitted for batch grids, item progress views, and result preview surfaces that are specific to batch portrait operations.

## LD-SHELL-007 — Compact Top Shell

Lookdev should prefer a compact top shell over a persistent left navigation rail.

- primary navigation should stay visible as top-level tabs or pills
- locale switching may stay visible as a compact control
- runtime readiness detail and route controls should collapse behind one route-settings entry rather than permanently consuming batch workspace width
- account identity should stay with account chrome rather than inside route settings
- route settings may own route selection as long as create-batch still shows the current route snapshot clearly before freeze
- route settings persistence may stay app-local, but it should be explicit and durable rather than relying on anonymous implicit state hydration

## LD-SHELL-008 — Create Batch Is Task-First

The create-batch surface is a task-first workspace, not a settings page.

- intake, world-style dialogue, style-pack confirmation, capture selection, and embedded capture remain in the main working column
- the side rail should act as a sticky batch review and policy summary, not as an equal-priority second workflow
- route choices may be edited via route settings dialog, but their current dialogue / generation / evaluation selections should stay in shared route settings and create-page review context rather than being restated inside the world-style authoring lane
- if the current selection still contains agents but some of them only expose limited portrait truth, create-batch should keep the lane executable and surface a clear limited-truth warning instead of excluding them at intake time
- create-batch must only fail-close when the current selection collapses to zero agents or zero controllable world cast, not merely because full creator truth is incomplete for part of the cast
- the active world-style session, style-pack, downstream capture states, and portrait briefs must stay language-consistent with the current shell locale; locale switches must not silently keep authoring or reusing stale-language working state
- reusable app-local working assets should restore when the same operator reopens Lookdev instead of silently dropping back to an empty workspace
- interactive capture must offer an explicit reset path that re-synthesizes the current agent back to the initial capture state for the active world-style lane, clears unfinished chat drafts for that agent, and lets the operator restart refinement without affecting sibling agents

## LD-SHELL-009 — Batch Detail Uses Operational Panes

Batch detail should separate queue navigation, active preview inspection, and diagnostics.

- the batch header should summarize frozen context and expose formal actions
- one pane should keep item queue navigation close at hand
- one pane should focus on active preview comparison and frozen snapshots
- one pane should hold evaluation detail, audit trail, and residual errors
- batch list and batch detail may expose a delete-batch-record action, but that action must be clearly framed as removing Lookdev-local history rather than reverting Realm truth
