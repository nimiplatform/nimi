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

Nimi-authored guide agents use the same Realm social mechanics as any ordinary
RealmAgent. Their AgentFriend relationships are ordinary Friendship rows and do
not create privileged Agent classes, special social schema, hidden quota
exceptions, or authority-bearing official-agent status.

## R-SOC-006

New-user initialization may seed a Nimi guide AgentFriend relationship only
through ordinary Realm social admission. Before creating or repairing that
relationship, the backend path must validate the guide Agent account, required
RealmAgent identity, and required AgentProfile / Realm payload needed for the
ordinary relationship. Missing or invalid payloads fail closed as typed
provisioning or repair states.

`MUST NOT`: Guide AgentFriend provisioning must not create a privileged
official-agent class, social schema fork, quota bypass, server-bot bypass,
Runtime local-only agent, Desktop fixture, or prompt/docs authority shortcut.
