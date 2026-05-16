# Avatar Package Consumption Contract

> Authority: Avatar Kernel
> Topic: `2026-05-16-avatar-asset-distribution-admission`

## Scope

This contract owns how `apps/avatar` consumes an authorized Avatar visual
package after upstream package, account, agent, and configuration projections
have admitted it.

It does not own package discovery, acquisition, import, publish, review,
takedown, ranking, library inventory, account entitlement, Desktop
configuration, or SDK transport truth.

## Authority Boundary

Avatar consumes Asset Market `Package` records with `package_kind: "avatar"`.

Avatar MUST NOT define a second package manifest, package lifecycle, package
status enum, package library inventory, installed package id, activation
binding, update channel, rollback record, review decision, or UGC submission
identity.

## Accepted Package Shape

Avatar may attempt package consumption only when the authorized projection
contains:

- `package_kind: "avatar"`
- `backend_kind: "live2d"` or `backend_kind: "vrm"`
- `backend_capability_profile_ref`
- `avatar_model_layout`
- `provenance`
- compatibility diagnostics
- local materialization evidence or a resolver ref capable of producing it

`sprite2d`, `canvas2d`, and `video` are not launched Avatar backend kinds.

## Resolver Execution

Avatar owns backend file resolver execution after authorized projection.

Resolver execution may turn opaque refs into local materialized Live2D or VRM
files for renderer use. Resolver execution MUST NOT promote the local
materialization store, Agent Center plumbing, filesystem paths, or cache records
into package lifecycle, inventory, activation, or publish truth.

## Fail-Closed Consumption

Avatar MUST refuse package consumption when:

- package kind is missing or not `avatar`
- backend kind is unsupported
- backend capability profile is missing
- Avatar model layout is missing or malformed
- required assets are missing from the resolved bundle
- compatibility diagnostics include a blocking code
- local materialization is unavailable
- authorized projection evidence is absent or stale

Refusal must render the admitted degraded surface. It must not fall back to a
fixture carrier, legacy Sprite2D, static image, or local default package.

## Backend Branch Linkage

Avatar package consumption is downstream of
`.nimi/spec/avatar/kernel/backend-branch-contract.md`.

Package consumption MUST NOT widen `BackendKind`. New package kinds, preview
renderers, or import diagnostics may be admitted through Asset Market contracts,
but launched Avatar backend execution remains the closed `live2d | vrm` union
until `backend-branch-contract.md` is explicitly redesigned.

