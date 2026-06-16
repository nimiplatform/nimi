# Avatar Debug Session Contract

> Authority: Avatar Kernel

## Purpose

This contract admits Avatar-owned debug session intake and backend evidence for
Desktop Avatar configuration/debug workbench flows. Avatar consumes typed
Runtime probe envelopes and emits backend evidence. Avatar does not own Runtime
probe semantics, Desktop configuration UX, SDK method shape, APML public wire,
or delegated provider access.

## Avatar Debug Session Boundary

Avatar MAY accept typed debug sessions that reference:

- Runtime probe id
- authorized agent id
- optional avatar instance id
- typed package/profile refs
- backend kind
- probe kind

Avatar MUST NOT accept:

- package descriptors supplied in Desktop launch payload
- package paths supplied by Desktop launch payload
- scoped Desktop binding truth
- raw APML parser events
- raw MCP/A2A/delegated provider output
- raw app/business data
- tokens, account ids, user ids, Realm URLs, or auth material
- backend command strings from Desktop

## Backend Evidence

Avatar owns backend evidence for:

- package descriptor resolver execution
- backend load outcome
- backend capability profile validation
- generated motion route support
- emotion/expression support
- speech/lipsync support
- carrier diagnostics and hit region evidence
- Avatar-owned carrier visual readiness refs, including official-SDK Live2D
  preview artifact refs where the backend provides them
- Avatar-owned Live2D expression inventory refs where emotion/expression
  support is claimed by the loaded Live2D backend
- Avatar-owned Live2D backend evidence pack refs for backend load,
  compatibility/capability profile, route support, speech/lipsync,
  hit-region readiness, and parameter-lane diagnostics
- opaque Live2D calibration refs projected by the Avatar local asset resolver
  as read-only, effect-blocked evidence

Evidence shape is pinned by `tables/avatar-debug-session.schema.yaml`.

## Resolver Execution

Avatar performs package descriptor and backend capability profile resolver
execution after authorized Runtime/SDK projection. Current Agent Center resolver
plumbing may materialize local files, but it is not package lifecycle,
inventory, or activation authority.

Desktop stores opaque refs only. Runtime owns authorization and probe semantics.
SDK carries typed refs and methods only. No owner may create a second resolver
for Avatar backend files in this debug-session boundary.

`live2d_calibration_ref`, when present, is resolver evidence only. It is not a
calibration payload, not model digest truth, not render/framing policy, and not
carrier effect authority.

## Result Semantics

Avatar backend evidence can support a Runtime probe result, but Avatar does not
own public Runtime probe semantics. Avatar may submit an evidence-backed probe
result only through Runtime's typed submit path. Runtime validates the agent,
anchor, probe kind, result status, permission scope, scoped binding attachment,
and evidence refs before accepting the public probe result envelope.

Runtime owns replay semantics and final public diagnostic projection. Avatar
owns the local backend debug session evidence that it submits by ref.

Unsupported backend capability is fail-closed evidence. It must not be reported
as success through idle fallback, `.vrma` playback, static image fallback, or
placeholder profile data.

## `.vrma` Position

`.vrma` remains interchange/authoring evidence only. It may appear in existing
VRM loader or asset evidence, but it is not debug success proof and not required
runtime support proof.

## Implementation Availability Boundary

This contract admits Avatar debug session authority and schema only. Avatar
debug session runtime code, SDK methods, Desktop UI, and product support
require their own implementation and test evidence before support is claimed.
