# Agent Avatar Configuration Contract

> Authority: Desktop Kernel
> Topic: `2026-05-01-desktop-avatar-configuration-debug-workbench`

## Scope

This contract owns the Desktop Agent Chat Settings Avatar configuration product
surface. It defines what Desktop may store and present as a user-facing control
record for an agent avatar.

It does not own Avatar carrier truth, remote package descriptor resolution,
backend capability facts, Runtime probe semantics, Runtime authorization
semantics, or SDK transport shape.

## D-LLM-078 — Avatar Configuration Authority Home

Desktop MAY expose an Agent Chat Settings -> Avatar module for selecting and
reviewing avatar configuration.

Fixed rules:

- configuration is a Desktop product control record, not a launch payload
- `local_avatar_asset_ref` and `backend_capability_profile_ref` are opaque refs
- Desktop MUST validate local Avatar asset materialization before launch, but
  MUST NOT dereference remote package descriptors or own backend capability
  profile truth
- Desktop MUST NOT create a local avatar carrier registry or per-agent local
  avatar binding truth
- local asset resolver execution belongs to Avatar after Runtime validates the
  launch agent selector

## D-LLM-079 — Closed Configuration Record

The configuration record field set is closed and pinned by
`tables/agent-avatar-configuration.schema.yaml`.

Admitted fields:

- `agent_id`
- `conversation_anchor_scope`
- `local_avatar_asset_ref`
- `live2d_adapter_manifest_source`
- `live2d_adapter_manifest_ref`
- `avatar_instance_policy`
- `backend_kind`
- `backend_capability_profile_ref`
- `generated_motion_provider_policy`
- `launch_mode`
- `debug_profile`
- `updated_at`
- `provenance`

Forbidden fields:

- package path, package descriptor, package id in launch context, or asset bytes
- account id, user id, Realm URL, token, refresh token, JWT, or auth payload
- scoped avatar binding id or carrier registry id
- raw APML, MCP/A2A, delegated provider, Desktop app, or business data payload
- backend command strings intended for Avatar execution
- raw Live2D adapter manifest payload, absolute source path, semantic
  compatibility verdict, computed tier, or Avatar diagnostic code ownership

## D-LLM-079a Cross-Reference — `launch_mode` Actuation Authority

The `launch_mode` field in the closed configuration record is declarative only.
`launch_mode='start_with_chat'` actuation is owned by
`agent-avatar-surface-contract.md` **D-LLM-105** (the eight-condition
auto-launch gate), and `avatar_instance_policy` launch-time arbitration is owned
by **D-LLM-106**. This configuration contract stores and presents the record; it
does not own the launch-decision behavior and must not re-derive a second
auto-launch gate or instance-arbitration path.

## D-LLM-080 — Launch Payload Hard Cut

Desktop configuration MUST NOT widen Avatar launch payload.

Default Avatar launch payload remains:

- `agent_id`
- optional `avatar_instance_id`
- optional non-authoritative `launch_source`

The configuration record may influence later typed Runtime/SDK/Avatar resolver
work, but it must not be copied into the launch payload and must not be used as
fallback carrier truth when resolver evidence is missing.

## D-LLM-081 — Resolver Ownership

Resolver ownership is single-cut:

- Desktop stores local asset refs and renders validation status.
- Runtime/SDK provide authorized account, agent, optional secondary package,
  and probe projection.
- Avatar performs local asset resolver execution and emits backend evidence.

No Desktop or Runtime contract admitted by this topic may become a second
Avatar backend file resolver.

External Live2D adapter sidecar custody is a Desktop storage operation only:

- Desktop MAY copy an explicitly selected JSON file into the host-local Agent
  Center store and persist an opaque `live2d_adapter_manifest_ref`.
- Desktop MAY verify that the file is a JSON object with
  `manifest_kind: "nimi.avatar.live2d.adapter"` and `schema_version: 1` for
  storage classification.
- Desktop MUST NOT compute compatibility tier, feature disposition,
  `AVATAR_LIVE2D_COMPAT_*` diagnostics, package descriptor truth, or carrier
  readiness from that file.
- The configuration record MUST select exactly one source posture: `none`,
  `embedded_creator_manifest`, or `external_sidecar_manifest`. Embedded and
  external manifests must not be merged or silently preferred.

## D-LLM-082 — D-LLM-069 And D-LLM-074 Reconciliation

D-LLM-069 renderer-local debug override remains renderer-local unless a later
wave explicitly retires or promotes it through a typed public contract. This
configuration contract does not expose that override through SDK, Runtime, or
public app surfaces.

D-LLM-074 remains delegated-capability placement authority. Avatar
configuration may appear in the same product area, but delegated provider
profiles, approvals, firewall verdicts, and replay remain Runtime-owned.

## D-LLM-083 — Fail-Closed Configuration State

Configuration status MUST fail closed when required typed evidence is missing.

Desktop MUST distinguish:

- no local Avatar asset selected
- local Avatar asset selected but unresolved by local materialization
- backend profile missing
- backend profile unsupported
- generated motion provider unavailable
- launch not ready
- probe required before launch

Unsupported or missing capability is not success and must not fall back to idle
motion, local binding, or static carrier proof.

## D-LLM-099 — Avatar Local Asset Control Surface Boundary

Desktop MAY present local Avatar asset controls for private Live2D / VRM import,
selection, and status. Local import is the primary Avatar asset path.

Desktop MUST NOT become a package registry, package lifecycle authority,
package inventory authority, activation authority, review authority, or local
remote-package carrier registry.

Avatar 启动只保留本地资产路径；远程 marketplace package 来源已随 Asset Market
撤回退役，Desktop 不得引入任何替代远程包获取入口。

## D-LLM-100 — Opaque Ref Storage

Desktop persisted configuration may store only local Avatar asset refs, source
provenance, and bounded status summaries:

- `local_avatar_asset_ref` or current storage-equivalent local selection ref
- `backend_capability_profile_ref`
- selected `backend_kind`
- readiness/status summary
- typed diagnostic ids
- user-visible selection provenance

Desktop MUST NOT persist or pass package descriptors, package file paths,
package bytes, backend runtime roots, Agent Center materialization paths, local
activation bindings, or any retired marketplace API payloads as configuration
truth.

## D-LLM-101 — Acquisition And Import UX

Desktop MAY initiate private local Live2D / VRM import into the local Avatar
asset store. Remote marketplace acquisition surfaces are retired (Asset Market
withdrawn); Desktop must not reintroduce them.

Desktop MUST NOT create:

- a browser-reachable Avatar-local install endpoint
- a Petdex-style local driver protocol
- a Desktop-owned package install daemon
- a direct filesystem activation path outside the admitted local Avatar asset
  import/materialization flow
- an Agent Center package inventory surface

## D-LLM-102 — Readiness And Failure UX

Desktop readiness UX MUST fail closed when local asset or capability evidence
is missing.

Desktop MUST distinguish:

- no local Avatar asset selected
- local Avatar asset selected but unresolved by local materialization
- unsupported `backend_kind`
- missing backend capability profile
- missing renderer entry file
- blocking compatibility diagnostic
- local materialization unavailable
- probe required before launch

Desktop MUST NOT translate missing evidence into idle motion, static carrier
success, local binding success, or launch-ready status.

## D-LLM-103 — Launch Payload And Resolver Hard Cut

Avatar local asset controls MUST NOT widen the Avatar launch payload.

Desktop may store local Avatar asset selection refs in its configuration record
and may render status from typed projections. Actual renderer file resolution,
backend capability profile resolution, and local materialized file use belong
to Avatar after Runtime validates `agent_id` and the local agent projection.

Agent Center resolver plumbing, when present, is local Avatar asset
materialization storage only. It is not remote package authority.

## Traceability

- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
- `.nimi/spec/desktop/kernel/agent-delegation-control-surface-contract.md`
- `.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`
- `.nimi/spec/sdk/kernel/runtime-avatar-control-client-contract.md`
- `.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`
