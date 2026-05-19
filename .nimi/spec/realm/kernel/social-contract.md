---
id: SPEC-REALM-KERNEL-SOCIAL-001
title: Realm Social Kernel Contract
status: active
owner: "@team"
updated: 2026-03-23
---

# Social Contract

> Domain: social
> Rule family: R

## Scope

This contract defines the canonical social admission layer for `nimi-realm`.

## R-SOC-001

Friendship is the canonical admission graph for realm-level social relationships.

## R-SOC-002

Friendship uses an ordered pair uniqueness model so the same pair cannot produce duplicate canonical rows.

## R-SOC-003

Social defines relationship and admission facts. It does not define agent-chat runtime, model routing, or turn execution.

## R-SOC-004

Social may gate human chat via preconditions, but canonical chat surface lives in Realm Chat and agent chat runtime stays outside Realm.

## R-SOC-005

Official guide AgentFriend relationships admitted by `R-SOC-006..R-SOC-009` are Realm social
relationships with explicit quota exception posture. They do not count against
ordinary AgentFriend quota only when the official seed row declares
`quota_policy=official_guide_exception`.

Social must not generalize this exception to ordinary RealmAgents, third-party
agents, app-created agents, or user-added AgentFriends.

## R-SOC-006

Realm owns official RealmAgent seed truth. Desktop, Runtime, SDK, and app-local
fixtures must not create fake official guides without a Realm official seed.

## R-SOC-007

`Archivist / @archivist.nimi` is an admitted official RealmAgent seed with
official Nimi guide provenance and OASIS/system main World association.

## R-SOC-008

Realm owns the official relationship source fact that new registered accounts
receive an AgentFriend relationship to admitted official guide seeds when
`auto_provision.agent_friend=true`.

## R-SOC-009

Official guide AgentFriend relationships declared with
`quota_policy=official_guide_exception` do not count against ordinary
AgentFriend quota and must remain an explicit exception.
