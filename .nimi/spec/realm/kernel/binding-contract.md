---
id: SPEC-REALM-KERNEL-BINDING-001
title: Realm Binding Kernel Contract
status: active
owner: "@team"
updated: 2026-03-26
---

# Binding Contract

> Domain: binding
> Rule family: R

## Scope

This contract defines `Binding` as the only durable object-to-host relation family in `nimi-realm`.

## R-BIND-001

Realm `Binding` is the only formal durable relation used to attach Realm objects to Realm hosts for presentation, use, or import semantics. `Attachment` remains a cross-surface display envelope only and must not masquerade as binding truth.

## R-BIND-002

Active binding object types are fixed to `RESOURCE`, `ASSET`, and `BUNDLE`. Active binding host types are fixed to `WORLD`, `AGENT`, `SCENE`, `WORLD_EVENT`, and `WORLDVIEW`. `WORKSPACE` is not part of the active backend binding model until a real backend host contract exists.

## R-BIND-003

Binding legality is fail-close and matrix-governed. Only declared `(bindingKind, objectType, hostType, bindingPoint)` combinations are valid, and all undeclared combinations must be rejected. The active `bindingPoint` value set is the canonical `BINDING-POINT` enum declared in `.nimi/spec/realm/kernel/tables/domain-enums.yaml`; `USE` and `IMPORT` remain `null`-only in the active v1 matrix.

## R-BIND-004

`PRESENTATION` bindings may carry flat string-map conditions and use explicit binding points. `USE` and `IMPORT` bindings must not carry conditions. `IMPORT` bindings must pin the imported bundle version, and import truth does not imply member `USE` bindings.

## R-BIND-005

Binding writes must be explicit, idempotent, and auditable. Every binding is scoped to a resolved world, must record the creating actor, and must use the same logical uniqueness key for validation, persistence, and upsert behavior.
