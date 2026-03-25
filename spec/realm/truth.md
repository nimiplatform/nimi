---
id: SPEC-REALM-TRUTH-001
title: Realm Truth Domain
status: active
owner: "@team"
updated: 2026-03-23
---

# Realm Truth Domain

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..006` defines the canonical rule of truth core; `R-TRUTH-007..008` extend the same contract for `OASIS` and the formal read surface.
- Kernel import anchor: `kernel/truth-contract.md`, `r-truth-001..006`.

## Scope

Truth 负责定义世界和 Agent 的 canonical rule of truth、发布快照与只读投影。`OASIS` 作为唯一系统主世界属于 canonical world truth，而不是 app 体验层命名约定。

## Reading Path

1. `kernel/truth-contract.md`
2. `kernel/tables/truth-contract.yaml`
3. `kernel/tables/rule-evidence.yaml`

## Non-goals

No runtime AI execution, story orchestration, or transient app session state is defined here.
