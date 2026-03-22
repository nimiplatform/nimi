# World State Contract

> Domain: world-state
> Rule family: R

## Scope

This contract defines the shared present-state layer for `nimi` Realm open spec.

## R-WSTATE-001

World State expresses the shared present of a world. It is durable state, not story runtime, not prompt context, and not renderer orchestration state.

## R-WSTATE-002

Any state mutation must use an explicit commit envelope containing `worldId`, `appId`, `sessionId`, `effectClass`, `scope`, `schemaId`, `schemaVersion`, `actorRefs`, `reason`, and `evidenceRefs`.

## R-WSTATE-003

World State scope is fixed to durable shared scopes only: `WORLD`, `ENTITY`, or `RELATION`. Story-local control variables must stay outside Realm.

## R-WSTATE-004

`effectClass` is fixed to `NONE | MEMORY_ONLY | STATE_ONLY | STATE_AND_HISTORY`. Clients must not invent additional mutation classes.

## R-WSTATE-005

State writes require explicit app authorization through an `(appId, schemaId, schemaVersion, effectClass) -> runMode` matrix and fail-close schema validation. Missing schema fields, unrecognized scope, unverifiable provenance, or unauthorized run mode must reject the commit.

## R-WSTATE-006

Creator tooling and authorized world-connected apps use the same state commit model. Realm must not privilege hidden legacy write paths outside the explicit commit envelope.
