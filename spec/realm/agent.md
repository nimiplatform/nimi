# Agent Public Boundary

> Domain: Realm / Agent

## 0. Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-002`, `R-TRUTH-003`, `R-TRUTH-004`, `R-TRUTH-005`, `R-TRUTH-006`
- `kernel/agent-memory-contract.md`: `R-MEM-001`, `R-MEM-002`, `R-MEM-003`, `R-MEM-004`, `R-MEM-005`, `R-MEM-006`
- `kernel/world-state-contract.md`: `R-WSTATE-002`, `R-WSTATE-003`, `R-WSTATE-004`

## 1. Scope

Agent 是 Realm 的组合边界：`Truth` 定义身份与规则真相，`Agent Memory` 承载连续性记忆；共享当前关系状态如有需要，通过 `World State` 暴露。

## 2. Reading Path

1. `kernel/truth-contract.md`
2. `truth.md`
3. `agent-memory.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No cognition loop, approval workflow, force action, task execution, or prompt runtime state is defined here.
