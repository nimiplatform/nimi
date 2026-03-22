---
id: SPEC-REALM-KERNEL-MEM-001
title: Realm Agent Memory Kernel Contract
status: active
owner: "@team"
updated: 2026-03-22
---

# Agent Memory Contract

> Domain: agent-memory
> Rule family: R

## Scope

This contract defines continuity memory for `nimi-realm`.

## R-MEM-001

Agent Memory stores continuity facts only. Prompt assembly state, tool traces, turn plans, and renderer artifacts are out of scope.

## R-MEM-002

Memory class is fixed to `PUBLIC_SHARED`, `WORLD_SHARED`, or `DYADIC`. Realm must not collapse these classes into one undifferentiated storage bucket.

## R-MEM-003

`DYADIC` memory is strictly isolated by `(agentId, userId)`. Cross-user leakage is a contract violation.

## R-MEM-004

Memory writes must be explicit and auditable. A memory append requires provenance and may be triggered by creator tooling, explicit app commit, or authorized moderation/governance flow only.

## R-MEM-005

User-private deletion rights apply to `DYADIC` memory and must not silently damage shared world continuity or public agent memory.

## R-MEM-006

History and state may inform memory writes, but they do not auto-materialize memory by default. `REPLAY` / `PRIVATE_CONTINUITY` / `CANON_MUTATION` permissions must stay explicit and observable through the commit authorization matrix.
