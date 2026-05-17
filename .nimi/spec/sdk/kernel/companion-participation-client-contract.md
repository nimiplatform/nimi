# Companion Participation Client Contract

> Owner Domain: `S-RUNTIME-*`

This contract defines the SDK typed client boundary for companion participation
projection and bounded controls.

## S-RUNTIME-227 Typed Projection Only

The SDK must expose companion participation data as typed projection objects
matching Runtime-owned `CompanionParticipationProjection`. It must not expose
raw prompt blobs, provider payloads, raw APML/debug payloads, MCP/A2A payloads,
or domain state blobs as the primary companion surface API.

## S-RUNTIME-228 Control Surface Methods

Runtime SDK must expose companion participation through the typed module
`runtime.companionParticipation`. The module owns the SDK product API and must
provide:

- `getProjection`
- `request`
- `cancel`
- `openReplay`

Each control must route to Runtime-owned participation or replay RPC methods.
The SDK must not implement app-local execution, prompt assembly, provider/model
routing, memory write, cognition write, or domain commit.

SDK entrypoints must also export `decodeCompanionParticipationProjection` for
strict projection decoding and the generated companion participation enum
types. The generated protobuf shape is not the primary application API.

## S-RUNTIME-229 Fail-Closed Decoding

SDK decoders must fail closed on:

- unknown `surface_kind`
- unknown `trigger_source`
- unknown `status`
- missing `profile_ref` for execution requests
- missing `room_orchestration_ref` for domain contexts
- missing `candidate_ref` for `candidate_ready`
- missing `commit_ref` for `committed_by_owner`

## S-RUNTIME-230 Candidate Boundary

The SDK must preserve the distinction between Runtime candidate projection and
domain/canonical commit projection. It must not infer commit from candidate text
or app-side display state.
