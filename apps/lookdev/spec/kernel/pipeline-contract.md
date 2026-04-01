# Lookdev Pipeline Contract

> Rule namespace: `LD-PIPE-*`

## LD-PIPE-001 — World Style First

The pipeline begins by selecting one world-scoped visual lane and opening one `WorldStyleSession`.

Lookdev must not begin portrait production from raw agent selection alone.

## LD-PIPE-002 — Synthesize Style Pack Before Brief Compilation

The operator must first converge one `WorldStyleSession` and synthesize one `WorldStylePack` draft from that session.

- `WorldStyleSession` is the primary authoring surface for world style
- raw structured fields are secondary advanced-edit surfaces
- the synthesized pack remains draft until explicitly confirmed

## LD-PIPE-003 — Synthesize Capture State Before Brief Materialization

After world style is defined, Lookdev synthesizes one app-local `CaptureState` per selected agent.

Capture-state synthesis uses:

- creator-scoped Realm agent detail
- AgentRule-anchored agent truth
- world context
- current world style pack
- existing portrait or reference context when available

The synthesis result must be state-driven rather than a direct concatenation of raw source fields.

Lookdev may use richer truth to strengthen role interpretation, but that richer truth still feeds `CaptureState` first. It must not bypass `CaptureState` and become a direct generation payload.

## LD-PIPE-004 — Materialize Portrait Briefs From Capture State

After capture state is available, Lookdev materializes one `PortraitBrief` per selected agent.

- the brief is a downstream working artifact, not the primary understanding object
- silent-lane items may materialize their brief immediately after silent capture-state synthesis
- interactive-lane items may rematerialize their brief after each accepted refinement turn

## LD-PIPE-005 — Operator-Owned Capture Selection

After brief compilation, the operator chooses which agents enter capture.

- default selection is `primary` agents
- the operator may add or remove agents from capture
- the app must not let AI silently overrule the final selection

## LD-PIPE-006 — Dual Capture Lanes Before Batch Processing

All selected agents must pass through one of two capture lanes before the main batch processing phase.

- `capture-selected` items use the interactive capture lane
- non-capture-selected items use the silent capture lane
- both lanes must follow the same state-driven capture method family
- interactive capture remains inside Lookdev's mainline flow even when it borrows Agent-Capture-style refinement ideas
- silent capture remains a structured AI synthesis step, not a raw-field passthrough

The interactive lane must also support an explicit reset-to-initial action.

- reset re-synthesizes the current agent's capture state from the current world style lane plus all currently readable agent fields
- reset clears unfinished operator draft text for that agent
- reset does not mutate sibling agents' capture states or the shared world style pack

## LD-PIPE-007 — Freeze Batch, Then Process

Only after world style, portrait briefs, and capture selection settle does Lookdev create one frozen batch.

The frozen batch contains:

- final selected `agentIds`
- final selected `captureSelectionAgentIds`
- one world style pack snapshot
- one capture-state snapshot per item
- one portrait brief snapshot per item
- one shared policy snapshot

## LD-PIPE-008 — Default Serial Execution

Lookdev supports batch-level concurrency, but the default is `1`.

The pipeline therefore defaults to serial processing unless the operator explicitly raises `maxConcurrency`.

## LD-PIPE-009 — Single Current Result Generation

For each item, one generation attempt produces one current result.

Lookdev does not default to generating multiple candidates per item. The operator may inspect the current result, but the pipeline remains one-item-one-current-result.

## LD-PIPE-010 — Conservative Auto Gate Before Commit

Every generated result must pass through the auto-evaluation gate before it can enter the batch commit set.

- `auto_passed` items become commit-eligible
- failing items stay out of the commit set

## LD-PIPE-011 — Automatic Retry Budget

Each item gets at most three total attempts:

- one initial attempt
- up to two automatic retries

If all attempts are exhausted without passing the gate, the item becomes `auto_failed_exhausted`.

## LD-PIPE-012 — Internal Correction Hints

When an item fails auto-evaluation, the system may derive internal correction hints from the failure reasons and apply them on the next retry.

This behavior remains part of batch policy execution and must not appear as a user-editable per-item override.

## LD-PIPE-013 — Manual Failed-Item Rerun

After automatic processing completes, the operator may manually rerun:

- all failed items
- selected failed items

Manual rerun stays inside the same batch policy and must not change batch scope or per-item configuration.

## LD-PIPE-014 — Pause and Resume

The pipeline must support batch-level pause and resume.

- pause stops further scheduling
- resume continues remaining pending or rerunnable work
- item-level pause is not required

## LD-PIPE-015 — Processing Complete Before Commit

A batch reaches `processing_complete` when all items have settled into a processing terminal state for that phase.

At that point, the operator may inspect results, rerun failed items, or trigger batch commit.

## LD-PIPE-016 — Explicit Batch Commit

Realm writeback is a separate explicit stage.

Lookdev must not automatically commit portrait truth immediately after an item auto-passes. Batch commit is an operator-triggered action over the current passed set.
