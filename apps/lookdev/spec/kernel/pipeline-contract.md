# Lookdev Pipeline Contract

> Rule namespace: `LD-PIPE-*`

## LD-PIPE-001 — Create Batch, Then Process

The pipeline begins by creating one batch from one explicit agent selection step.

Selection may be sourced by:

- world-scoped selection
- explicit agent selection

These are selection modes inside one batch-creation flow, not separate product types.

## LD-PIPE-002 — Default Serial Execution

First-version Lookdev supports batch-level concurrency, but the default is `1`.

The pipeline therefore defaults to serial processing unless the operator explicitly raises `maxConcurrency`.

## LD-PIPE-003 — Single Current Result Generation

For each item, one generation attempt produces one current result.

Lookdev does not default to generating multiple candidates per item. The operator may inspect the current result, but the pipeline remains one-item-one-current-result.

## LD-PIPE-004 — Conservative Auto Gate Before Commit

Every generated result must pass through the auto-evaluation gate before it can enter the batch commit set.

- `auto_passed` items become commit-eligible
- failing items stay out of the commit set

## LD-PIPE-005 — Automatic Retry Budget

Each item gets at most three total attempts:

- one initial attempt
- up to two automatic retries

If all attempts are exhausted without passing the gate, the item becomes `auto_failed_exhausted`.

## LD-PIPE-006 — Internal Correction Hints

When an item fails auto-evaluation, the system may derive internal correction hints from the failure reasons and apply them on the next retry.

This behavior remains part of batch policy execution and must not appear as a user-editable per-item override.

## LD-PIPE-007 — Manual Failed-Item Rerun

After automatic processing completes, the operator may manually rerun:

- all failed items
- selected failed items

Manual rerun stays inside the same batch policy and must not change batch scope or per-item configuration.

## LD-PIPE-008 — Pause and Resume

The pipeline must support batch-level pause and resume.

- pause stops further scheduling
- resume continues remaining pending or rerunnable work
- first version does not require item-level pause

## LD-PIPE-009 — Processing Complete Before Commit

A batch reaches `processing_complete` when all items have settled into a processing terminal state for that phase.

At that point, the operator may inspect results, rerun failed items, or trigger batch commit.

## LD-PIPE-010 — Explicit Batch Commit

Realm writeback is a separate explicit stage.

Lookdev must not automatically commit portrait truth immediately after an item auto-passes. Batch commit is an operator-triggered action over the current passed set.
