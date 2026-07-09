# Runtime Local Agent Materialization Contract

> Owner Domain: `K-AGCORE-*`

Runtime LocalAgent materialization, Nimi guide context, deletion/reset, documentation corpus, and proactive interruptibility authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-139 SourceMaterializationPacket LocalAgent Materialization

`InitializeAgent` is a Runtime-local creation operation for an opaque
LocalAgent identity. `RuntimeAgentService` may materialize a LocalAgent from a
validated `SourceMaterializationPacket` produced from Realm source content, but
Realm source provenance does not own the Runtime creation lifecycle. This rule
applies to every materialized runtime source, not only the Nimi guide.

For any materialization request, Runtime must:

- consume the `SourceMaterializationPacket` through admitted Realm/SDK
  source-core data, not through Desktop fixtures;
- validate packet schema, `packetHash`, Realm-issued proof, expiry, replay
  nonce, owner/audience, source hash, and source schema before local creation;
- generate an opaque Runtime-owned `local_agent_ref`;
- persist LocalAgent state and source provenance metadata without storing packet
  payload as a second source of truth;
- maintain a provenance index from source kind, source world id, source id, and
  source content hash to one or more `local_agent_ref` values;
- allow multiple LocalAgents to share the same source provenance;
- fail closed when owner identity, source hash, packet proof, or source schema
  does not match.

Creation trigger owner:

- Runtime authors the local creation result. Realm authorizes source reads and
  creates a by-value packet, but does not create durable provision intent,
  source-provenance linkage, or a deterministic LocalAgent identity.
- `InitializeAgent` may be idempotent only for an explicit Runtime request id or
  existing Runtime-owned `local_agent_ref`. It must not converge all repeated
  materialization attempts for the same source into one projection.
- Opening first chat may query Runtime local inventory/provenance. If no
  matching LocalAgent exists, the UI may request a fresh packet and create a new
  LocalAgent. If provenance is unavailable, Runtime surfaces unavailable
  provenance instead of reconstructing, rebasing, or recreating a LocalAgent
  from deterministic source metadata.
- Runtime local inventory/provenance is the only admitted discovery projection
  for an existing materialized source. SDK/Kit/Electron consumers may expose
  this projection, but must not convert environment variables, renderer cache,
  source ids, or source metadata into a `local_agent_ref`.

`MUST NOT`: Runtime must not create any LocalAgent — the guide source's or
any other source's — as a standalone local-only agent, fake contact,
server-bot bypass, Avatar instance, privileged Agent class, special
official-guide path, quota bypass, or default global agent.

## K-AGCORE-140 Nimi Guide Prompt And Documentation Context

When the Nimi guide LocalAgent is available through SourceMaterializationPacket
materialization, Runtime may initialize the first conversation from Nimi guide
welcome copy and may attach built-in Nimi usage documentation as product
knowledge/context.

Source of truth:

- the Nimi guide welcome copy and guide system prompt are ordinary source
  content carried on the admitted SourceMaterializationPacket, reached through
  the same source-core path used for any runtime source;
- the Nimi guide / Archivist source is available only when admitted Realm
  source-core data can produce a hash-bearing source reference and fresh
  SourceMaterializationPacket, or when Runtime inventory/provenance already
  contains a Runtime-owned LocalAgent for that source;
- Runtime MUST NOT hold a runtime-local hardcoded guide welcome string, guide
  prompt, or guide identity constant as parallel product truth;
- built-in Nimi usage documentation attached as context is product
  knowledge/context only and is not external Realm authority, not memory truth, and
  not a runtime-owned guide catalog.

`MUST NOT`: prompt/docs context must not create Agent authority, memory truth,
permission grant truth, Runtime setup truth, or profile/app configuration truth.
The guide may direct the user to product surfaces but cannot bypass setup
confirmations, permissions, install plans, app admission, or ordinary LocalAgent
mechanics.

## K-AGCORE-141 Runtime-Local LocalAgent Deletion And Reset

`TerminateAgent` is a Runtime-local deletion lifecycle for a Runtime-owned
LocalAgent projection. Realm source removal or source provenance changes do not
issue `TerminateAgent` and do not hard-delete LocalAgent state. This rule
applies to every Runtime-owned LocalAgent, not only the Nimi guide.

`TerminateAgent` deletion scope:

- `TerminateAgent` must remove the `runtime_local_agent` row for the target
  `local_agent_ref`, not merely flip a lifecycle status field;
- when explicitly invoked by Runtime-local delete/reset authority, it must
  remove the agent-scoped projections bound to that `local_agent_ref`:
  agent state projection, runtime-owned pending/terminal hooks, the agent event
  log, and the agent-scoped memory bank (`MEMORY_BANK_SCOPE_AGENT_CORE` and
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

`MUST NOT`: `TerminateAgent` must not leave a partially deleted projection — a
`runtime_local_agent` row without its agent-scoped memory, or agent-scoped
memory without its row. Deletion of the row and its agent-scoped
state/hooks/event-log/memory either completes together or fails closed as a
typed error.

## K-AGCORE-142 Built-In Usage Documentation Corpus Authoring And Context Attachment

K-AGCORE-140 admits "built-in Nimi usage documentation attached as context" and
bounds what that documentation must not become. K-AGCORE-142 is the positive
counterpart: it names where the built-in usage documentation corpus is authored
and stored, and how it is admitted as the Nimi guide's per-turn context
attachment, without introducing a special official-guide path.

Authoring and storage:

- the built-in Nimi usage documentation corpus is ordinary source profile
  content authored alongside the guide source definition (the same
  Nimi-authored bootstrap definition that owns the guide `greeting` /
  `systemPromptBase`), not a separate platform-owned bespoke docs artifact and
  not a separate admitted docs schema;
- the corpus is stored inside the projected source's ordinary source-core
  profile knowledge payload, so it rides the same admitted source-core
  projection used for any runtime source's profile content;
- the corpus is bounded built-in product knowledge — first-run setup, Runtime,
  profiles, Apps, Worlds, RealmPersonas, LocalAgents, and Avatar — authored as
  static structured text;
- the corpus is ordinary source profile content: any admitted source profile may
  carry a built-in documentation knowledge payload through the same field. It
  is not a guide-only schema, not a privileged Agent class field, and not a
  quota/admission exception.

Context attachment:

- the corpus reaches the guide LocalAgent's chat turns as product
  knowledge/context through the same per-turn prompt-context path the guide
  `systemPromptBase` already uses — it augments the turn's assembled prompt
  context and is not a separate retrieval surface;
- attachment is per-turn context only: the corpus is not written into any
  memory bank, is not a runtime-resident catalog, and is not consulted through
  a privileged retrieval path.

Source of truth and authoring location remain ordinary:

- Runtime MUST NOT hold a runtime-local hardcoded usage documentation corpus,
  guide docs catalog, or guide identity constant as parallel product truth; the
  corpus is reached only through the admitted source-core projection,
  consistent with K-AGCORE-140;
- the desktop/consumer attaches the projected corpus to the per-turn context;
  it does not author a parallel renderer-local docs corpus.

`MUST NOT`: the built-in usage documentation corpus must not create Agent
authority, memory truth, permission grant truth, Runtime setup truth, or
profile/app configuration truth. It is product knowledge/context only,
identical to the K-AGCORE-140 bound. The corpus may describe and direct the
user to product surfaces, but it must not bypass setup confirmations,
permissions, install plans, app admission, or ordinary LocalAgent mechanics.

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
