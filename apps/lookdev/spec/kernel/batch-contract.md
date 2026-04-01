# Lookdev Batch Contract

> Rule namespace: `LD-BATCH-*`

## LD-BATCH-001 — Batch as the Top-Level Control Unit

Lookdev uses `LookdevBatch` as its top-level control object.

A batch is one frozen run over one selected set of Realm agents under:

- one shared world style pack snapshot
- one shared capture-selection snapshot
- one shared policy snapshot

## LD-BATCH-002 — Item as the Processing Unit

Each selected Realm agent becomes exactly one `LookdevItem` inside the batch.

`one realm agent = one item` is the base processing unit. Each item carries a frozen capture-state snapshot, a frozen portrait brief snapshot, and one operator-owned capture mode.

## LD-BATCH-003 — Frozen Selection Snapshot

Batch target selection freezes at creation time.

- the batch stores the final frozen `agentIds`
- the batch also stores `selectionSource`
- the batch also stores the final frozen `captureSelectionAgentIds`
- new agents discovered later do not join the current batch
- additional work must happen in a new batch

## LD-BATCH-004 — Shared Policy Snapshot

All items in one batch share the same policy snapshot.

Lookdev must not introduce per-item overrides for:

- generation target
- evaluation target
- generation policy
- evaluation policy
- retry policy
- writeback policy
- max concurrency

Per-item capture mode is allowed because it is operator-owned intake routing, not a policy override.

## LD-BATCH-005 — Batch and Item State Models

Authoritative batch and item states live in `tables/batch-model.yaml`.

Formal batch states are:

- `running`
- `paused`
- `processing_complete`
- `commit_complete`

Formal item states are:

- `pending`
- `generating`
- `auto_passed`
- `auto_failed_retryable`
- `auto_failed_exhausted`
- `committed`
- `commit_failed`

## LD-BATCH-006 — One Current Result Per Item

Each item owns one current result image at a time.

- new successful reruns replace the prior current result
- the app may keep lightweight audit events
- the app must not treat first-version Lookdev as a multi-candidate gallery by default

## LD-BATCH-007 — Summary and Visibility

Every batch must expose summary counts for:

- total items
- capture-selected items
- passed items
- failed items
- committed items
- commit-failed items

Every item must remain visible in app records regardless of whether it ultimately passed, failed, or committed.

## LD-BATCH-008 — Reusable Working Assets

Lookdev persists reusable app-local working assets outside the batch itself:

- `WorldStyleSession`
- `WorldStylePack`
- `CaptureState`
- `PortraitBrief`

These assets may be reused across batches, but a batch always freezes its own snapshots at creation time.

`CaptureState` is the app-local single-agent synthesis layer that sits between Realm truth and portrait generation.

- every selected agent must first receive one `CaptureState`
- `CaptureState` must follow a state-driven capture method inspired by Agent-Capture rather than direct field concatenation
- `CaptureState` may run in `silent` mode or `interactive` mode
- silent capture is the default for non-capture-selected agents
- interactive capture is the default refinement lane for capture-selected agents
- `PortraitBrief` is materialized from the current `CaptureState`, not directly from raw Realm fields alone

`WorldStyleSession` is the primary authoring surface for world style.

- the operator first converges world style through natural-language conversation
- the dialogue should be understanding-led and feeling-led rather than a scripted questionnaire
- Lookdev may synthesize one structured draft from that session
- the structured draft must not bypass operator confirmation

`WorldStylePack` must distinguish draft state from confirmed state.

- Lookdev may synthesize one draft candidate from `WorldStyleSession`
- that synthesized draft is not yet authoritative for downstream brief compilation
- only a confirmed style pack may unlock portrait-brief compilation, capture refinement, and batch creation

## LD-BATCH-009 — Closed Batch Rule

Once a batch reaches `commit_complete`, it is closed.

- failed items from that batch may be inspected later
- they may not be rerun inside the closed batch
- further processing requires a new batch

Closed or paused batches may still be deleted from Lookdev's local workspace.

- deletion removes the local `LookdevBatch` record only
- deletion must not delete reusable app-local assets such as `WorldStylePack`, `CaptureState`, or `PortraitBrief`
- deletion must not revert or mutate any already committed Realm portrait truth
- a `running` batch must be paused before deletion is allowed

## LD-BATCH-010 — Capture Selection Authority

Capture selection is user-owned.

- the operator chooses which agents enter capture
- the default selection is `primary` agents
- the app may prefill defaults from Realm importance, but it must not silently replace the operator's choice

## LD-BATCH-011 — Authoritative Field Lists

The authoritative batch and item field lists live in `tables/batch-model.yaml`.

The prose contracts must not redefine those field enumerations separately.

## LD-BATCH-012 — Audit Trail Visibility

Every batch must expose a readable audit trail to the operator.

- audit events may stay lightweight structured records
- the batch list must surface the latest visible audit event for quick operator triage
- the operator must be able to inspect the current run narrative without reading logs
- pause, resume, rerun, processing-complete, and commit-complete transitions must remain visible in app UI
- item-level pass/fail/commit events must remain attributable to the affected agent

## LD-BATCH-013 — Frozen Snapshot Visibility

Every batch must expose its frozen selection and policy snapshots in app UI.

- the operator must be able to inspect how the batch was selected
- the operator must be able to inspect the frozen capture-selection count
- the operator must be able to inspect the active generation target, evaluation target, score threshold, retry budget, max concurrency, and writeback binding
- the operator must be able to inspect whether an item snapshot came from the silent or interactive capture lane
- this visibility must stay separate from mutable app-local working assets such as reusable style packs, reusable capture states, and reusable portrait briefs

## LD-BATCH-014 — World Intake Must Be Controllable

The `by_world` intake lane must only expose worlds the current operator can actually control.

- Lookdev must not default to broad public world discovery for batch creation
- the world selector must resolve from typed control-scoped world services
- a world that cannot yield a controllable cast for batch creation must fail-close instead of presenting a pseudo-ready empty selection

## LD-BATCH-015 — Style Pack Confirmation Gate

Lookdev must fail-close until one world style pack is explicitly confirmed.

- a draft style pack may be edited and persisted inside Lookdev
- editing a previously confirmed style pack returns it to draft state
- capture selection must stay blocked while the active style pack is still draft
- embedded capture must stay blocked while the active style pack is still draft
- batch creation must reject any unconfirmed style pack

## LD-BATCH-016 — Explicit Batch Target Selection

Lookdev must freeze explicit batch-scoped execution targets at batch creation time.

- the operator chooses one `image.generate` target for generation
- the operator chooses one `text.generate.vision` target for evaluation
- defaults may be suggested from runtime readiness, but the targets must remain inspectable and mutable before batch creation
- the frozen target pair must remain visible in batch detail

## LD-BATCH-017 — Capture Snapshot Freezes Before Batch Create

Lookdev must freeze one capture-state snapshot per item before batch creation.

- later app-local capture edits must not retroactively mutate an existing batch item
- silent-lane items and interactive-lane items both obey the same frozen-snapshot rule
- batch generation must consume the frozen item snapshot rather than mutable authoring state

## LD-BATCH-018 — Batch Creation Must Not Wait for Processing Completion

Once a valid `LookdevBatch` record is created, the shell must be able to enter batch detail immediately.

- batch creation freezes selection, capture, style-pack, and policy snapshots first
- the app may start processing immediately after creation
- processing continues asynchronously after the batch record exists
- shell navigation must not be blocked on `processing_complete`
- batch detail must remain the in-flight operating surface while images are still pending, generating, gated, retrying, or passing
