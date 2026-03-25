---
id: SPEC-REALM-KERNEL-RESOURCE-001
title: Realm Resource Kernel Contract
status: active
owner: "@team"
updated: 2026-03-25
---

# Resource Contract

> Domain: resource
> Rule family: R

## Scope

This contract defines `Resource` as the lowest-level typed content carrier family in `nimi-realm`.

## R-RSRC-001

Realm `Resource` objects are typed content carriers with stable identity, storage, delivery, status, and controller semantics. `Resource` does not imply independent ownership, transfer, or market semantics.

## R-RSRC-002

`Resource` types are fixed to the active typed carrier set declared in kernel enums. This hard cut activates `IMAGE`, `VIDEO`, `AUDIO`, and `TEXT`; `VOICE` remains explicitly out of the active model.

## R-RSRC-003

Resource lifecycle mutation is explicit, idempotent, and auditable. Upload preparation, finalize, metadata update, and delete are lifecycle transitions, not implicit side effects of post or world binding.

## R-RSRC-004

Resource consumption by apps remains binding-safe. Posts, chat attachment envelopes, world presentation, scene presentation, and agent presentation may reference resources through attachment or binding relations without upgrading them into ownable assets by default.

## R-RSRC-005

`deliveryAccess` only defines resource delivery strategy such as public versus signed URL resolution. Viewer authorization is enforced by the reading surface or controller and must not be inferred from `deliveryAccess` alone.

## R-RSRC-006

Public resource upload preparation defaults to `SIGNED` delivery unless the caller explicitly requests `PUBLIC`. This default applies to direct upload and inline text creation surfaces for managed realm resources.
