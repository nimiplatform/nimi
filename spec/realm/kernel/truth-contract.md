# Truth Contract

> Domain: truth
> Rule family: R

## Scope

This contract defines the canonical truth layer for `nimi` Realm open spec.

## R-TRUTH-001

Realm canonical truth is limited to creator-governed world truth and agent truth. Runtime story output is never truth by default.

## R-TRUTH-002

World truth must be anchored by `WorldRule` entries plus `WorldRelease` snapshots. `Worldview` and browse DTOs are computed projections, not truth.

## R-TRUTH-003

Agent truth must be anchored by `AgentRule` entries bound to a world scope. Agent truth defines identity and durable behavioral boundaries, not live prompt context.

## R-TRUTH-004

Truth writes are reserved for creator or control-plane authority. Apps may read truth but must not mutate truth through runtime story execution paths.

## R-TRUTH-005

Truth changes must be explicit, versioned, transactional, and auditable. A projection update must never masquerade as a truth write.

## R-TRUTH-006

Realm truth must remain app-independent. No single app, renderer, or model route may become the canonical owner of world or agent truth.

## R-TRUTH-007

`OASIS` is the unique system main world in Realm. It belongs to canonical world truth, cannot be creator-owned, and cannot be replaced by any creator world convention.

## R-TRUTH-008

`GET /api/world/oasis` is a formal Realm truth read surface for the system main world. It is not a legacy browse shortcut or app-local alias.
