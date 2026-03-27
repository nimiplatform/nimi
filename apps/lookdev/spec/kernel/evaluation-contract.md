# Lookdev Evaluation Contract

> Rule namespace: `LD-EVAL-*`

## LD-EVAL-001 — Structured Evaluation Result

Auto-evaluation results must be structured, not free-form.

The authoritative payload shape lives in `tables/evaluation-rubric.yaml` and includes:

- pass/fail
- score
- hard-gate results
- scored checks
- summary
- failure reasons

## LD-EVAL-002 — Conservative Gate

First-version Lookdev uses a conservative auto-evaluation gate.

The gate should prefer rejecting uncertain or weak outputs over admitting visually off-target outputs into the commit set.

## LD-EVAL-003 — Hard Gates Plus Score

Pass/fail uses a mixed rule:

- required hard gates must pass
- overall score must meet the batch threshold

Pure score-only admission is not sufficient for first-version portrait control.

## LD-EVAL-004 — Anchor Image Rubric

The gate evaluates whether the current result behaves like an anchor portrait image rather than a generic dramatic character picture.

The rubric must prioritize:

- full-body completeness
- fixed-focal-length character framing
- subject clarity
- stable pose
- subdued background
- low occlusion

## LD-EVAL-005 — Vision-Based Runtime Path

Lookdev may use typed multimodal runtime surfaces to evaluate generated images.

The app must not treat provider-specific raw requests as the mainline evaluation path.

## LD-EVAL-006 — No Manual Per-Item Review Requirement

First-version product flow does not require manual pass/reject review for every item.

The primary control path is:

- generation
- auto-evaluation
- retry
- batch-level inspection
- explicit batch commit

Human inspection remains optional oversight rather than the default approval mechanism.
