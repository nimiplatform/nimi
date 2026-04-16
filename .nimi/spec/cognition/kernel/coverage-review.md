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
standalone cognition implementation posture after redesign and independent
audit.

## Top-Level Finding

- `C-COG-004` is re-closed. Current standalone cognition implementation now
  has worker/service lifecycle equivalence, owner-true citation/provenance
  semantics, typed digest persistence, and reopen-safe behavior evidence
  consistent with the latest independent audit. This is a cognition-local
  closeout only. It does not declare repo-wide or global final project
  completion.

## Re-Closed Subsystem Findings

- `C-COG-047` is re-closed. Kernel outgoing refs are admitted where authority
  says they are, kernels still reject incoming refs, and knowledge graph truth
  now lives in first-class relation rows rather than page-embedded pseudo-refs.
- `C-COG-044` remains covered. Knowledge lifecycle, hybrid retrieval, and
  interrupted-task failure continue to have direct behavior evidence.
- `C-COG-045` is re-closed. Same-scope relation integrity, persisted ingest
  lifecycle, explicit running/completed persist-failure fail-close handling,
  interrupted-task fail-close, and admitted worker-path proof are now
  owner-true on the standalone path. Internal `routine/digest`
  `run`/`analyze`/`apply` tests remain useful helper evidence, but they are not
  the primary completion proof for this rule.
- `C-COG-034` is re-closed. Runtime-overlap capability mapping now matches the
  redesigned standalone implementation rather than over-claiming parity through
  surface shape alone.
- `C-COG-054` remains covered for the narrowed subsystem set. Evidence states
  continue to track direct implementation proof for restored rules, including
  the top-level re-close where owner-path proof is now strong enough for a
  cognition-local completion verdict.
- `C-COG-032` is re-closed. The authoritative digest worker path now matches
  the public-surface return contract, and the typed routine contract carries
  persisted digest evidence on the admitted worker path while digest-package
  helper-path tests remain secondary evidence rather than the closeout primary
  proof.
- `C-COG-023` is re-closed. Public lifecycle mutation, live-target admission,
  and citation provenance now fail closed on the admitted service path,
  including memory delete/remove blockers for knowledge citations and active-only
  kernel-rule citation lifecycle checks.

## Stable But Narrow Findings

- kernel mutation surface remains independently owner-true
- SQLite remains the only admitted durable backend
- transient working state remains correctly non-durable
- prompt lane separation still exists and currently consumes only validated
  advisory inputs plus service-owned memory views

These stable points plus the redesigned digest/refgraph, knowledge, and
worker-path cleanup tests keep the architecture credible. Remaining differences
versus runtime are now maturity and depth differences inside overlapping
memory/knowledge concerns rather than cognition-local semantic blockers in the
admitted standalone slice.

## Baseline / Standalone / Runtime Recheck

| Dimension | Baseline Settled | Standalone `nimi-cognition` In Redesign | Runtime Still Owns |
|---|---|---|---|
| Kernel truth | Two local kernels with Git-like mutation | Stable and owner-true | Not owned |
| Advisory references | Kernel may cite advisory artifacts; reverse refs into kernels are not admitted | Matrix and implementation are now aligned | Runtime does not own cognition kernel refs |
| Knowledge graph | Same-scope graph allowed only through explicit semantics | First-class relation truth is owner-true on the admitted path | Runtime still owns its own knowledge-link semantics |
| Hybrid retrieval | Distinct from lexical-only | Lexical+vector local hybrid is direct-behavior covered | Runtime still owns runtime-local provider-backed variants |
| Ingest progress | Explicit task/progress model | Queued/running/completed/failed local lifecycle is persisted and fail-closed | Runtime still owns workflow/runtime task semantics |
| Digest cleanup | External routine with explainable gating | Explainable worker path plus typed persisted evidence are admitted truth | Runtime owns separate hygiene/cascade concerns |

## Current Audit Posture

- No rule in this document should be promoted to `covered` without direct
  behavior-level evidence and a fresh cognition-local review.
- Restored subsystem rules in this document were re-promoted only after direct
  behavior tests and generated-doc updates landed in the redesigned
  implementation.
- `C-COG-004` is now `covered` as a cognition-local standalone completion
  closeout, backed by worker/service lifecycle equivalence, owner-true
  provenance, aligned typed digest routine contract, explicit ingest
  persist-failure fail-close handling, and independent audit agreement.
- `routine/digest` package tests that exercise `run`/`analyze`/`apply`
  directly remain internal helper evidence; authoritative closeout proof is the
  admitted `digest.NewWorker(...).Run(ctx)` path plus typed persisted evidence.
- Repo-wide non-cognition drift remains out of scope for this document.
- Repo-wide or broader final completion claims still require separate
  repo-level closeout beyond this cognition-local review.
