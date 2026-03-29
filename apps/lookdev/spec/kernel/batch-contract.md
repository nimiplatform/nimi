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

`one realm agent = one item` is the base processing unit. Each item carries a frozen portrait brief snapshot and one operator-owned capture mode.

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

- `WorldStylePack`
- `PortraitBrief`

These assets may be reused across batches, but a batch always freezes its own snapshots at creation time.

## LD-BATCH-009 — Closed Batch Rule

Once a batch reaches `commit_complete`, it is closed.

- failed items from that batch may be inspected later
- they may not be rerun inside the closed batch
- further processing requires a new batch

## LD-BATCH-010 — Capture Selection Authority

Capture selection is user-owned.

- the operator chooses which agents enter capture
- the default selection is `primary` agents
- the app may prefill defaults from Realm importance, but it must not silently replace the operator's choice

## LD-BATCH-011 — Authoritative Field Lists

The authoritative batch and item field lists live in `tables/batch-model.yaml`.

The prose contracts must not redefine those field enumerations separately.
