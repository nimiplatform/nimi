---
id: SPEC-REALM-AGENT-001
title: Realm Agent Domain
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Agent Boundary

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..014`
- `kernel/agent-memory-contract.md`: `R-MEM-001..006`
- `kernel/world-state-contract.md`: `R-WSTATE-002..004`（仅引用与 Agent 可见共享当前状态相关的子集，不引入 World State 全量写入边界）

## Scope

Agent 在闭源 `nimi-realm` 中不再承担 brain/chat/orchestration 语义。Agent 边界由两部分组成：

- `Truth`: Agent 身份与规则真相
- `Agent Memory`: Agent 连续性记忆

如需共享的当前关系状态，可通过 `World State` 暴露，但它不是 Agent runtime。

## Reading Path

1. `kernel/truth-contract.md`
2. `kernel/agent-memory-contract.md`
3. `kernel/tables/rule-catalog.yaml`
4. `kernel/tables/truth-contract.yaml`
5. `kernel/tables/agent-memory-contract.yaml`

## Non-goals

No cognition loop, approval workflow, force action, task execution, or prompt runtime state is defined here.
