# SDK World Evolution Engine Projection Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

This contract defines the SDK typed projection boundary for the World Evolution Engine.
It mirrors only contract-visible Runtime shapes already owned by `K-WEV-*`.
It does not redefine Runtime execution semantics, consumer API ownership, host implementation details, or workflow substrate semantics.

Projection rule map:

- `S-RUNTIME-079` defines the projection-only ownership boundary.
- `S-RUNTIME-080` defines the stable shared event envelope projection.
- `S-RUNTIME-081` defines replay, checkpoint, and supervision projection limits.
- `S-RUNTIME-082` defines commit-request staging projection limits.
- `S-RUNTIME-083` defines the workflow-substrate leakage hardcut.
- `S-RUNTIME-084` defines the private-boundary and no-widening hardcut.

## S-RUNTIME-079 Projection-Only Ownership Boundary

`@nimiplatform/sdk` may expose typed projection for the World Evolution Engine only as a downstream mirror of `K-WEV-*`.

Therefore:

- Runtime remains the semantic owner for execution-event, replay, checkpoint, supervision, effect-stage, and commit-request staging semantics.
- SDK owns only the typed projection surface, naming of SDK-visible helper types, and packaging of normalized contract-visible Runtime shapes.
- SDK must not widen `eventKind`, `stage`, supervision outcome, replay mode, checkpoint meaning, or commit-request authority beyond what Runtime contract already defines.
- Any semantic change to World Evolution Engine execution rules must land in `K-WEV-*` first; SDK may only project the resulting normalized shape.

## S-RUNTIME-080 Shared Event Envelope Typed Projection

SDK stable top-level typed projection for World Evolution Engine events may expose only the contract-visible envelope defined by `K-WEV-010`.

The stable top-level SDK event projection is limited to:

- `eventId`
- `worldId`
- `appId`
- `sessionId`
- `traceId`
- `tick`
- `timestamp`
- `eventKind`
- `stage`
- `actorRefs`
- `causation`
- `correlation`
- `effectClass`
- `reason`
- `evidenceRefs`

Kind-specific detail may be projected only as a discriminated extension subordinate to the normalized envelope.
SDK must not promote the following to unconditional top-level shared-kernel truth:

- `schemaId`
- `schemaVersion`
- `scope`
- `runMode`
- Realm commit authorization result
- history-append authorization result
- workflow DAG/task/node identity
- workflow output event payload
- `route_policy`
- `fallback`
- bare `payload: Struct`

## S-RUNTIME-081 Replay / Checkpoint / Supervision Projection Boundary

SDK may project typed replay, checkpoint, and supervision surfaces only as normalized mirrors of contract-visible Runtime shapes required by `K-WEV-012`, `K-WEV-013`, and `K-WEV-014`.

Allowed projection families are limited to:

- replay mode/result/evidence-reference shapes that preserve V1 recorded-replay semantics
- checkpoint identifier/reference/restore-status shapes that remain explicitly Runtime-local
- supervision outcome projection using the closed Runtime-owned outcome set: `CONTINUE | DEFER | ABORT | QUARANTINE`

SDK must not expose as stable top-level truth:

- scheduler internals
- queue internals
- workflow node progress internals
- hidden re-inference controls
- route migration or fallback migration knobs
- checkpoint internals that are not already part of a contract-visible Runtime result

Missing required Runtime shape, missing required evidence reference, or unsupported enum value must fail-close.
SDK must not reinterpret absent Runtime evidence as successful replay, successful restore, or implicit supervision recovery.

## S-RUNTIME-082 Commit-Request Staging Typed Projection

SDK may project commit-request staging only as an explicit adapter-bound candidate/result surface derived from `K-WEV-015`.

The stable commit-request candidate projection may include only the Realm-envelope-compatible fields:

- `worldId`
- `appId`
- `sessionId`
- `effectClass`
- `scope`
- `schemaId`
- `schemaVersion`
- `actorRefs`
- `reason`
- `evidenceRefs`

SDK may additionally project Runtime-local staging references such as `sourceEventIds`, `traceId`, `tick`, `causation`, `correlation`, checkpoint references, or supervision references only when Runtime already emits them as explicit contract-visible metadata.

SDK must not:

- expose commit-request staging as a second write contract
- invent a new `runMode` surface
- imply SDK-side commit authorization ownership
- imply automatic history append ownership
- reinterpret adapter-bound candidate creation as canonical Realm mutation success

## S-RUNTIME-083 No Workflow Substrate Leakage

If Runtime implementation reuses workflow substrate internally, SDK stable surface must still project only `K-WEV-*` vocabulary.

The following must not appear as World Evolution Engine top-level SDK truth:

- `workflow`
- `task`
- `node`
- `edge`
- `callback_ref`
- `external_async`
- `route_policy`
- `fallback`
- workflow DAG identity
- workflow output event as canonical event truth

Workflow-derived implementation substrate may exist beneath Runtime internals, but SDK must not surface it as the top-level semantic model for World Evolution Engine execution.

## S-RUNTIME-084 Private Boundary And No-Widening Hardcut

World Evolution Engine SDK projection must remain satisfiable through SDK public surface only.

Therefore SDK must not:

- depend on `runtime/internal/**`
- depend on Realm private client or private transport
- depend on host-private bridge details
- depend on app-private or mod-private client state
- widen Runtime semantic vocabulary with SDK-only enum values or hidden fallback reinterpretation

Projection must remain fail-close:

- unknown or unsupported `eventKind`, `stage`, supervision outcome, or replay mode must error
- missing required Runtime envelope fields must error
- unsupported commit-request adapter fields must error
- SDK must not synthesize pseudo-success, default authority, or hidden semantic recovery

## Fact Sources

- `spec/runtime/kernel/world-evolution-engine-contract.md` — `K-WEV-001` through `K-WEV-016`
- `spec/platform/kernel/architecture-contract.md` — `P-ARCH-024` through `P-ARCH-028`
- `runtime-contract.md` — `S-RUNTIME-011`, `S-RUNTIME-073`
- `boundary-contract.md` — `S-BOUNDARY-001`, `S-BOUNDARY-002`
