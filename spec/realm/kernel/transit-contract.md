# Transit Contract

> Domain: transit
> Rule family: R

## Scope

This contract defines cross-world continuity transfer in `nimi` Realm open spec.

## R-TRANSIT-001

Transit is a continuity protocol for entities moving across worlds. It is not a narrative engine, a time-gap filler, or a generic story router.

## R-TRANSIT-002

Transit must preserve identity continuity while allowing world-context change. Transit must not mutate truth by side effect.

## R-TRANSIT-003

Transit state changes must be explicit, state-machine governed, and auditable.

## R-TRANSIT-004

Transit may hand off durable state and memory references, but app-local runtime checkpoints remain outside Realm.

## R-TRANSIT-005

`OASIS` is the default return point and transit hub in Realm. Creator-world continuity transfer must use `OASIS` as the system anchor.

## R-TRANSIT-006

Creator worlds must not transit directly to other creator worlds. Transit remains a single-hop continuity protocol via `OASIS` and must not introduce scene quota, scene runtime, or other experience-layer gating.
