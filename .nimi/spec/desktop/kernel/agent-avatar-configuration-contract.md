# Agent Avatar Configuration Contract

> Authority: retired Desktop Kernel host-transport boundary

## Scope

This contract is retained only to mark the Desktop-owned Agent Center avatar
configuration schema as retired.

Desktop no longer owns an Agent Center local config schema, app-local
Live2D/VRM/background import store, reusable resource-management command
surface, preview assembly, or selection persistence.

Current owner split:

- Runtime `AgentPresentationProfile` owns avatar ref, background ref, default
  voice, and avatar autoplay selection truth.
- Kit Shell standard `agent-center` capability owns host-local asset bytes,
  validation, local asset URL serving, Live2D adapter asset-scoped sidecar
  association, and scoped resource removal.
- Avatar owns Agent Center preview-service rendering, carrier visual proof,
  backend readiness, calibration effects, and launch payload truth.
- Desktop owns Agent Center placement, scoped Runtime/SDK adapter attachment,
  app chrome, copy namespace, and real app evidence hooks only.

## D-LLM-078 Retired Avatar Configuration Authority Home

Desktop may place Kit Agent Center for avatar/background selection and review.
It must not persist Agent Center avatar/background/default-voice/autoplay
selection, local asset refs, Live2D adapter sidecar refs, launch policy,
debug profile, generated motion policy, or background selection in a
Desktop-owned config record.

Import completion writes selection through Runtime
`SetAgentPresentationProfile`. Reusable import, validation, local asset URL
serving, and resource cleanup belong to Kit Shell standard `agent-center`
operations.

## D-LLM-079 Retired Configuration Record

`tables/agent-avatar-configuration.schema.yaml` is retired without replacement.
The retired fields are not migrated:

- `local_avatar_asset_ref`
- `live2d_adapter_manifest_source`
- `live2d_adapter_manifest_ref`
- `live2d_calibration_ref`
- `avatar_instance_policy`
- `backend_kind`
- `backend_capability_profile_ref`
- `generated_motion_provider_policy`
- `launch_mode`
- `debug_profile`
- `local_history`
- `ui.last_section`

The following remain forbidden as Desktop Agent Center configuration truth:

- package descriptors, package paths, package bytes, launch-local asset ids, or
  raw asset bytes
- account/session/auth material
- scoped avatar binding ids or carrier registry ids
- raw APML, MCP/A2A, delegated provider, Desktop app, or business payloads
- backend command strings intended for Avatar execution
- raw Live2D adapter manifest payloads, absolute source paths, compatibility
  tiers, Avatar diagnostic truth, calibration payloads/values, model digests,
  preview artifact refs, render scale, target FPS, performance policy, and
  expression inventory

## D-LLM-080 Launch Payload Hard Cut

Desktop configuration must not widen Avatar launch payload. Avatar launch and
carrier readiness remain Avatar/Runtime-owned.

## D-LLM-081 Resolver Ownership

Resolver ownership is single-cut:

- Runtime `AgentPresentationProfile` owns selected refs.
- Kit Shell owns host-local Agent Center asset custody and local URL serving.
- Avatar owns preview, materialization, backend readiness, calibration, and
  carrier proof.
- Desktop owns placement and evidence hooks only.

Desktop must not implement a second Avatar backend file resolver, local carrier
registry, per-agent local avatar binding truth, or Agent Center resource store.

## D-LLM-082 Retired Debug Override Reconciliation

The former Desktop Agent Center avatar configuration record no longer exposes
renderer-local debug override policy. Any debug or calibration surface must
remain outside Agent Center product UI unless a separate Runtime/Avatar
authority admits it.

## D-LLM-083 Fail-Closed Configuration State

The retired Desktop configuration record cannot be used to manufacture a
ready-looking Agent Center state. Desktop must fail closed when Runtime
presentation refs, Kit Shell custody resolution, or Avatar preview-service
evidence is unavailable.

## D-LLM-099 Avatar Local Asset Control Surface Boundary

Desktop may expose local Avatar asset controls only by placing Kit Agent
Center. The controls use Kit Shell standard `agent-center` operations and
Runtime `AgentPresentationProfile` writes.

Desktop must not create:

- a browser-reachable Avatar-local install endpoint
- a Petdex-style local driver protocol
- a Desktop-owned package install daemon
- a direct filesystem activation path outside the admitted Kit Shell custody
  flow
- an Agent Center package inventory surface

## D-LLM-100 Opaque Ref Storage

Desktop must not store Agent Center opaque refs as Desktop configuration truth.
Opaque refs are either Runtime presentation refs or Kit Shell custody refs.

## D-LLM-101 Acquisition And Import UX

Desktop may initiate private local Live2D/VRM import only through Kit Agent
Center and Kit Shell standard `agent-center` operations. Remote marketplace
acquisition surfaces remain retired.

## D-LLM-102 Readiness And Failure UX

Desktop readiness UX must fail closed when Runtime profile refs do not resolve
through Kit Shell or Avatar preview evidence is missing. Desktop must not
translate missing evidence into idle motion, static carrier success, local
binding success, or launch-ready status.

## D-LLM-103 Launch Payload And Resolver Hard Cut

Selection refs are Runtime profile truth, host-local asset custody belongs to
Kit Shell, and preview/render evidence belongs to Avatar. Desktop must not copy
those fields into launch payloads or app-local carrier truth.

## D-LLM-104 Live2D Calibration Ref Boundary

Desktop must not render or maintain a Live2D calibration or debug-control
surface inside Agent Center. Any future calibration effect must go through an
admitted Runtime/SDK/Avatar projection, never through Desktop launch handoff or
app-local carrier truth.

## Traceability

- `.nimi/spec/platform/kernel/agent-center-contract.md`
- `.nimi/spec/runtime/kernel/agent-presentation-contract.md`
- `.nimi/spec/runtime/kernel/voice-contract.md`
- `.nimi/spec/avatar/kernel/carrier-visual-acceptance-contract.md`
- `.nimi/spec/sdks/kernel/runtime-avatar-control-client-contract.md`
