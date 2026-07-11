# Runtime Artifact Contract

source_rule: K-AGCORE-053

## Purpose

Runtime owns artifact identity and read audience. Authorized consumer apps
must be able to retrieve artifact bytes by `artifact_id` for
artifacts emitted in runtime events (e.g.
`voice_playback_requested.audio_artifact_id`,
`lipsync_frame_batch.audio_artifact_id`). This contract admits the
authoritative read-bytes-by-id surface only when the current protected caller
matches the durable artifact audience,
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
- artifact_id is a selector, never a credential or authorization proof; a
  guessed, observed, replayed, or cross-app id cannot authorize a read

### Lifecycle

artifact lifecycle is owned by runtime:

- created when a runtime-side producer (TTS provider / scenario job / realtime
  session / local voice engine / cache / streaming TTS / user upload) materializes bytes
- referenced by emit events (e.g. voice_playback_requested) carrying its id
- bytes retrieval is best-effort idempotent: same id returns same bytes if
  artifact still in storage
- TTL / GC / quota policies are runtime implementation detail except for
  generated agent voice artifacts admitted by `K-VOICE-020`, which must remain
  durable on the user's local disk until explicit user cleanup or a later
  admitted quota policy removes them
- emitter-side invariant: `Store.Put(artifact_id, bytes, mime_type)` must
  complete BEFORE the runtime emit event referencing the id (e.g.
  `voice_playback_requested`); violation logs fatal at the emitter site
- every record exposed through `ReadArtifactBytes` binds producer job, owner
  account, initiating app, release digest, installed session, account
  generation, allowed use, observed byte size, content SHA-256 and expiry
- internal or historical records without that complete audience may remain in
  Runtime-owned storage but are not externally readable and fail closed
- once an artifact id is written, bytes, MIME, observed size, content hash and
  audience are immutable. The generated-voice producer may atomically enrich
  an otherwise identical record from absent metadata to its complete
  `GeneratedVoiceArtifactMetadata` before the referencing event; it cannot
  replace content or audience.

### Voice Artifact Identity

Generated assistant voice artifact ids must identify playable audio bytes only.

Fixed rules:

- `voice_playback_requested.detail.audio_artifact_id` must resolve through
  `ReadArtifactBytes` to bytes whose returned `mime_type` starts with `audio/`
  unless the event is a terminal failed/interrupted/canceled state that carries a
  reason and is not requesting playback.
- Runtime must not store lipsync metadata, timing metadata, debug records, or
  synthetic placeholders under the same id used as a playable audio artifact id.
- Provider-returned audio artifact identity must not be overwritten by
  runtime-generated lipsync metadata.
- If Runtime emits separate lipsync/timing/debug artifacts, those ids must be
  distinct from the audio artifact id and must declare their own mime type.
- A text-only fallback or unavailable TTS route must not create a pseudo audio
  artifact and must not emit a playable voice request.

### Generated Agent Voice Retention

Generated assistant voice audio is a durable local Runtime artifact class.

Minimum stored metadata for this class:

- `agent_id`
- `conversation_anchor_id`
- `turn_id`
- `message_id`
- `voice_reference`
- `speech_model_id`
- `route_policy`
- `mime_type`
- `byte_digest`
- `created_at`
- `retention_scope`

Runtime must provide a cleanup surface for generated voice artifacts by:

- `agent_id`
- `conversation_anchor_id`

Cleanup removes durable audio bytes and associated voice-artifact metadata. It
does not mutate committed text messages or conversation history.

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

### CleanupGeneratedVoiceArtifacts RPC

Carried over `RuntimeArtifactService`.

`CleanupGeneratedVoiceArtifactsRequest`:

- `agent_id: string` (optional selector)
- `conversation_anchor_id: string` (optional selector)

At least one selector is required. If both selectors are supplied, Runtime must
delete only generated voice artifacts that match both. The call is idempotent:
no matching generated voice artifacts returns `deleted_count=0`.

`CleanupGeneratedVoiceArtifactsResponse`:

- `deleted_count: int32`
- `deleted_artifact_ids: repeated string`

This RPC is restricted to generated assistant voice artifacts whose metadata
declares the `generated_agent_voice` retention scope. It must not delete
scenario image/video/music artifacts, uploaded user files, committed text
messages, or conversation history.

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
- `ARTIFACT_FORBIDDEN` (603): the protected caller is absent/revoked/expired or
  its account, app, release, session, generation, allowed use or artifact
  audience does not match
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

- `ReadArtifactBytes` requires the current Account-owned installed-caller
  decision and a matching durable artifact audience; app/session metadata,
  ordinary local gRPC and artifact-id possession are non-authorizing.
- Runtime revalidates the live process, account generation and durable
  installed session before the artifact lookup, then matches account/app/
  release/session/generation/use/expiry before returning bytes.
- unbound historical records, direct local gRPC, wrong app/account/release/
  session, expired or revoked records and guessed ids fail closed.
- capability/grant admission is an additional gate. The admitted mapping is
  `data.scope.read` qualified by `runtime.artifacts`; the Account-owned
  evaluator revalidates the protected catalog ceiling, current inventory,
  highest-version live grant and active release on every read before the
  durable artifact audience is matched.

## Backward Compatibility

artifact_id namespace exists today (emitted in `voice_playback_requested`
and `lipsync_frame_batch` per
[`tables/runtime-agent-event-projection.yaml`](tables/runtime-agent-event-projection.yaml)).
This contract is the first authoritative read-bytes SDK surface for it.
Existing `getScenarioArtifacts(jobId)` (S-RUNTIME-073 typed projection)
and `getVoiceAsset` remain admitted for their distinct use cases (job-typed
media result projection / voice asset library).

This is a hard cut: artifacts written before audience binding do not inherit
readability from their id, local-user ownership or earlier anonymous behavior.

## Drift Resistance

- ReasonCode ARTIFACT family must be admitted in three places synchronously
  (proto `common.proto` enum + `tables/reason-codes.yaml` + vNext SDK
  `sdks/typescript/types/reason-code.ts` ReasonCode const); spec validator enforces.
- emitter-side `Store.Put` must precede emit event; absence logs fatal.
- externally readable records must persist observed size, content SHA-256 and
  the complete account/app/release/session/use/expiry audience; disk reads
  recheck payload size and hash.
- runtime handler must use `grpcerr.WithReasonCode`, not status.Error
  message string.
- SDK consumer surface must be class-member shape (`Runtime.artifacts.readBytes`),
  not singleton const export.
- inline size cap 32 MiB is hard; larger artifacts must fail-close
  `ARTIFACT_TOO_LARGE` (no silent truncation).

## Out of Scope (requires future authority)

- cross-device or cross-account artifact sharing and delegated audiences
- generic chunked retrieval for arbitrary artifact classes
- generic artifact metadata API (`describeArtifact`) beyond the generated voice
  metadata required above
- generic by-tag / by-source artifact discovery beyond generated voice cleanup
- artifact upload by id (`uploadArtifact` already exists with distinct semantics)
- platform-side `lipsync_frame_batch` deprecation
