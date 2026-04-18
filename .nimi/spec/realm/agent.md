---
id: SPEC-REALM-AGENT-001
title: Realm Agent Domain
status: active
owner: "@team"
updated: 2026-04-18
---

# Realm Agent Boundary

## Normative Imports

- `kernel/truth-contract.md`: `R-TRUTH-001..014`
- `.nimi/spec/runtime/kernel/runtime-agent-core-contract.md`: `K-AGCORE-004`
- `kernel/world-state-contract.md`: `R-WSTATE-002..004`（仅引用与 Agent 可见共享当前状态相关的子集，不引入 World State 全量写入边界）

## Scope

Agent 在当前 public canonical 中不承担 memory/brain/chat/orchestration 语义。Agent 边界由两部分组成：

- `Truth`: Agent 身份与规则真相
- `World State Visibility`: 如需共享的当前关系状态，只能通过受约束的共享世界当前态暴露

如需共享的当前关系状态，可通过 `World State` 暴露，但它不是 Agent runtime。

## Reading Path

1. `kernel/truth-contract.md`
2. `.nimi/spec/runtime/kernel/runtime-agent-core-contract.md`
3. `kernel/world-state-contract.md`
4. `kernel/tables/rule-catalog.yaml`
5. `kernel/tables/truth-contract.yaml`

## Non-goals

No cognition loop, approval workflow, force action, task execution, or prompt runtime state is defined here.
