# Realm Chat Public Boundary

> Domain: Realm / Chat

## 0. Normative Imports

- `kernel/chat-contract.md`: `R-CHAT-001`, `R-CHAT-002`, `R-CHAT-003`, `R-CHAT-004`
- `kernel/social-contract.md`: `R-SOC-003`, `R-SOC-004`

## 1. Scope

Chat 是 Realm 的正式通域，负责 canonical chat surface。

当前 Realm Chat v1 只支持 `HUMAN_HUMAN + DIRECT`。`agent chat`、group/channel、model route、session orchestration 与 turn execution runtime 不属于 Realm Chat v1。

## 2. Reading Path

1. `kernel/chat-contract.md`
2. `kernel/social-contract.md`
3. `social.md`
4. `app-interconnect-model.md`

## 3. Non-goals

No human-agent chat runtime, agent-agent chat runtime, model routing, or prompt/session orchestration state is defined here.
