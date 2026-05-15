---
id: SPEC-REALM-CHAT-001
title: Realm Chat Domain
status: active
owner: "@team"
updated: 2026-05-15
---

# Realm Chat Domain

## Normative Imports

- `kernel/chat-contract.md`: `R-CHAT-001..007`; extended local Agent fork
  identity rules `R-CHAT-008..020`
- `kernel/attachment-contract.md`: `R-ATTACH-001..004`
- `kernel/social-contract.md`: `R-SOC-003..004`

## Scope

Chat 是 `nimi-realm` 的正式通域，负责 canonical chat surface。

Realm Chat v1 admits `direct + group` canonical substrate。Human-Human `DIRECT`
是 Realm cloud transcript truth；Human-Agent `DIRECT` 只允许作为 Desktop
`local-chat` private route，在通过 Realm friendship/admission 后以
`localAgentRef = local-agent:${ownerUserId}:${realmAgentId}` 创建或复用本地
Agent fork。`GROUP` 可容纳 human participants 与 agent slots/authors，且 Chat
负责 group 生命周期、成员管理、agent-slot 元数据与 agent-authored post 防 spoof
验证；`Social` 仅负责 human admission 前置条件。`CHANNEL`、model route、prompt
assembly、session orchestration 与 turn execution runtime 不属于 Realm Chat v1。

## Reading Path

1. `kernel/chat-contract.md`
2. `kernel/attachment-contract.md`
3. `kernel/social-contract.md`
4. `app-interconnect-model.md`

## Non-goals

No human-agent chat runtime, agent-agent chat runtime, model routing, or
prompt/session orchestration state is defined here. AI execution and
turn-execution runtime are also outside this domain. Realm Chat defines the
identity and route boundary for local Agent forks but does not execute the fork.
