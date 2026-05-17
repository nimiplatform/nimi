# Avatar Local Asset Consumption Contract

> Authority: Avatar Kernel
> Topic: `2026-05-16-avatar-asset-distribution-admission`

## Scope

This contract owns how `apps/avatar` consumes a selected local Avatar asset for
Live2D / VRM carrier launch.

Local import is the primary product path. A user-owned Live2D or VRM resource
may enter the local Avatar asset store through private file import, or through
a future Realm / Asset Market subscription or download. After materialization,
both sources are consumed through the same local asset resolver and renderer
path.

This contract does not own package discovery, acquisition, publish, review,
takedown, ranking, account entitlement, or remote package lifecycle truth.

## Authority Boundary

Avatar consumes local Avatar assets, not remote package records.

Avatar MUST NOT define a second remote package manifest, package lifecycle,
package status enum, package library inventory, installed package id, remote
activation binding, update channel, rollback record, review decision, or UGC
submission identity.

Realm / Asset Market `Package` records with `package_kind: "avatar"` are an
optional upstream source. They become launchable only after they are acquired
or downloaded and materialized into the same local Avatar asset store used by
private imports.

## Accepted Local Asset Shape

Avatar may attempt local asset consumption only when the selected local asset
can resolve to:

- `backend_kind: "live2d"` or `backend_kind: "vrm"`
- materialized local files under the admitted Avatar asset store
- a renderer entry file (`.model3.json` for Live2D, `.vrm` for VRM)
- optional Avatar-local adapter / motion / metadata files under the same
  materialized asset root
- local resolver evidence that binds the selection to the current validated
  local agent

`sprite2d`, `canvas2d`, and `video` are not launched Avatar backend kinds.

## Resolver Execution

Avatar owns local asset resolver execution after Runtime validates the launch
`agent_id` and Runtime / SDK provide the current agent/session projection.

Resolver execution may turn a local Avatar asset selection into materialized
Live2D or VRM files for renderer use. Resolver execution MUST NOT promote the
local materialization store, Agent Center plumbing, filesystem paths, or cache
records into remote package lifecycle, inventory, activation, publish, or
review truth.

## Consumption Evidence

After Runtime validation and local asset resolver execution both succeed,
Avatar emits `avatar.visual.local-asset-resolved`.

The evidence detail must carry only consumer-safe local asset facts:

- `local_asset_ref`
- `backend_kind`
- `asset_authority: "local_avatar_asset"`
- `resolver_authority: "avatar_local_materialization"`
- current `avatar_instance_id` and `conversation_anchor_id`

The evidence detail must not include package descriptors, remote package
records, package file paths, package bytes, backend runtime roots, Agent Center
inventory records, remote activation bindings, or publish / review lifecycle
state.

Product smoke evidence for a launched carrier must require same-anchor
`avatar.visual.local-asset-resolved` before accepting `avatar.model.load` and
visible carrier evidence as a pass.

## Fail-Closed Consumption

Avatar MUST refuse local asset consumption when:

- no local Avatar asset is selected for the validated local agent
- backend kind is unsupported
- renderer entry file is missing or malformed
- required assets are missing from the materialized root
- compatibility diagnostics include a blocking code
- local materialization is unavailable
- resolver evidence is absent, stale, or scoped to another agent

Refusal must render the admitted degraded surface. It must not fall back to a
fixture carrier, legacy Sprite2D, static image, or local default package.

## Backend Branch Linkage

Avatar local asset consumption is downstream of
`.nimi/spec/avatar/kernel/backend-branch-contract.md`.

Local asset consumption MUST NOT widen `BackendKind`. New package kinds,
preview renderers, import diagnostics, or marketplace sources may be admitted
through Asset Market or future import contracts, but launched Avatar backend
execution remains the closed `live2d | vrm` union until
`backend-branch-contract.md` is explicitly redesigned.
