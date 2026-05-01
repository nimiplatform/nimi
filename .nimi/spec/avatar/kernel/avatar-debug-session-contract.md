# Avatar Debug Session Contract

> Authority: Avatar Kernel
> Topic: `2026-05-01-desktop-avatar-configuration-debug-workbench`

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

Evidence shape is pinned by `tables/avatar-debug-session.schema.yaml`.

## Resolver Execution

Avatar performs package descriptor and backend capability profile resolver
execution after authorized Runtime/SDK projection.

Desktop stores opaque refs only. Runtime owns authorization and probe semantics.
SDK carries typed refs and methods only. No owner may create a second resolver
for Avatar backend files in this topic.

## Result Semantics

Avatar backend evidence can support a Runtime probe result, but Avatar does not
decide public Runtime probe status. Runtime owns the public probe result
envelope and replay semantics.

Unsupported backend capability is fail-closed evidence. It must not be reported
as success through idle fallback, `.vrma` playback, static image fallback, or
placeholder profile data.

## `.vrma` Position

`.vrma` remains interchange/authoring evidence only. It may appear in existing
VRM loader or asset evidence, but it is not debug success proof and not required
runtime support proof.

## Later Implementation Status

Wave-1 admits this contract and schema only. Avatar debug session runtime code
belongs to later waves and cannot claim product support before closeout.

