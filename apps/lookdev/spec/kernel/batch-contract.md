# Lookdev Batch Contract

> Rule namespace: `LD-BATCH-*`

## LD-BATCH-001 — Batch as the Top-Level Control Unit

Lookdev uses `LookdevBatch` as its top-level control object.

A batch is one frozen run over one selected set of Realm agents under one shared policy snapshot.

## LD-BATCH-002 — Item as the Processing Unit

Each selected Realm agent becomes exactly one `LookdevItem` inside the batch.

`one realm agent = one item` is the base processing unit. Batch scale comes from many items, not from redefining the unit of truth.

## LD-BATCH-003 — Frozen Selection Snapshot

Batch target selection freezes at creation time.

- the batch stores the final frozen `agentIds`
- the batch also stores `selectionSource`
- new agents discovered later do not join the current batch
- additional work must happen in a new batch

## LD-BATCH-004 — Shared Policy Snapshot

All items in one batch share the same policy snapshot.

First-version Lookdev must not introduce per-item overrides for:

- generation policy
- evaluation policy
- retry policy
- writeback policy
- max concurrency

## LD-BATCH-005 — Batch and Item State Models

Authoritative batch and item states live in `tables/batch-model.yaml`.

First-version batch states are:

- `running`
- `paused`
- `processing_complete`
- `commit_complete`

First-version item states are:

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
- passed items
- failed items
- committed items
- commit-failed items

Every item must remain visible in app records regardless of whether it ultimately passed, failed, or committed.

## LD-BATCH-008 — Closed Batch Rule

Once a batch reaches `commit_complete`, it is closed.

- failed items from that batch may be inspected later
- they may not be rerun inside the closed batch
- further processing requires a new batch

## LD-BATCH-009 — Authoritative Field Lists

The authoritative batch and item field lists live in `tables/batch-model.yaml`.

The prose contracts must not redefine those field enumerations separately.
