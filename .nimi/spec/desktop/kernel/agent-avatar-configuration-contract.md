# Agent Avatar Configuration Contract

> Authority: Desktop Kernel
> Topic: `2026-05-01-desktop-avatar-configuration-debug-workbench`

## Scope

This contract owns the Desktop Agent Chat Settings Avatar configuration product
surface. It defines what Desktop may store and present as a user-facing control
record for an agent avatar.

It does not own Avatar carrier truth, package descriptor resolution, backend
capability facts, Runtime probe semantics, Runtime authorization semantics, or
SDK transport shape.

## D-LLM-078 — Avatar Configuration Authority Home

Desktop MAY expose an Agent Chat Settings -> Avatar module for selecting and
reviewing avatar configuration.

Fixed rules:

- configuration is a Desktop product control record, not a launch payload
- `avatar_package_ref` and `backend_capability_profile_ref` are opaque refs
- Desktop MUST NOT dereference package descriptors or backend capability
  profiles
- Desktop MUST NOT create a local avatar carrier registry or per-agent local
  avatar binding truth
- package/profile resolver execution belongs to Avatar after authorized
  Runtime/SDK projection

## D-LLM-079 — Closed Configuration Record

The configuration record field set is closed and pinned by
`tables/agent-avatar-configuration.schema.yaml`.

Admitted fields:

- `agent_id`
- `conversation_anchor_scope`
- `avatar_package_ref`
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

- Desktop stores opaque refs and renders status.
- Runtime/SDK provide authorized account, agent, package, and probe projection.
- Avatar performs package descriptor and backend capability profile resolver
  execution and emits backend evidence.

No Desktop or Runtime contract admitted by this topic may become a second
Avatar backend file resolver.

## D-LLM-082 — D-LLM-069 And D-LLM-074 Reconciliation

D-LLM-069 renderer-local debug override remains renderer-local unless a later
wave explicitly retires or promotes it through a typed public contract. This
configuration contract does not expose that override through SDK, Runtime, mod,
or public app surfaces.

D-LLM-074 remains delegated-capability placement authority. Avatar
configuration may appear in the same product area, but delegated provider
profiles, approvals, firewall verdicts, and replay remain Runtime-owned.

## D-LLM-083 — Fail-Closed Configuration State

Configuration status MUST fail closed when required typed evidence is missing.

Desktop MUST distinguish:

- no package ref selected
- package ref selected but unresolved by authorized projection
- backend profile missing
- backend profile unsupported
- generated motion provider unavailable
- launch not ready
- probe required before launch

Unsupported or missing capability is not success and must not fall back to idle
motion, local binding, or static carrier proof.

## Traceability

- `.nimi/spec/desktop/kernel/agent-avatar-surface-contract.md`
- `.nimi/spec/desktop/kernel/agent-delegation-control-surface-contract.md`
- `.nimi/spec/runtime/kernel/avatar-debug-projection-contract.md`
- `.nimi/spec/sdk/kernel/runtime-avatar-control-client-contract.md`
- `.nimi/spec/avatar/kernel/avatar-debug-session-contract.md`

