---
id: SPEC-REALM-KERNEL-SOCIAL-001
title: Realm Social Kernel Contract
status: active
owner: "@team"
updated: 2026-03-21
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
