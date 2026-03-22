# Realm Agent Memory Public Boundary

> Domain: Realm / Agent Memory

## 0. Normative Imports

- `kernel/boundary-vocabulary-contract.md`: `R-BOUND-002`, `R-BOUND-010`
- `kernel/interop-mapping-contract.md`: `R-INTEROP-001`, `R-INTEROP-002`

## 1. Scope

Agent Memory 负责表达 Agent 的连续性记忆，不承担 prompt/runtime orchestration 语义。

## 2. Reading Path

1. `kernel/boundary-vocabulary-contract.md`
2. `kernel/interop-mapping-contract.md`
3. `agent.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No story-local checkpoint, prompt assembly cache, or LLM tool trace is defined here.
