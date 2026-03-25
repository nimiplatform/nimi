---
id: SPEC-REALM-SOCIAL-001
title: Realm Social Domain
status: active
owner: "@team"
updated: 2026-03-23
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

- `Friendship` is the normative V1 social graph for `R-SOC-001`.
- `Friendship` owns user-visible friend state and admission facts.
- `AccountRelationship` is a separate extension graph for richer semantics such as partner, business, ally, rival, or enemy edges.
- `AccountRelationship` does not replace `Friendship` and must not be used as proof for friendship or app admission rules.
