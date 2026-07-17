# Runtime Local Agent Materialization Contract

> Owner Domain: `K-AGCORE-*`

Runtime LocalAgent materialization, immutable source snapshot, deletion/reset,
source-derived context input, and proactive interruptibility authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-139 Runtime-Owned Realm Source Materialization

`RuntimeAgentService` is the sole creation authority for an opaque Runtime
LocalAgent identity. Its only public source-materialization operation is
`MaterializeRealmSource`. The authenticated request contains exactly an
`AgentRequestContext`, a non-empty bounded `request_id`, and one strict
`CharacterSourceRefV3`; the response contains only the opaque
`local_agent_ref`, a bounded `LocalAgentSourceContextStatus`, an
`idempotent_replay` flag, and a closed reason code.

`CharacterSourceRefV3` is a closed discriminated union:

- `worldCharacter` contains `kind`, `id`, `worldId`, a
  `worldEntityRef` with exact `kind=worldEntity`, matching `worldId`, and
  `entityId`, plus a 64-lowercase-hex `sourceHash`;
- `personaCharacter` contains `kind`, `id`, `worldId`,
  `ownerAccountId`, and a 64-lowercase-hex `sourceHash`.

Mixed branches, additional fields, implicit home-world binding,
caller-selected account, or any alternate source identity fail closed. Apps
and SDKs never submit a Realm base, bearer, grant id, challenge, packet, proof,
segment, component, chunk, source core, or LocalAgent identity.

Runtime creates the challenge and eight published limits, resolves the current
canonical Realm base, authenticated account bearer, and exact current
materialization grant through Runtime-owned account/custody interfaces, and
calls a constructor-injected private `RealmMaterializationIssuer`. The exact
grant selector is:

- `appId=nimi.avatar`;
- `scopeFamily=agent`;
- `scopeName=agent.identity.project`;
- empty qualifier;
- `state=GRANTED`; and
- subject equal to the authenticated Runtime account.

Zero, multiple, stale, expired, revoked, superseded, cross-subject, or
otherwise mismatched grants return a typed denial before product mutation. The
issuer is not a generic Realm proxy, does not accept caller-selected headers or
URLs, and does not transfer credential/profile/custody authority into the
materialization domain. Realm owns canonical Character/World/grant truth and
current Packet v3 issuance; Runtime owns acquisition, verification,
transaction, LocalAgent, snapshot, provenance, context compilation, and
lifecycle.

Runtime accepts only `realm.source-materialization-packet/v3` with a complete
`MaterializationClosureSetManifestV3` and ordered segments. Before any
semantic value is exposed, Runtime independently verifies strict closed schema,
the eight exact limits, source/account/challenge/audience/TTL/nonce/replay
binding, current-purpose RS256 JWKS, issuer/kid/use/alg, complete segment and
global ordinal coverage, every component/chunk/manifest/context/payload/packet
hash edge, and detached proof. Unknown fields, duplicate keys, trailing bytes,
HMAC, stale or removed keys, partial closure, or any mismatch fail closed.

Only after all checks pass may one atomic commit create exactly one opaque
`local_agent_ref`, its immutable `LocalAgentSourceSnapshotV2`, and v3
provenance membership. Any acquisition, validation, persistence, race, or
cleanup failure creates none of those product records. Raw HTTP response,
packet wrapper, proof, challenge, nonce, TTL, segment, component, and chunk
bytes never cross the Runtime private boundary and are cleared after every
success or terminal failure.

Canonical authority relations:

- AUTHORITY-RELATION subject=runtime action=own object=realm-source-materialization-acquisition-and-transaction value=runtime-private polarity=require
- AUTHORITY-RELATION subject=runtime-public-materialization action=accept object=character-source-ref-v3-and-request-id value=exact-only polarity=require
- AUTHORITY-RELATION subject=runtime-public-materialization action=accept object=packet-proof-segment-component-or-chunk-bytes value=denied polarity=forbid
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v2 action=set-mutability object=execution-state value=immutable polarity=require
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v2 action=persist object=raw-source-materialization-transport value=denied polarity=forbid
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v2 action=rebase object=realm-source-changes value=denied polarity=forbid
- AUTHORITY-RELATION subject=local-agent-source-snapshot-v2 action=write-back object=realm-source-truth value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime-localagent-agent-state action=write-back object=realm-source-truth value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=accept object=hmac-source-materialization-proof value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=source-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=prompt-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=context-authority-from-app-metadata-fallback value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime action=derive object=proof-authority-from-app-metadata-fallback value=denied polarity=forbid

Runtime local inventory and provenance are the only discovery projections for
an existing materialization. Environment variables, renderer cache, source
fields, app/provider metadata, or deterministic naming cannot produce a
`local_agent_ref`, reconstruct a snapshot, or authorize chat. Repeated
materialization may create distinct LocalAgents; only an exact Runtime request
id plus byte-identical canonical source intent makes a retry idempotent.

`MUST NOT`: Runtime must not create any source-backed LocalAgent as a
standalone local-only agent, fake contact, server-bot bypass, Avatar instance,
privileged Agent class, official-guide shortcut, quota bypass, or default
global agent.

## K-AGCORE-140 Source-Derived Identity, Behavior, And Knowledge

Runtime derives LocalAgent identity, behavior, world, relationships, and source
knowledge only from the strictly decoded typed semantic closure frozen in
`LocalAgentSourceSnapshotV2`. WorldCharacter and PersonaCharacter identity,
presentation, biography, psychology, knowledge, relationships, descriptive
capabilities, interaction profile, persona style, content profile, and
admitted asset references are typed source inputs. They are not arbitrary
prompt fields or operational authority.

Proof-covered presentation/resource/asset references become eligible only
after Packet v3 verification and SnapshotV2 admission. They are inputs solely
to Runtime-owned bounded presentation and voice lifecycle resolution; they do
not select a provider, grant a tool or media capability, create an Avatar/voice
binding, start a lifecycle, or mutate source/snapshot truth. An invalid or
unavailable optional ref fails or shrinks the bounded presentation projection
without changing the admitted SnapshotV2, provenance, LocalAgent identity, or
Realm record.

Runtime may apply presentation fallback only after admission and only to an
optional bounded presentation field, using already-admitted typed identity or
presentation values. Fallback cannot satisfy a required source field or any
verification step, cannot enter SnapshotV2 or its hashes, cannot change
`sourceHash`, and cannot write back to Realm. If no admitted candidate exists,
the optional projection remains absent.

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
turn. It reads `LocalAgentSourceSnapshotV2` with compiler compatibility
`realm-character-v3` and emits the fixed context lanes in K-AGCORE-155.
Desktop, SDK, Kit, Zhiyu, another app, Realm, and provider adapters
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

## K-AGCORE-151 Private Challenge, Acquisition, And Closure-Set Transaction

`RuntimeAgentService` owns the durable challenge, request replay, private
segment transaction, and safe-result ledger. These are private owner APIs used
only by `MaterializeRealmSource`; no public method accepts a challenge, packet,
proof, manifest, segment, component, or chunk.

Each challenge is bound to Runtime instance, authenticated materializer
account, the exact canonical `CharacterSourceRefV3`, request intent, audience,
TTL, and these eight published limits:

- `maxSegmentBytes <= 8388608`;
- `maxSegmentComponentCount <= 256`;
- `maxSegmentChunks <= 4096`;
- `maxChunkBytes <= 262144`;
- `maxSetSegments <= 64`;
- `maxSetBytes <= 134217728`;
- `maxSetComponentCount <= 16384`; and
- `maxSetChunks <= 65536`.

Runtime may publish lower positive ceilings, but never a value above Realm's
admitted ceiling. A producer-valid exact boundary passes; every individual
limit-plus-one, arithmetic overflow, declared/actual mismatch, or aggregate
overflow fails with a typed capacity reason before allocation or product
mutation. Challenge states are exactly `issued -> leased -> consumed |
invalidated | expired`. Normal restart preserves only an unleased, unexpired
issued challenge; data-root identity change invalidates it.

The internal attempt states are exactly `requested -> acquiring -> verifying ->
committing -> committed | failed`, with `requested | acquiring | verifying ->
aborted | expired` terminal alternatives. The canonical intent digest binds
authenticated account, request id, and the complete canonical source ref.
Identical replay returns the one safe committed result; reuse with a different
intent fails `request_conflict`; concurrent terminal races produce exactly one
winner and never a second LocalAgent.

The private issuer performs bounded HTTP acquisition. Runtime derives a checked
wire budget from fixed envelope/descriptor allowances, the published set,
component, and chunk ceilings, `maxSetBytes`, and base64 expansion. A streaming
closed-schema decoder enforces status, content type, total bytes, per-string
and per-array limits before allocation; it rejects duplicate object keys,
unknown fields or enums, malformed base64, trailing JSON, partial response, and
early connection termination. It streams verified transport bytes into a
principal/account/attempt-partitioned private staging area with opaque paths
and restrictive permissions; no raw response is logged or persisted as product
state.

Verification order is fixed:

1. HTTP status, content type, wire budget, and strict envelope schema;
2. packet schema, source/account/challenge/audience/TTL/nonce/replay binding;
3. exact equality with all eight challenge limits;
4. current-authoritative materialization-purpose JWKS and RS256
   `kid/use/alg/issuer`;
5. closure-set structure, totals, deterministic ordered segment refs, and set
   manifest hash;
6. every segment manifest, range, length, count, and hash;
7. global component/chunk ordinals and contiguous non-overlapping coverage;
8. canonical component bytes, chunk digests, component digests, and ordered
   component set;
9. typed source wrapper, owning WorldCore, entity/relationship/dependency
   closure, and coverage;
10. source/world/coverage/materialization-context/payload/packet hashes and
    detached proof;
11. SnapshotV2 normalization, strict readback codec, and snapshot hash; and
12. one atomic LocalAgent + SnapshotV2 + provenance + safe-result commit.

Missing, duplicate, reordered, overlapping, conflicting, misbound, extra,
wrong-count, wrong-length, stale-key, hash, closure, codec, proof, persistence,
or cleanup failure atomically terminalizes the attempt without product records.
The JWKS fetch is current-authoritative for each attempt; removed/stale keys
receive no grace path. Semantic source values are unavailable to the compiler
until step 10 succeeds, and product state is unavailable until step 12 commits.

Abort, expiry, validation failure, conflict, commit failure, and startup
recovery clear every private transport byte. Startup recovery invalidates every
unfinished attempt, including `committing` without a durable product
transaction. A durably committed transaction replays only its bounded safe
result and completes cleanup. Logs, audit, and evidence may contain only
allowlisted ids, hashes, counts, state transitions, and reason codes.

## K-AGCORE-152 Immutable LocalAgentSourceSnapshotV2

`LocalAgentSourceSnapshotV2` is the only active source snapshot schema. It is
a strict first-class Runtime record containing exactly:

- schema/hash, `local_agent_ref`, and `captured_at`;
- safe packet provenance: packet id/hash, Realm issuer, and signing-key
  fingerprint;
- exact `CharacterSourceRefV3` and complete normalized typed
  WorldCharacter/PersonaCharacter wrapper and profile;
- complete owning `WorldCore`, entities, relationships, explicit dependency
  closure, and coverage manifest;
- source, world, coverage, materialization-context, payload, ordered-segment,
  and closure-set hashes; and
- normalization version plus compiler compatibility
  `realm-character-v3`.

The record contains no raw packet/proof/challenge/nonce/TTL/audience, bearer or
grant material, segment/chunk/component bytes, HTTP data, staging path,
transaction ledger, provider/private context, or free-form source map.
Persistence enforces a bidirectional 1:1 relation between each materialized
`local_agent_ref` and its snapshot. Strict decode and snapshot-hash
verification run before write, after database readback, and at restart
hydration; mismatch cannot produce a chat-ready projection.

`snapshot_hash` is SHA-256 over
`nimi.runtime.local-agent-source-snapshot/v2\0` plus the canonical semantic
tuple of schema version, normalized CharacterSourceRefV3 and typed source,
owning world and complete dependency closure, coverage and semantic hashes,
normalization version, and compiler compatibility. It excludes itself,
LocalAgent identity, `captured_at`, packet issuance/proof fields, Runtime
instance, database row, request id, and transport state. Equivalent admitted
semantics may therefore share a snapshot hash while retaining distinct opaque
LocalAgent identities and records.

## K-AGCORE-153 V3 Provenance, Epoch, Reset, Restart, And No-Rebase

Runtime keeps a separate 1:N provenance index from:

`H("nimi.runtime.realm-source-provenance/v3\0" + canonical
CharacterSourceRefV3 + materializationContextHash)`

to immutable snapshot/agent records. The key is not derived from a legacy
tuple, and index lookup is discovery only: it cannot synthesize an agent,
repair a missing/corrupt snapshot, or choose among multiple LocalAgents.
Snapshot, index, LocalAgent, and safe-result writes share the same atomic
materialization transaction; K-AGCORE-141 termination removes the target
membership in the same deletion transaction.

Runtime persistence records source-materialization contract epoch `v3`.
Presence of any pre-v3 challenge, upload, raw staging, source-backed agent,
snapshot, provenance, or compiler-compatibility record causes startup and
materialization to fail closed with
`source_materialization_data_reset_required`. Runtime performs no automatic
upgrade, interpretation, alias, dual read/write, or on-read migration.

The only admitted transition is an explicit guarded, dry-run-capable scoped
reset. Before mutation it validates a local/disposable data-root identity,
inventories every affected source-backed LocalAgent and dependency, acquires an
exclusive reset lease, and stops affected in-flight turns/hooks. One atomic
transaction hard-deletes each affected agent's snapshot, provenance,
conversation/transcript, state, hooks/events, agent-scoped memory, unfinished
attempt/challenge, and raw staging; writes epoch `v3`; and readbacks zero
pre-v3/orphan/residue. Any failure rolls back the whole reset and leaves the
epoch unchanged.

The reset never changes account/session/token custody, protected-local ledgers,
local-app grants or storage, provider/model/config, Realm canonical records, or
non-source-backed LocalAgents. It reports only safe ids and exact counts.

Source revision, Realm deletion/availability, app metadata, and provider
metadata never mutate, rebase, or write back an existing snapshot. After a
successful capture, Realm may be offline and the LocalAgent remains chat-ready
from its validated SnapshotV2 plus Runtime truth. A newer revision creates a
new opaque LocalAgent, snapshot, conversation/transcript scope, and memory
scope. Restart rehydrates the exact validated state without contacting Realm
or substituting current source data. Missing or invalid snapshot, provenance,
account, agent, or anchor binding fails closed with a typed status.
