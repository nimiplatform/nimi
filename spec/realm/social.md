---
id: SPEC-REALM-SOCIAL-001
title: Realm Social Domain
status: active
owner: "@team"
updated: 2026-03-26
---

# Realm Social Domain

## Normative Imports

- `kernel/social-contract.md`: `R-SOC-001..004`

## Scope

Thin guide only. Kernel contracts and tables are authoritative.

## Reading Path

1. `kernel/social-contract.md`
2. `kernel/tables/rule-catalog.yaml`

## Non-goals

No duplicate rule prose beyond kernel references.

## Relationship Boundary

`Friendship` 是 `R-SOC-001` 当前唯一的规范性 social graph。任何 richer relationship graph（包括但不限于 `AccountRelationship`）在缺少新的 `R-SOC-*` kernel 规则前，都只能视为产品层或 backend 私有扩展，不得作为 friendship、chat admission、或 realm-level social truth 的证明。
