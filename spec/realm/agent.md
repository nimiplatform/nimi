# Agent Public Boundary

> Domain: Realm / Agent

## 0. Normative Imports

- `kernel/boundary-vocabulary-contract.md`: `R-BOUND-002`, `R-BOUND-010`
- `kernel/interop-mapping-contract.md`: `R-INTEROP-001`, `R-INTEROP-002`

## 1. Scope

Agent 是 Realm 的组合边界：`Truth` 定义身份与规则真相，`Agent Memory` 承载连续性记忆；共享当前关系状态如有需要，通过 `World State` 暴露。

## 2. Reading Path

1. `kernel/boundary-vocabulary-contract.md`
2. `truth.md`
3. `agent-memory.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No cognition loop, approval workflow, force action, task execution, or prompt runtime state is defined here.
