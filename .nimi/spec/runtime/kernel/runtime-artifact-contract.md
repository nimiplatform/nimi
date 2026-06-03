# Runtime Artifact Contract

source_rule: K-AGCORE-053

## Purpose

Runtime owns artifact identity. Consumer apps (avatar, desktop, future
clients) must be able to retrieve artifact bytes by `artifact_id` for
artifacts emitted in runtime events (e.g.
`voice_playback_requested.audio_artifact_id`,
`lipsync_frame_batch.audio_artifact_id`). This contract admits the
authoritative read-bytes-by-id surface as a generic capability,
orthogonal to existing typed media projections
(`getScenarioArtifacts(jobId)` per S-RUNTIME-073) and voice asset
library (`getVoiceAsset`).

## K-AGCORE-053 Runtime Artifact Bytes Retrieval

Runtime must expose a generic `ReadArtifactBytes` RPC that returns the
full artifact body for a given `artifact_id`. The RPC and its supporting
identity / lifecycle / fail-close semantics are admitted as fixed rules.

### Identity

`artifact_id` is a runtime-owned, opaque, globally-unique identity emitted in
runtime events (e.g. `voice_playback_requested.audio_artifact_id`). Consumers
must treat it as a string; format may evolve. The runtime guarantees:

- artifact_id is stable for the lifetime of the artifact
- artifact_id namespace is flat (not hierarchical); no jobId/scenarioId prefix
  required for retrieval
- artifact_id is unique within a runtime instance; across runtime instances
  uniqueness is not guaranteed (consumers must scope retrieval to their
  authoritative runtime client)

### Lifecycle

artifact lifecycle is owned by runtime:

- created when a runtime-side producer (TTS provider / scenario job / realtime
  session / local voice engine / cache / streaming TTS / user upload) materializes bytes
- referenced by emit events (e.g. voice_playback_requested) carrying its id
- bytes retrieval is best-effort idempotent: same id returns same bytes if
  artifact still in storage
- TTL / GC / quota policies are runtime implementation detail; consumers
  receive `ARTIFACT_NOT_FOUND` reason code if artifact has been garbage
  collected before retrieval
- emitter-side invariant: `Store.Put(artifact_id, bytes, mime_type)` must
  complete BEFORE the runtime emit event referencing the id (e.g.
  `voice_playback_requested`); violation logs fatal at the emitter site

### ReadArtifactBytes RPC

Carried over `RuntimeArtifactService` (per `Runtime<Domain>Service` naming
convention shared by `RuntimeAccountService`, `RuntimeAgentService`,
`RuntimeAiService`, `RuntimeAuthService`, etc.).

`ReadArtifactBytesRequest`:

- `artifact_id: string` (required)

`ReadArtifactBytesResponse`:

- `bytes: bytes` (required) — full artifact body
- `mime_type: string` (required) — RFC-6838 media type; must be present even if
  upstream provider didn't declare one (runtime fills `application/octet-stream`
  in that case but flags `mime_inferred: true`)
- `size_bytes: int64` (required) — artifact total size
- `mime_inferred: bool` (optional default false) — true if mime_type was
  runtime-inferred rather than provider-declared

### Reason Codes

All reason codes are admitted in `tables/reason-codes.yaml` ARTIFACT family
under `source_rule: K-AGCORE-053`. Numeric values 600..604:

- `ARTIFACT_INVALID_INPUT` (600): caller request validation failed (empty
  artifact_id, etc.)
- `ARTIFACT_NOT_FOUND` (601): id not in runtime storage (gc / never created /
  cross-runtime)
- `ARTIFACT_TOO_LARGE` (602): artifact exists but exceeds inline retrieval
  limit (32 MiB hard ceiling for this admission; chunked retrieval requires
  future authority)
- `ARTIFACT_FORBIDDEN` (603): caller has no read permission (multi-tenant scope
  violation; reserved — current single-runtime deployment never returns this)
- `ARTIFACT_MIME_MISMATCH` (604): SDK-side check; client passed
  `expected_mime_prefix` and stored artifact mime_type does not start with
  the prefix (case-insensitive). Server never returns this reason; SDK
  raises it after receiving response.

Runtime handlers must return reason codes via
`grpcerr.WithReasonCode(codes.X, runtimev1.ReasonCode_ARTIFACT_*)`
per K-ERR-003 (ReasonCode in ErrorInfo details, not in status message
string).

### Size Cap

inline retrieval is hard-capped at 32 MiB. Larger artifacts return
`ARTIFACT_TOO_LARGE` even though the bytes exist. This contract does not
admit chunked retrieval; chunked retrieval requires a future authority update
before implementation.

### Caching

runtime is not required to cache; consumers should not assume cheap repeated
reads. Avatar consumer pattern: read once per voice_playback_requested,
decode to AudioBuffer, drop reference. Re-read same id only if previous
buffer was discarded.

### Trust Model

- caller is a trusted runtime client (avatar / desktop / first-party app);
  authorization is the same trust model as existing
  `getScenarioArtifacts(jobId)` and `getVoiceAsset` (single-process /
  single-user / single-tenant deployment).
- multi-tenant ACL / RBAC is reserved future; `ARTIFACT_FORBIDDEN`
  reason code is admitted but never returned by current deployment.

## Backward Compatibility

artifact_id namespace exists today (emitted in `voice_playback_requested`
and `lipsync_frame_batch` per
[`tables/runtime-agent-event-projection.yaml`](tables/runtime-agent-event-projection.yaml)).
This contract is the first authoritative read-bytes SDK surface for it.
Existing `getScenarioArtifacts(jobId)` (S-RUNTIME-073 typed projection)
and `getVoiceAsset` remain admitted for their distinct use cases (job-typed
media result projection / voice asset library).

## Drift Resistance

- ReasonCode ARTIFACT family must be admitted in three places synchronously
  (proto `common.proto` enum + `tables/reason-codes.yaml` + SDK
  `sdk/src/types/index.ts` ReasonCode const); spec validator enforces.
- emitter-side `Store.Put` must precede emit event; absence logs fatal.
- runtime handler must use `grpcerr.WithReasonCode`, not status.Error
  message string.
- SDK consumer surface must be class-member shape (`Runtime.artifacts.readBytes`),
  not singleton const export.
- inline size cap 32 MiB is hard; larger artifacts must fail-close
  `ARTIFACT_TOO_LARGE` (no silent truncation).

## Out of Scope (requires future authority)

- artifact governance: TTL / GC / quota enforcement
- multi-tenant artifact ACL
- chunked retrieval (streaming bytes)
- artifact metadata API (`describeArtifact`)
- by-tag / by-source artifact discovery
- artifact upload by id (`uploadArtifact` already exists with distinct semantics)
- platform-side `lipsync_frame_batch` deprecation
