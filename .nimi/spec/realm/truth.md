---
id: SPEC-REALM-TRUTH-001
title: Realm Truth Domain
status: active
owner: "@team"
updated: 2026-04-01
---

# Realm Truth Domain

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..006` defines the canonical rule of truth core; `R-TRUTH-007..010` extend the same contract for `OASIS`, formal read surfaces, and public projection aggregate boundaries; `R-TRUTH-011..014` define the official package-native publish line, governance provenance, atomic official publish, and release/rollback anchoring.

## Scope

Truth 负责定义世界和 Agent 的 canonical rule of truth、发布快照与只读投影。`OASIS` 作为唯一系统主世界属于 canonical world truth，而不是 app 体验层命名约定。公开只读聚合面如 `detail-with-agents` 允许暴露 `activeRuleCount` / `agentRuleSummary` 这类 projection 指标，但它们始终是 projection，不是 truth write。

官方内容工厂同样属于 Truth 边界，而不是某个 app 私有控制面。官方 package publish、治理 provenance、原子 world/agent truth write，以及 `WorldRelease` 驱动的 diff / rollback 都必须在这里受约束。

## Reading Path

1. `kernel/truth-contract.md`
2. `kernel/tables/truth-contract.yaml`
3. `kernel/tables/rule-evidence.yaml`

## Non-goals

No runtime AI execution, story orchestration, or transient app session state is defined here.
