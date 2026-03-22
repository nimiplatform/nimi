---
id: SPEC-REALM-AGENT-MEMORY-001
title: Realm Agent Memory Domain
status: active
owner: "@team"
updated: 2026-03-21
---

# Realm Agent Memory Domain

## Normative Imports

- `kernel/agent-memory-contract.md`: `R-MEM-001..006`

## Scope

Agent Memory 负责表达 Agent 的连续性记忆，不承担 prompt/runtime orchestration 语义。

## Reading Path

1. `kernel/agent-memory-contract.md`
2. `kernel/tables/agent-memory-contract.yaml`
3. `kernel/tables/domain-enums.yaml`

## Non-goals

No story-local checkpoint, prompt assembly cache, or LLM tool trace is defined here.
