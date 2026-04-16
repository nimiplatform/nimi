---
id: SPEC-COGNITION-KERNEL-COVERAGE-REVIEW-001
title: Cognition Coverage Review
status: active
owner: "@team"
updated: 2026-04-16
---

# Cognition Coverage Review

## Scope

This document is a cognition-local completion review for standalone evidence.

Compared sources:

- cognition authority under `/.nimi/spec/cognition/kernel/**`
- standalone implementation under `nimi-cognition/**`
- baseline reports under
  `/.nimi/local/report/closed/2026-04-15-agent-centered-cognition-kernels-and-local-models/**`
- runtime comparison contracts under `/.nimi/spec/runtime/kernel/**`

This review does not declare repo-wide final completion. It records the current
cognition-local top-level evidence state after redesign and independent audit.

## Top-Level Finding

- `C-COG-004` is now covered as a cognition-local evidence state. The
  authoritative worker/remove path and service-owned remove policy are aligned,
  legacy low-strength cleanup tails have been removed from admitted truth, and
  fail-closed retrieval/cleanup behavior now has direct proof across the
  admitted families. This does not claim repo-wide final closeout or parity
  with runtime's deeper overlapping service maturity.

## Re-Closed Subsystem Findings

- `C-COG-047` is re-closed. Kernel outgoing refs are admitted where authority
  says they are, kernels still reject incoming refs, and knowledge graph truth
  now lives in first-class relation rows rather than page-embedded pseudo-refs.
- `C-COG-044` and `C-COG-045` are re-closed. Knowledge lifecycle, hybrid
  retrieval, relation truth, and ingest progress now have direct behavior
  evidence for relation durability, delete blockers, vector-backed hybrid, and
  interrupted-task failure on reopen.
- `C-COG-034` is re-closed. Runtime-overlap capability mapping now matches the
  redesigned standalone implementation rather than over-claiming parity through
  surface shape alone.
- `C-COG-054` is re-closed for the narrowed subsystem set. Evidence states now
  track direct implementation proof for restored rules, and the top-level rule
  is now supported by the same narrowed-but-honest evidence posture.
- `C-COG-032` is re-closed. The authoritative digest worker path and the
  tested/store-backed digest path now both recheck structured lifecycle-aware
  blockers before remove, so cleanup mutation no longer falls back to legacy
  string-blocker gating on the worker path.

## Stable But Narrow Findings

- kernel mutation surface remains independently owner-true
- SQLite remains the only admitted durable backend
- transient working state remains correctly non-durable
- prompt lane separation still exists and currently consumes only validated
  advisory inputs plus service-owned memory views

These stable points plus the redesigned digest/refgraph, knowledge, and
worker-path cleanup tests are enough to support cognition-local top-level
coverage. Remaining differences versus runtime are maturity and depth
differences inside overlapping memory/knowledge concerns, not standalone
closure blockers.

## Baseline / Standalone / Runtime Recheck

| Dimension | Baseline Settled | Standalone `nimi-cognition` In Redesign | Runtime Still Owns |
|---|---|---|---|
| Kernel truth | Two local kernels with Git-like mutation | Stable and owner-true | Not owned |
| Advisory references | Kernel may cite advisory artifacts; reverse refs into kernels are not admitted | Matrix and implementation are being realigned | Runtime does not own cognition kernel refs |
| Knowledge graph | Same-scope graph allowed only through explicit semantics | Moving from page-embedded pseudo-graph to first-class relation truth | Runtime still owns its own knowledge-link semantics |
| Hybrid retrieval | Distinct from lexical-only | Rebuilt toward lexical+vector local hybrid | Runtime still owns runtime-local provider-backed variants |
| Ingest progress | Explicit task/progress model | Rebuilt toward queued/running/completed/failed local lifecycle | Runtime still owns workflow/runtime task semantics |
| Digest cleanup | External routine with explainable gating | Explainable, two-pass, and now worker-path consistent with service-owned remove policy | Runtime owns separate hygiene/cascade concerns |

## Current Audit Posture

- No reopened rule in this document should be promoted back to `covered`
  without direct behavior-level evidence and a fresh cognition-local review.
- Restored subsystem rules in this document were re-promoted only after direct
  behavior tests and generated-doc updates landed in the redesigned
  implementation.
- `C-COG-004` is covered only as a cognition-local completion state; any future
  worker/service-path divergence, legacy cleanup regression, or failure-family
  weakening should return it to `deferred`.
- Repo-wide non-cognition drift remains out of scope for this document.
- Broader standalone project completion remains undecided pending the larger
  independent audit.
