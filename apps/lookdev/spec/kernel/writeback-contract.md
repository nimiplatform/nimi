# Lookdev Writeback Contract

> Rule namespace: `LD-WRITE-*`

## LD-WRITE-001 — App-Local Truth Before Realm Commit

Before explicit commit, all batch outputs remain Lookdev-local working state.

Generated results, evaluation records, and retry history must not masquerade as already-written Realm truth.

## LD-WRITE-002 — Commit Set Definition

Batch commit targets the current set of items that are:

- `auto_passed`
- not yet committed

Failed items and currently processing items are excluded from the commit set.

## LD-WRITE-003 — First-Version Realm Target

First-version Lookdev writes only the formal agent portrait result.

The writeback target is the upstream Realm agent portrait presentation binding target, not a generic candidate bucket and not direct app-local truth leakage.

## LD-WRITE-004 — No Default Avatar Writeback

First-version Lookdev must not default to writing `AGENT_AVATAR`.

Portrait truth and avatar truth remain separate concerns.

## LD-WRITE-005 — Replace Current Portrait

If an agent already has a formal portrait result, a newly committed Lookdev result replaces that current portrait by default.

First-version Lookdev does not require a separate replace-mode confirmation flow.

## LD-WRITE-006 — No Candidate Writeback Requirement

First-version Lookdev does not need to persist pre-commit candidate history into Realm.

Candidate-like process artifacts stay in app-local working state until explicit commit.

## LD-WRITE-007 — Commit Completion and Closure

After commit runs and all commit outcomes settle, the batch becomes `commit_complete`.

The batch is then closed and no longer accepts new processing work.
