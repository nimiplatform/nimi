# Realm Agent Memory Public Boundary

> Domain: Realm / Agent Memory

## 0. Normative Imports

- `kernel/agent-memory-contract.md`: `R-MEM-001`, `R-MEM-002`, `R-MEM-003`, `R-MEM-004`, `R-MEM-005`, `R-MEM-006`

## 1. Scope

Agent Memory 负责表达 Agent 的连续性记忆，不承担 prompt/runtime orchestration 语义。

## 2. Reading Path

1. `kernel/agent-memory-contract.md`
2. `kernel/tables/agent-memory-contract.yaml`
3. `agent.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No story-local checkpoint, prompt assembly cache, or LLM tool trace is defined here.
