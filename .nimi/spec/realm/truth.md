---
id: SPEC-REALM-TRUTH-001
title: Realm Truth Domain
status: active
owner: "@team"
updated: 2026-04-23
---

# Realm Truth Domain

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..006` defines the canonical rule of truth core; `R-TRUTH-007..010` extend the same contract for `OASIS`, formal read surfaces, and public projection aggregate boundaries; `R-TRUTH-011..014` define the official package-native publish line, governance provenance, atomic official publish, and release/rollback anchoring; `R-TRUTH-015..017` define `CanonicalTruthPackage`, `InheritanceLink`, and the unified derivation line for governed agent-entry paths.
- `kernel/projection-contract.md`: `R-PROJ-001..007` defines the canonical truth-to-projection seam and the downgrade rule for compat/read surfaces.

## Scope

Truth 负责定义世界和 Agent 的 canonical rule of truth、发布快照与只读投影。`OASIS` 作为唯一系统主世界属于 canonical world truth，而不是 app 体验层命名约定。公开只读聚合面如 `detail-with-agents` 允许暴露 `activeRuleCount` / `agentRuleSummary` 这类 projection 指标，但它们始终是 projection，不是 truth write。`Projection` 是 truth 的正式消费层，而不是 lorebook、worldview 或 prompt assembly 的别名。

官方内容工厂同样属于 Truth 边界，而不是某个 app 私有控制面。官方 package publish、治理 provenance、原子 world/agent truth write，以及 `WorldRelease` 驱动的 diff / rollback 都必须在这里受约束。`CanonicalTruthPackage` 是官方上游 truth ingress；`InheritanceLink` 是 world truth 到 agent truth 的正式 derivation edge；creator create-agent 与 future import 只能作为受治理 derivation entry，而不能形成旁路语义系统。

## Reading Path

1. `kernel/truth-contract.md`
2. `kernel/projection-contract.md`
3. `kernel/tables/truth-contract.yaml`
4. `kernel/tables/projection-contract.yaml`
5. `kernel/tables/rule-evidence.yaml`

## Non-goals

No runtime AI execution, story orchestration, or transient app session state is defined here.
