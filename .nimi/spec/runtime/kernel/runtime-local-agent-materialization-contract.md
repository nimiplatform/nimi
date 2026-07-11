# Runtime Local Agent Materialization Contract

> Owner Domain: `K-AGCORE-*`

Runtime LocalAgent materialization, immutable source snapshot, deletion/reset,
source-derived context input, and proactive interruptibility authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-139 SourceMaterializationPacket LocalAgent Materialization

`RuntimeAgentService` is the sole creation authority for an opaque Runtime
LocalAgent identity. Realm authorizes a canonical source read and issues an
RS256-protected, by-value `realm.source-materialization-packet/v2`; it does not
own the Runtime challenge, replay ledger, upload transaction, LocalAgent
identity, snapshot, or lifecycle. The only packet ingress is the
`CreateSourceMaterializationChallenge` plus `Begin` / `Put` / `Commit` /
`AbortSourceMaterializationUpload` surface defined by K-AGCORE-151. A unary
packet, metadata payload, small-bundle shortcut, fixture-created agent, or
non-`runtime-source` bypass is not admitted.

Runtime must strictly verify the packet v2 schema, limits, canonical component
and closure coverage, every hash edge, detached JWS, Realm issuer/JWKS,
materialization-purpose key registration, audience/challenge, account/source
binding, expiry, and replay state before creating local truth. Strict decode
rejects unknown schema/version/field/enum/type. HMAC proof is not admitted.
Commit atomically creates exactly one opaque `local_agent_ref`,
its immutable `LocalAgentSourceSnapshotV1`, and provenance index membership;
any validation or substrate failure creates none of them and clears all raw
bundle bytes. K-AGCORE-152 and K-AGCORE-153 define the durable record and
lifecycle.

Canonical authority relations:

- AUTHORITY-RELATION subject=runtime action=own object=source-materialization-challenge-replay-upload-state value=runtime-owned polarity=require
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v1 action=set-mutability object=execution-state value=immutable polarity=require
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v1 action=persist object=raw-source-materialization-packet value=denied polarity=forbid
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v1 action=rebase object=realm-source-changes value=denied polarity=forbid
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v1 action=write-back object=realm-source-truth value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime-localagent-agent-state action=write-back object=realm-source-truth value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=accept object=hmac-source-materialization-proof value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=source-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=prompt-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=context-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=proof-authority-from-app-metadata-fallback value=denied polarity=forbid

Runtime local inventory and provenance are the only discovery projection for an
existing materialization. Environment variables, renderer cache, source ids,
app metadata, provider metadata, or deterministic source naming cannot produce
a `local_agent_ref`, reconstruct a snapshot, or authorize chat. Repeated
materialization may create distinct LocalAgents; only an explicit Runtime
request id may make a retry idempotent.

`MUST NOT`: Runtime must not create any source-backed LocalAgent as a standalone
local-only agent, fake contact, server-bot bypass, Avatar instance, privileged
Agent class, official-guide shortcut, quota bypass, or default global agent.

## K-AGCORE-140 Source-Derived Identity, Behavior, And Knowledge

Runtime derives LocalAgent identity, behavior, and source knowledge only from
the strictly decoded typed source envelope/core and closure frozen in
`LocalAgentSourceSnapshotV1`. Character identity, presentation, biography,
psychology, knowledge, relationships, capabilities, and interaction profile;
or Persona identity, presentation, persona style, content profile, interaction
profile, and asset intents are typed source inputs. They are not an arbitrary
prompt field.

- AUTHORITY-RELATION subject=runtime action=accept object=packet-supplied-systempromptbase value=denied polarity=forbid

The packet and snapshot must not contain `systemPromptBase`, an equivalent raw
system/developer prompt, or a free-form prompt map. Runtime may project a typed
source greeting once for a new conversation and may compile admitted source
knowledge through K-AGCORE-142 and K-AGCORE-155. A greeting or dialogue
exemplar is not committed transcript unless Runtime explicitly commits the
corresponding assistant turn.

The Nimi guide / Archivist follows the same rules. Its identity, behavior,
welcome, and product knowledge must be proof-covered source data; Runtime must
not hold a hardcoded guide identity, welcome, prompt, documentation catalog, or
privileged guide path as parallel truth. Source knowledge cannot grant tools,
permissions, setup completion, install admission, app authority, memory truth,
or profile/configuration truth.

## K-AGCORE-141 Runtime-Local LocalAgent Deletion And Reset

`TerminateAgent` is a Runtime-local deletion lifecycle for a Runtime-owned
LocalAgent projection. Realm source removal or source provenance changes do not
issue `TerminateAgent` and do not hard-delete LocalAgent state. This rule
applies to every Runtime-owned LocalAgent, not only the Nimi guide.

`TerminateAgent` deletion scope:

- `TerminateAgent` must remove the `runtime_local_agent` row for the target
  `local_agent_ref`, not merely flip a lifecycle status field;
- when explicitly invoked by Runtime-local delete/reset authority, it must
  atomically remove the immutable source snapshot, provenance-index membership,
  conversation anchors and committed transcript, agent state projection,
  runtime-owned pending/terminal hooks, the agent event log, and the
  agent-scoped memory bank (`MEMORY_BANK_SCOPE_AGENT_CORE` and
  `MEMORY_BANK_SCOPE_AGENT_DYADIC` owned by that agent);
- the deletion is a hard delete: the projection and its agent-scoped memory are
  physically removed. `RuntimeAgentService` must not retain a `TERMINATED`
  tombstone row as the steady-state outcome of local delete/reset. A later
  materialization from the same source creates a new opaque LocalAgent identity
  through `K-AGCORE-139` rather than resurrecting deleted state.

Fixed rules:

- `TerminateAgent` must be idempotent. `TerminateAgent` for an already-absent
  `local_agent_ref` — including a LocalAgent that was never materialized —
  must succeed as a typed no-op rather than failing with a not-found error.
- runtime snapshot persistence must not re-insert a deleted `local_agent_ref`.
  A snapshot rewrite must exclude deleted projections so that a deleted agent
  never reappears after restart or snapshot replay.
- `TerminateAgent` must cancel any active hooks and in-flight execution for the
  target agent before the projection row is removed, so deletion does not strand
  live runtime work.
- substrate failure during deletion fails closed: if the row or agent-scoped
  memory cannot be deleted, `TerminateAgent` must return a typed failure status
  rather than reporting pseudo-success. Runtime owns retry/reporting of
  Runtime-local deletion failure and must not mask an incomplete deletion.
- `TerminateAgent` deletes the runtime-owned LocalAgent projection only. It must
  not mutate, delete, or write back the canonical Realm source identity, and it
  must not delete account-scoped truth wider than the target agent.

`MUST NOT`: `TerminateAgent` must not leave a partially deleted agent, snapshot,
index membership, conversation/transcript, state, hook, event, or memory
projection. Deletion completes as one atomic lifecycle result or fails closed as
a typed error. Snapshot rewrite, restart hydration, safe-result replay, and
provenance lookup must never resurrect a deleted `local_agent_ref`; a later
materialization receives a new opaque identity and new conversation/memory
scope.

## K-AGCORE-142 Runtime-Owned Per-Turn Source Attachment

Runtime's typed source compiler is the only authority that attaches frozen
source identity, behavior, world, relationship, and knowledge to a LocalAgent
turn. It reads `LocalAgentSourceSnapshotV1` and emits the fixed context lanes in
K-AGCORE-155. Desktop, SDK, Kit, Zhiyu, another app, Realm, and provider adapters
may submit intent or consume bounded status, but they must not attach source
context, choose its lane, serialize it into provider roles, or author a parallel
documentation/prompt corpus.

Source knowledge is a typed `source_knowledge` lane. Each compiled item carries
a stable item id, typed source path/ref, content hash, priority, and token
estimate. Product documentation for the Nimi guide is ordinary proof-covered
source knowledge under this rule, not a Runtime-resident catalog, retrieval
exception, memory write, or guide-only schema. It receives the same budget,
trust, injection resistance, and omission semantics as any source knowledge.

Runtime must reject consumer-supplied LocalAgent context, caller system or
developer roles, execution bindings, forged manifests, and app/provider
metadata fallback before provider invocation. Ordinary non-Agent Nimi Chat
`systemPrompt` authority is outside this contract and remains unchanged.

## K-AGCORE-143 Proactive Interruptibility Projection Boundary

`RuntimeAgentService` owns `proactive_interruptibility_v1` as the bounded
app-facing projection for proactive Life Track interruptibility. This is a
Runtime-owned projection and event seam over Runtime autonomy, HookIntent
admission, cadence, host scheduler admission, permission state, quiet-hours
policy, spacing/frequency gates, delivery/suppression outcomes, and audit
linkage. It is not a renderer scheduler, OS notification promise, or general
automation surface.

It owns:

- default-off autonomy-derived interruptibility mode
- trigger source classification for admitted Life Track cadence and HookIntent
  evidence
- `quiet_hours` state and owner/source metadata
- `frequency_cap` state and owner/source metadata
- `suppression_reason` values for typed fail-closed outcomes
- Runtime/host audit reference lineage for every projected outcome
- `runtime.agent.proactive.suggested`,
  `runtime.agent.proactive.delivered`, and
  `runtime.agent.proactive.suppressed` projection events

It does not own:

- renderer-local timers, polling loops, or scheduling logic
- app-owned permission grant truth
- OS notification delivery truth
- broad reminders, appointments, deadlines, wakeups, or calendar semantics
- proactive chat initiation beyond the admitted Runtime/host projection

Fixed rules:

- `proactive_interruptibility_v1` is default off. No app or SDK consumer may
  enable it by rendering UI state or fabricating projection fields.
- Every proactive suggested, delivered, or suppressed outcome must be projected
  as one of the `runtime.agent.proactive.*` events admitted in
  `tables/runtime-agent-event-projection.yaml` and must carry an `audit_ref`.
- `delivery_channel` is exactly `in_app_surface` or
  `notification.not_admitted`. `notification.not_admitted` is explicit
  non-delivery for OS notifications and must not be treated as a fake
  notification success.
- `quiet_hours` and `frequency_cap` are owner-projected fields. SDKs and apps
  may display or filter them, but must not infer them as authority.
- Missing, denied, revoked, expired, or otherwise unavailable permission
  evidence suppresses delivery with a typed `suppression_reason`.
- `proactive_interruptibility_v1` may reference admitted HookIntent ids as
  source evidence, but it does not widen HookIntent trigger/effect semantics
  beyond `follow-up-turn`.
- SDKs and apps must fail closed when required proactive projection fields are
  absent. They must not backfill the projection with app-local timers,
  permission guesses, or notification assumptions.

## K-AGCORE-151 Challenge And Source Materialization Upload State Machine

`RuntimeAgentService` owns the durable materialization challenge, replay, and
upload ledger. `CreateSourceMaterializationChallenge` returns an opaque
challenge/audience bound to Runtime instance, authenticated materializer
account, typed source ref, and TTL. It publishes `maxBundleBytes`,
`maxComponentCount`, `maxChunkBytes`, and `maxChunks`; every exact boundary is
accepted and every limit-plus-one request fails with a typed capacity reason.
Challenge states are exactly `issued -> leased -> consumed | invalidated |
expired`. Normal restart preserves an unleased, unexpired issued challenge;
data-root reset changes Runtime instance identity and invalidates prior
challenges.

The upload states are exactly `open -> committing -> committed | failed`, with
`open -> aborted | expired` terminal alternatives. Begin control contains only
the typed unsigned packet envelope, detached proof, and
`BundleTransportManifestV1`; it contains no source/world/component body. Every
semantic byte enters through Put, including a one-chunk small bundle. The hash
graph is acyclic: component and semantic payload hashes exclude transport;
`bundleManifestHash` binds ordered component descriptors and chunk layout while
excluding itself, payload/packet/proof and upload-ledger fields; `packetHash`
binds payload and manifest hashes while excluding itself and proof; detached
JWS signs the domain-separated packet hash. Runtime recomputes every edge rather
than trusting caller-declared digests, lengths, or completeness.

The only packet ingress is:

1. `BeginSourceMaterializationUpload(beginRequestId, control)` strictly
   validates challenge/account/source binding, advertised limits,
   `BundleTransportManifestV1`, manifest hash, packet hash, and the RS256
   detached JWS before CAS-leasing `issued` to one
   `uploadId/packetHash/bundleManifestHash` and creating an `open` upload.
   Identical request id and byte-identical control is idempotent; the same key
   with different control or a second Begin for the challenge is a typed
   conflict with no second upload.
2. `PutSourceMaterializationChunk(uploadId, globalOrdinal, componentId,
   componentOffset, bytes)` accepts only `open`, validates upload binding,
   ordinal, component mapping, offset, length, advertised limits, and chunk
   SHA-256. An exact retry is idempotent. Any conflicting reuse of an ordinal
   atomically marks the upload `failed`, invalidates the challenge, and clears
   every stored raw chunk; a wrong or unknown upload cannot affect another
   upload.
3. `CommitSourceMaterialization(commitRequestId, uploadId)` CASes `open` to
   `committing`, proves descriptor coverage, reassembles canonical component
   bytes, and recomputes component, coverage, materialization-context, payload,
   manifest, packet, and proof edges. Missing, duplicate, overlapping, misbound,
   wrong-count, wrong-length, hash, closure, codec, proof, or persistence failure
   atomically writes `failed`, invalidates the challenge, creates no agent,
   snapshot, or provenance entry, and clears raw bytes. Success atomically
   creates those three records, marks the challenge `consumed`, marks the upload
   `committed`, and writes only a safe result ledger. Replay of an identical
   commit id returns that result; concurrent or different-key commits return
   typed `commit_in_progress`, `already_committed`, or `commit_conflict` without
   an additional agent.
4. `AbortSourceMaterializationUpload` may CAS only `open` to `aborted`; an exact
   repeat is idempotent. It invalidates the leased challenge and clears raw
   bytes. Abort/Commit races have one terminal winner; abort never deletes a
   committed agent, and Put/Commit after `aborted`, `failed`, or `expired` fails
   typed.

TTL cleanup expires issued challenges and open uploads; an expired upload also
invalidates its leased challenge. Startup recovery invalidates and clears every
unfinished upload, including `committing` without a durable successful
transaction. A durably committed transaction replays only its safe result and
completes raw cleanup; it never creates another agent. Raw packet, component,
and chunk bytes are cleared on success, validation failure, conflict, abort,
expiry, and restart recovery. Logs, audit, and evidence may contain only
allowlisted ids, hashes, counts, state transitions, and reason codes.

## K-AGCORE-152 Immutable LocalAgentSourceSnapshotV1

`LocalAgentSourceSnapshotV1` is a first-class strict Runtime record. It contains
exactly these semantic categories:

- `snapshot_schema_version`, `snapshot_hash`, `local_agent_ref`, and
  `captured_at`;
- safe provenance: `packet_id`, `packet_hash`, Realm `issuer`, and signing
  `key_fingerprint`;
- typed source envelope and Character/Persona core;
- typed complete owning/home `WorldCore` and dependency closure;
- typed coverage manifest;
- source, world, canonical component, coverage, and materialization-context
  hashes; and
- normalization and compiler-compatibility version.

The record retains no raw packet wrapper or bytes, nonce, TTL, challenge,
audience, detached proof, component bytes, chunk bytes, upload ledger data, or
other raw bundle material. Persistence enforces a true bidirectional 1:1
constraint: every materialized `local_agent_ref` has exactly one snapshot and
that snapshot belongs to exactly that LocalAgent. Strict codec validation and
snapshot-hash verification run before write, after database readback, and at
restart hydration; mismatch fails closed and cannot produce a chat-ready
projection.

`snapshot_hash` is SHA-256 over domain tag
`nimi.runtime.local-agent-source-snapshot/v1\0` plus the canonical tuple of
snapshot schema version, normalized typed source, normalized owning/home world
and dependency closure, coverage manifest hash, materialization context hash,
and normalization version. It excludes itself, LocalAgent identity,
`captured_at`, packet/proof provenance, Runtime instance, database row, request,
and issuance fields. Two separately materialized agents may therefore share a
semantic snapshot hash while retaining distinct opaque identities and records.

## K-AGCORE-153 Snapshot Provenance, Restart, Offline, And No-Rebase Lifecycle

Runtime keeps a separate 1:N source-provenance index from one canonical
provenance key `(source kind, world id, source id, source content hash,
materialization context hash)` to multiple immutable snapshot/agent records.
An indexed snapshot cannot change provenance, source/world content, or hash.
Index lookup is a discovery projection only; it cannot synthesize an agent or
repair a missing/corrupt snapshot. Snapshot and index writes are in the same
materialization transaction, and termination removes the target membership in
the same deletion transaction defined by K-AGCORE-141.

Source revision, Realm deletion, Realm availability, app metadata, and provider
metadata never mutate, rebase, or write back an existing snapshot. After a
successful capture, Realm may be offline and that LocalAgent remains chat-ready
from its validated snapshot plus Runtime truth. Capturing a newer revision is a
new materialization with a new opaque LocalAgent, snapshot record,
conversation/transcript scope, and memory scope. Restart rehydrates the exact
validated snapshot and scoped state; it neither contacts Realm to refresh it
nor silently substitutes current source data. Missing or invalid snapshot,
provenance, account, agent, or anchor binding fails closed with a typed status.
