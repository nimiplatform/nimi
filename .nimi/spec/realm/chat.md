---
id: SPEC-REALM-CHAT-001
title: Realm Chat Domain
status: active
owner: "@team"
updated: 2026-03-25
---

# Realm Chat Domain

## Normative Imports

- `kernel/chat-contract.md`: `R-CHAT-001..005`
- `kernel/attachment-contract.md`: `R-ATTACH-001..004`
- `kernel/social-contract.md`: `R-SOC-003..004`

## Scope

Chat 是 `nimi-realm` 的正式通域，负责 canonical chat surface。

当前 Realm Chat v1 只支持 `HUMAN_HUMAN + DIRECT`。`agent chat`、group/channel、model route、session orchestration 与 turn execution runtime 不属于 Realm Chat v1。

## Reading Path

1. `kernel/chat-contract.md`
2. `kernel/attachment-contract.md`
3. `kernel/social-contract.md`
4. `app-interconnect-model.md`

## Non-goals

No human-agent chat runtime, agent-agent chat runtime, model routing, or prompt/session orchestration state is defined here.
