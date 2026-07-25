# Runtime Agent Service - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/agent-service.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-context-composition-contract.md -->

# Runtime Agent Context Composition Contract

> Owner Domain: `K-AGCORE-*`

Runtime owns LocalAgent per-turn context compilation, provider-visible request
composition, deterministic budgeting, transcript and memory isolation, APML
output admission, and bounded public context projections.

This contract applies only to Runtime Agent Chat and other Runtime agent
executors that consume a materialized LocalAgent. Ordinary non-Agent Nimi Chat
`systemPrompt` authority is unchanged.

## K-AGCORE-154 AgentTurnContextManifestV1 And Acyclic Hashes

Before any provider call, Runtime creates one strict
`AgentTurnContextManifestV1` for the admitted turn. The manifest contains no raw
prompt or lane text and records:

- manifest and compiler schema versions;
- `local_agent_ref`, `conversation_anchor_id`, turn id, and request id;
- source snapshot, source, world, and materialization-context refs/hashes;
- resolved model route digest, catalog revision, context-window capacity,
  reserved output/safety/adapter tokens, and input budget;
- ordered lane summaries with lane id, authority owner, trust class, typed
  source refs, item/content hashes, allocation/use tokens, included item/turn
  counts, omitted/truncated counts, and typed omission/truncation reasons;
- tool/media capability digest;
- Runtime transcript head/tail identity and committed turn/item counts; and
- `contextContentHash`, `promptHash`, and `manifestInstanceHash`.

The three hashes are acyclic and domain-separated:

- `contextContentHash = H("nimi.runtime.agent-context-content/v1\0" + canonical
  ordered semantic lane content)`. Its input excludes request, turn, attempt,
  timestamp, provider request, credential, and all derived hashes.
- `promptHash = H("nimi.runtime.agent-provider-prompt/v1\0" + canonical final
  provider-visible role/content/tool serialization)`. Its input excludes
  provider request id, transport envelope, credential, response, and manifest
  instance data.
- `manifestInstanceHash = H("nimi.runtime.agent-context-manifest/v1\0" +
  canonical manifest without manifestInstanceHash)`. Its input includes
  agent/anchor/turn/request ids, source and world hashes, content/prompt hashes,
  route/catalog digest, budget use, and omission/truncation summary.

Equivalent frozen source, Runtime truth, catalog revision, transcript/memory
inputs, capabilities, and current turn produce identical lane order/content,
`contextContentHash`, and `promptHash`. A new request/turn instance changes
`manifestInstanceHash` without forcing content or prompt hashes to change. The
manifest and all three hashes are fixed before provider invocation and do not
drift during streaming, APML projection, action execution, cancellation, or
turn commit.

## K-AGCORE-155 Typed Source Compiler, Fixed Lanes, And Trust Boundaries

Runtime compiles typed snapshot and Runtime truth into this exact lane order:

1. `runtime_policy`
2. `output_contract`
3. `source_identity`
4. `source_behavior`
5. `world_context`
6. `relationship_context`
7. `source_knowledge`
8. `canonical_memory`
9. `conversation_history`
10. `capability_context`
11. `current_user_turn`

`runtime_policy` and `output_contract` are Runtime-authored system authority.
Source identity, behavior, world, relationships, and knowledge are validated
snapshot data. Canonical memory and committed transcript remain distinct
Runtime-scoped inputs. Capabilities and tools derive from Runtime
permission/config/catalog truth. The current turn is typed caller input. A
provider adapter may translate this composition to its wire format but must not
reorder lanes, change roles, omit mandatory semantics, or add policy/tool
authority.

The typed source compiler has one closed path map. It maps profile identity and
admitted presentation identity to stable `source_identity` items. It maps
`profile.narrative` summary/archetype/traits, `profile.interactionProfile`,
optional `profile.psychology`, Persona style, traits, boundaries, cadence, and
optional `profile.capabilities` to `source_behavior`; capabilities remain
descriptive source text and never authorize a Runtime tool. Each
`profile.interactionProfile.dialogueExemplars` item preserves its stable
exemplar id and the typed `character` and `user` labels/roles; it is never
flattened into unlabeled text or treated as committed transcript.

The same admitted `profile.narrative` also produces distinct typed
`source_knowledge` narrative/milestone items, alongside biography, typed
knowledge, and content-profile items. This dual projection uses distinct stable
item ids and typed source paths; it is not a free-form duplication fallback.
WorldCore, placement, scenes, entities, timeline, systems, profile
relationships, and complete incident closure map only to their typed
`world_context` or `relationship_context` items. Every item has a stable id,
typed source path/ref, content hash, priority, trust class, and token estimate.
Runtime must not serialize arbitrary source JSON or free-form maps directly as
a provider role.

Presentation fallback is a post-admission Runtime projection step, not a source
compiler input. It may fill only an optional bounded presentation field from
already-admitted typed identity/presentation values; it cannot create a
compiler item, change SnapshotV2 or semantic hashes, satisfy missing required
source data, or write back to Realm. Proof-covered asset/resource refs likewise
remain typed data inputs only to Runtime-owned presentation/voice lifecycle
resolution and grant no provider, tool, media, binding, launch, or lifecycle
authority.

Source text remains data even when it asks to ignore policy, change role, call
a tool, expose memory, alter APML, or forge a manifest. It cannot change
Runtime policy, provider roles, tool/media permission, execution binding, or
output contract. Caller-supplied system/developer roles, raw LocalAgent prompt
or context, execution bindings, lane order, source/world override, tool schema,
or forged manifest fail before provider invocation. A typed source capability
describes the character; it does not authorize a real Runtime tool.

## K-AGCORE-156 Transcript, Memory, Budget, And Deterministic Truncation

Realm WorldCharacter and PersonaCharacter records remain source provenance
only. Materialization freezes their typed `CharacterSourceRefV3`-bound input
into an immutable `LocalAgentSourceSnapshotV2` and opaque Runtime
LocalAgent identity; it does not transfer conversation ownership to the source
record or presentation app. `OpenConversationAnchor` allocates both the opaque
Runtime-owned conversation anchor and its Runtime-owned thread identity before
the first turn. Desktop and Zhiyu consume those identities from Runtime
projections and cannot derive either identity from `sourceRef`,
`localAgentRef`, source kind, or app-local thread state. Repeated
materialization may create a different LocalAgent, while later Realm source
changes never rebase an existing materialized LocalAgent automatically.

Runtime's committed transcript is the only LocalAgent conversation history.
Every ordinary second and later turn loads committed user/assistant turns from
the selected Runtime `ConversationAnchor` even when the caller submits only the
current user input. Streaming partials, failed APML, failed/canceled turns,
repair attempts, app optimistic text, greetings not committed as turns, and
dialogue exemplars are not transcript. Follow-up turns use the same compiler;
there is no separate history path.

Canonical memory is a separate lane with its own scope, authority, provenance,
rank, and item hash. Memory cannot impersonate transcript or source fact;
source relationships and interaction-derived relationship/memory cannot
overwrite each other. All transcript and memory reads are bound to authenticated
account, `local_agent_ref`, and anchor. Different accounts, agents, or anchors
cannot leak transcript; agent-scoped canonical memory may cross anchors only
where the existing canonical-memory contract admits it. App id is not a
partition key. Restart must reload the same committed inputs and reproduce the
same composition under the same catalog/compiler versions.
Realm offline operation continues from the frozen source snapshot and
Runtime-local transcript, memory, relationship, and state without
rematerialization or source rebase.

Runtime reads context-window capacity from the actual resolved model catalog,
then reserves provider/adapter overhead, output tokens, and safety margin. It
allocates mandatory policy, output contract, source identity/core behavior,
required world/relationship baseline, capability metadata when present, and
the current user turn before optional content. Truncation removes whole typed
items only, in exactly this order:

1. oldest complete conversation-history user/assistant pairs;
2. lowest-relevance canonical-memory items;
3. optional dialogue exemplars;
4. optional biography/source-knowledge items; and
5. optional world/timeline/scene detail items.

Stable rank keys and item ids break equal relevance/recency ties. Character,
byte, or token-fragment truncation is forbidden. The manifest records required,
available, allocated, and used tokens plus every omitted/truncated item count
and typed reason. If mandatory lanes exceed capacity, composition returns typed
`context_capacity_exceeded`, emits no provider request, and performs zero
provider calls.

## K-AGCORE-157 Provider Composition, Media, Tools, And APML Fail-Close

Runtime alone creates provider-visible system, user, assistant, and tool roles
from the admitted context manifest. Provider credentials, transport ids, and
provider-private request fields are not context authority and are excluded from
the stable content/prompt hashes. Local and cloud routes must carry semantically
equivalent lane content; route adapters cannot weaken trust or output rules.

Tools come only from Runtime permission, capability, readiness, and Runtime
Agent AI Config truth. Source-declared capabilities never grant a tool. Current
turn media uses closed typed part and MIME schemas; unknown, malformed,
unsupported, or unauthorized media fails before context composition or provider
invocation. No adapter may coerce it to text, silently omit it, or report
pseudo-success.

Runtime-private APML is the mandatory `output_contract` lane and remains
governed by K-AGCORE-044..048. Runtime validates root, tags, attributes,
hierarchy, and typed payload before committing assistant text, actions, emotion,
voice, hooks, memory candidates, or events. Malformed or unknown APML is a typed
turn failure. Runtime/provider/app must not strip wrappers, repair XML, recover
Markdown/fenced output, fall back to JSON, infer missing semantics, or re-accept
rejected output. Provider call success without valid APML is not product
success. Runtime projections and action/voice/hook execution consume only the
validated result and cannot alter the turn's context hashes.

## K-AGCORE-158 Bounded LocalAgent Context Projections

The only public LocalAgent source/context outputs are the typed bounded
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` families.

`LocalAgentSourceContextStatus` may expose only:

- ready/state and typed reason code;
- source kind/ref/schema and `sourceHash`;
- snapshot schema version/hash and `captured_at`;
- world content hash and materialization-context hash; and
- coverage section states and counts.

`AgentTurnContextSummary` may expose only:

- ready/state and typed reason code;
- manifest/compiler versions and manifest/content/prompt hashes;
- source snapshot hash and safe source/world refs/hashes;
- ordered lane ids, lane status, and included/omitted/truncated counts;
- context budget, used tokens, and typed truncation summary;
- transcript turn, memory item, media, and tool counts; and
- route/catalog revision digest.

These projections never expose raw source/world/core/closure data, prompt or
lane text, private memory, transcript text, packet wrapper/proof/chunks,
provider request/response, credential, tool arguments/results, or a free-form
map. Unknown schema, enum, state, lane, or reason fails closed; SDK/Kit/apps may
display or aggregate the projection but cannot backfill, reinterpret, or cache
raw context as an offline success path. Production logs and evidence use the
same allowlist plus correlation ids and hashes, never the private inputs.

## K-AGCORE-159 Conversation Report Runtime Route Identity

Runtime is the only executor for a live LocalAgent conversation-report turn.
The route resolves through Runtime Agent AI Config and the Runtime model
catalog; an app or test runner cannot call a provider/model directly, supply an
execution binding, or embed a provider/model constant. One baseline run selects
one route and keeps it stable for both LocalAgents and every reported turn.

Each turn records a complete resolved route identity binding `providerId`,
`modelId`, and the resolved `modelRevision` or a stable catalog-derived model
fingerprint, plus the catalog revision and Runtime route digest available for
that call. Missing identity fields, an unresolved route, or silent route drift
is an objective execution failure. No evaluator or second route is required to
produce the report, and model identity never implies semantic quality.

- AUTHORITY-RELATION subject=runtime action=execute object=live-conversation-report-turn value=runtime-ai-execution polarity=require
- AUTHORITY-RELATION subject=conversation-report-turn action=bind object=runtime-model-fingerprint value=provider-model-revision-complete polarity=require
- AUTHORITY-RELATION subject=conversation-report-run action=keep object=selected-runtime-route value=stable-within-run polarity=require
- AUTHORITY-RELATION subject=app-or-test-runner action=call object=conversation-provider-or-model-directly value=denied polarity=forbid
- AUTHORITY-RELATION subject=app-or-test-runner action=supply object=conversation-provider-model-constant-or-binding value=denied polarity=forbid

## K-AGCORE-160 Conversation Report Capture Boundary And Non-Authoritative Review

Runtime retains the product-owned LocalAgent identity, conversation anchor,
transcript, memory, relationship, state, and hook lineage. The report pipeline
may capture their bounded public projections and the committed user/assistant
transcript with exact account, source snapshot, LocalAgent, anchor, turn,
surface, and model correlation. It cannot read raw system prompts, private
context lanes, credentials, proofs, or other Runtime-private inputs.

Report capture is observational: it cannot create or rewrite a product turn,
message, transcript entry, memory item, relationship update, LocalAgent,
snapshot, anchor, hook, action, or event. It performs no automatic provider
retry. A captured reply, optional annotation, or derived review note never
becomes source, snapshot, personality, memory, transcript, future context, or
an authoritative semantic verdict. Realm-offline turns continue from the
frozen LocalAgent source snapshot and Runtime-local state.

- AUTHORITY-RELATION subject=conversation-report-capture action=retain object=runtime-bounded-context-and-state value=required polarity=require
- AUTHORITY-RELATION subject=conversation-report-capture action=correlate object=localagent-anchor-turn-model-lineage value=complete polarity=require
- AUTHORITY-RELATION subject=conversation-report-capture action=read object=raw-system-prompt-or-private-context-lanes value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-capture action=expose object=credential-proof-or-private-runtime-input value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-execution action=retry object=provider-attempt value=denied polarity=forbid
- AUTHORITY-RELATION subject=conversation-report-capture action=commit object=product-turn-message-transcript-memory-localagent-state value=denied polarity=forbid
- AUTHORITY-RELATION subject=captured-behavior-observation action=become object=semantic-or-personality-truth value=denied polarity=forbid


---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-service-contract.md -->

# Runtime Agent Service Contract

> Owner Domain: `K-AGCORE-*`

Canonical naming note:

`RuntimeAgentService` is the steady-state design authority name on the canonical
spec path. Implementation-facing proto transport is now required to align to
`RuntimeAgentService`; `RuntimeAgentCoreService` is not an admitted steady-state
transport name.

Split authority map:

- `runtime-agent-life-autonomy-contract.md`: K-AGCORE-011..015 and K-AGCORE-027..031
- `runtime-agent-canonical-memory-contract.md`: K-AGCORE-016..021
- `runtime-agent-app-consume-contract.md`: K-AGCORE-032 and K-AGCORE-052
- `runtime-local-agent-materialization-contract.md`: K-AGCORE-139..143 and K-AGCORE-151..153
- `runtime-agent-ai-config-contract.md`: K-AGCORE-144..150
- `runtime-agent-context-composition-contract.md`: K-AGCORE-154..158

## K-AGCORE-001 RuntimeAgentService Authority Home

`RuntimeAgentService` is the runtime-owned authority for live agent execution.

It owns:

- agent lifecycle
- agent identity projection
- conversation continuity through runtime-owned `ConversationAnchor`
- life state
- autonomy state
- hook scheduling admission
- agent memory policy
- transient turn/presentation projection
- agent event emission

It consumes `RuntimeCognitionService` plus retained runtime-private memory depth
and must not be collapsed into a cognition or memory engine.

Fixed rules:

- runtime is multi-agent by default and may host multiple live `agent_id`
  lifecycles concurrently
- runtime must not infer or persist any platform-level default/current agent
- every agent-scoped ingress must resolve to explicit `agent_id`; app-local
  current/default/pinned agent selection remains above runtime-owned truth

## K-AGCORE-002 Chat Track / Life Track Split

`RuntimeAgentService` must maintain two distinct execution tracks:

- `Chat Track`
  - reactive
  - driven by user/app interaction
  - consumes conversation-anchor continuity and agent projections
- `Life Track`
  - proactive
  - driven by runtime-owned hook admission
  - consumes life state, memory recall, world context, and autonomy policy

The two tracks may share agent state and memory policy, but they must not collapse into a single undifferentiated scheduling surface.

## K-AGCORE-003 Typed Hook Intent

Life Track model output may not emit free-form execution logic.

It must emit typed `HookIntent` only. Trigger kinds are defined by
`config/runtime-memory-hook-trigger.yaml`.

Fixed rules:

- host-owned scheduler/admission is the only scheduling authority
- model output may request a typed intent, not executable logic
- scheduler owns timing, admission, cancellation, and budget checks
- active chat continuity may delay or suppress life hooks, but that suppression remains host-owned
- admitted implementation-facing transport must expose typed trigger-detail and
  hook-intent families with one branch per admitted trigger kind rather than a
  generic scheduler blob

## K-AGCORE-004 Agent Canonical Memory Policy

`RuntimeAgentService` is the semantic owner of canonical agent memory.

It decides:

- which events may become canonical memory
- which canonical class applies
- which bank scope may be written
- which memory layers may be recalled for agent execution
- which app-facing canonical memory bank mode/status is exposed
- whether a canonical agent memory bank bind request is admitted

Fixed rules:

- canonical classes continue to align to Realm `PUBLIC_SHARED`, `WORLD_SHARED`, and `DYADIC`
- infra scopes wider than canonical classes must not be reinterpreted as canonical memory by apps
- `RuntimeCognitionService` serves the runtime-facing overlap slice, while
  retained runtime-private memory depth stores canonical truth; in both cases
  `RuntimeAgentService` owns semantic admission
- app-facing canonical memory bank status and bind must go through
  `RuntimeAgentService`; SDK/apps must not compose canonical bank mode from
  editable host config, runtime-private embedding inspect state, or raw
  `GetBank` projections

## K-AGCORE-005 App Consumer Boundary

Apps consume `RuntimeAgentService` as controllers and projection readers.

For a third-party `LOCAL_APP`, the Runtime-derived
`local_app_principal_id` is the caller, access-control and audit subject only.
It never becomes `agent_id`, agent owner, conversation owner, memory-bank owner,
`subject_user_id`, or a default/current agent selector. The local-app operation
coordinator must resolve an explicit permitted agent and conversation relation
under the canonical RuntimeAgent/Cognition owner policy.

Apps may:

- initialize agents
- read state and memory projections
- read runtime-owned `AgentPresentationProfile` projection
- update state through admitted commands
- configure autonomy
- subscribe to agent events

Apps may not:

- own renderer-local canonical agent identity
- own renderer-local canonical memory truth
- directly schedule life-track execution
- directly mutate canonical agent bank scopes through Memory Service
- write thread-local avatar interaction state back as runtime-owned presentation truth
- attach LocalAgent source/world/relationship/knowledge, transcript, memory,
  policy, tool, media, or output-contract context to a turn
- submit system/developer roles, execution bindings, or a context manifest for
  Runtime Agent Chat
- infer agent, conversation, memory or source ownership from app identity,
  local-app principal, project path, process identity, record or permission decision

- AUTHORITY-RELATION subject=runtime action=accept object=consumer-attached-localagent-turn-context value=denied polarity=forbid

## K-AGCORE-006 Public Surface

`RuntimeAgentService` admits the following public operations:

- `MaterializeRealmSource`
- `InitializeAgent`
- `TerminateAgent`
- `GetAgent`
- `ListAgents`
- `OpenConversationAnchor`
- `GetConversationAnchorSnapshot`
- `ListAgentConversationSummaries`
- `RegisterAvatarLiveInstanceBinding`
- `ResolveAvatarLiveInstanceBinding`
- `GetPublicChatSessionSnapshot`
- `GetCompanionParticipationProjection`
- `RequestCompanionParticipation`
- `CancelCompanionParticipation`
- `OpenCompanionParticipationReplay`
- `GetAgentState`
- `UpdateAgentState`
- `EnableAutonomy`
- `DisableAutonomy`
- `SetAutonomyConfig`
- `ListPendingHooks`
- `CancelHook`
- `QueryAgentMemory`
- `WriteAgentMemory`
- `GetAgentCanonicalMemoryBankStatus`
- `RequestAgentCanonicalMemoryBankBind`
- `GetAgentCanonicalMemoryReviewStatus`
- `SetAgentPresentationProfile`
- `SubscribeAgentEvents`

The local-app protected carrier currently exposes no RuntimeAgent operation.
The public `agents.interact` permission is reserved, so inventory, Agent
selection, conversation open/turn/subscription/snapshot and voice operations
all return typed unavailable to `LOCAL_APP`. A valid local-app session exposes
only permission posture and unrelated base entitlements; it cannot enumerate
Agents to manufacture a selector. Bundled first-party callers retain their
separately admitted service entitlements and are not converted into third-party
principals.

The source-materialization operation above registers the K-AGCORE-139 and
K-AGCORE-151..153 semantic surface. Its public request contains only
`AgentRequestContext`, bounded `request_id`, and strict
`CharacterSourceRefV3`; its bounded response contains no Realm bearer/base,
grant material, challenge, packet, proof, manifest, segment, component, chunk,
or source core. Challenge, acquisition, verification, staging, and atomic
commit remain Runtime-private owner APIs.

Primary semantic outputs on this surface must use Nimi-owned typed messages:

- hook trigger detail must remain typed rather than free-form execution payload
- recalled agent memory must project typed memory records rather than raw provider JSON
- `QueryAgentMemory` may expose additive narrative projections, but it must not expose admitted truth state or behavioral posture as public wire truth
- when `QueryAgentMemory` exposes a stale narrative projection, the stale marker must remain explicit; RuntimeAgentService must not collapse stale narrative context into admitted truth state
- agent events must expose explicit failure / reschedule / budget states as typed event kinds
- app-facing transient turn / presentation / state projections must use the
  stable family-specific envelopes and detail shapes pinned in
  `config/runtime-agent-event-projection.yaml`
- model-facing agent chat output for the Live2D companion substrate
  continuation is governed by `agent-output-wire-contract.md`; APML output must
  be validated and projected into typed runtime events before apps treat it as
  product truth
- LocalAgent turn composition is governed by K-AGCORE-154..158; public reads and
  events may carry only `LocalAgentSourceContextStatus` and
  `AgentTurnContextSummary`, never the private manifest or lane content
- dynamic envelopes remain limited to auxiliary details / extensions fields
- implementation-facing transport must distinguish read projections from mutation commands; public agent state mutation may not devolve into arbitrary blob replacement
- implementation-facing transport must reserve typed families for `HookIntent`,
  `HookOutcome`, canonical memory candidate/view, and constrained state mutation
  payloads
- admitted implementation-facing transport must expose hook outcome detail as typed completed / failed / canceled / rescheduled / rejected families, and app-facing state mutation as a typed command/patch union rather than full-state replacement
- no public RuntimeAgentService method may admit proactive initiate-chat, public truth read/write, or public posture mutation unless a later rule explicitly admits those surfaces
- runtime-owned `AgentPresentationProfile` plus admitted
  `runtime.agent.turn.*` / `runtime.agent.presentation.*` /
  `runtime.agent.state.status_text_changed` /
  `runtime.agent.state.execution_state_changed` /
  `runtime.agent.state.emotion_changed` /
  `runtime.agent.state.posture_changed` projections may be exposed on read or
  subscription surfaces, but renderer-local session state must remain out of
  the public runtime truth model

Canonical LocalAgent public-surface relations:

- AUTHORITY-RELATION subject=runtime action=compose object=agentturncontextmanifestv1 value=runtime-owned polarity=require
- AUTHORITY-RELATION subject=agentturncontextmanifestv1 action=use-lanes object=turn-context value=fixed-typed polarity=require
- AUTHORITY-RELATION subject=localagent-source-content-and-prompt-hashes action=set-stability object=equivalent-source-content value=stable polarity=require
- AUTHORITY-RELATION subject=localagent-source-snapshot-hash action=set-stability object=identical-normalized-materialization value=cross-materialization-stable polarity=require
- AUTHORITY-RELATION subject=manifest-instance-hash action=set-specificity object=request-turn-instance value=instance-specific polarity=require
- AUTHORITY-RELATION subject=agentturncontextmanifestv1 action=carry object=transcript-context value=runtime-owned polarity=require
- AUTHORITY-RELATION subject=agentturncontextmanifestv1 action=carry object=memory-context value=bounded polarity=require
- AUTHORITY-RELATION subject=agentturncontextmanifestv1 action=carry object=token-budget value=explicit polarity=require
- AUTHORITY-RELATION subject=agentturncontextmanifestv1 action=carry object=truncation-decisions value=observable polarity=require
- AUTHORITY-RELATION subject=runtime action=project object=invalid-apml value=denied-fail-closed polarity=forbid
- AUTHORITY-RELATION subject=runtime-public-localagent-summaries action=project object=public-summary value=safe-bounded polarity=require
- AUTHORITY-RELATION subject=runtime-public-localagent-summaries action=expose object=raw-source value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime-public-localagent-summaries action=expose object=raw-prompt value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime-public-localagent-summaries action=expose object=raw-memory value=denied polarity=forbid
- AUTHORITY-RELATION subject=runtime-public-localagent-summaries action=expose object=raw-proof value=denied polarity=forbid

Typed family registry is defined by
`tables/runtime-agent-service-typed-family.yaml`.

## K-AGCORE-006e Reserved Local-App Agent Selector Boundary

No zero-permission Agent inventory exception is admitted. No local-app Agent
inventory RPC or shell operation exists; SDK, Kit, Desktop and compatibility
bridges must not recreate one.

When `agents.interact` is admitted as a complete `P-PERM-017` slice, the
canonical Agent owner picker selects the bounded Agent set before the app gets
authority. The app receives only the public selected-Agent projection and may
then use the operation families mapped to that one product intent. It does not
receive full account Agent inventory, raw owner ids, internal operation ids,
resource fingerprints or a selector-building API. Until that owner picker,
decision lifecycle, audit, settings/revoke UX and endpoint enforcement all
exist, every third-party Agent read or mutation fails closed.

## K-AGCORE-006a Public Chat Conversation Cutover Prerequisites

Runtime Agent Chat transcript and session truth already belongs to
`RuntimeAgentService`, but deleting host-local projection caches requires an
admitted app-facing replacement for the product journeys those caches currently
serve.

Before a host removes an Agent Chat `chat_agent_*` projection-cache store,
Runtime / SDK must provide admitted coverage for:

- conversation summary listing scoped to the authenticated calling app,
  explicit local agent identity, and owner context
- recovery of a selected conversation through `ConversationAnchor` plus
  `GetPublicChatSessionSnapshot`
- a close / delete / clear policy for user-visible conversation history
- message-level delete / redact policy before any app exposes per-message
  deletion or redaction controls
- a single-active-conversation policy for each CharacterSourceRefV3/v3
  provenance / LocalAgent projection
- explicit rejection of Agent Chat draft persistence, rename/archive
  conversation semantics, and Desktop offline transcript recovery

These prerequisites do not admit Desktop-local transcript, message, turn, beat,
or projection rebuild truth. They only define the Runtime / SDK replacement
surface that must exist before host-local migration stores can be removed.

## K-AGCORE-006b Public Chat Conversation Summary Listing

`RuntimeAgentService` admits `ListAgentConversationSummaries` as a read-only
conversation-summary query for Runtime-owned Agent Chat anchors.

Fixed rules:

- the query must be scoped to the calling app, explicit local agent identity,
  owner context, and Runtime-owned `ConversationAnchor` truth
- summaries must be ordered by `updated_at DESC, conversation_anchor_id ASC`
  and use runtime pagination fields
- each summary may expose a display `title`, but that title is derived
  presentation text, not a separate persisted Runtime conversation-title truth
- each summary may expose last-message role / text / id and transcript count
  only as projection data derived from Runtime-owned session transcript state
- `GetPublicChatSessionSnapshot` remains the recovery source for selected
  conversation transcript and turn detail
- this query does not admit close, delete, clear, archive, rename, draft, or
  multi-conversation mutation policy; clear/delete/redact actions remain covered
  by K-AGCORE-006a prerequisites until explicitly admitted elsewhere
- Agent Chat rename and archive are not product surfaces. Runtime must not add
  persistent user-authored conversation titles, archive flags, or multi-session
  management for Agent Chat unless a later product decision admits them.
- Runtime must present one active Agent Chat conversation per runtime source
  snapshot / LocalAgent projection. `ListAgentConversationSummaries` may page over
  different agents and historical Runtime anchors as migration evidence, but it
  must not become a user-facing multi-conversation product model.

## K-AGCORE-006c Public Chat Transcript Envelope Projection

`GetPublicChatSessionSnapshot` owns the app-facing replay envelope for
Runtime-owned Agent Chat transcript messages.

Fixed rules:

- every transcript entry projected by `GetPublicChatSessionSnapshot` must carry
  Runtime-owned replay identity fields (`id`, `created_at`, `updated_at`).
  If Runtime cannot produce those fields, the transcript entry is not
  replayable and SDK/app consumers must fail closed instead of deriving them.
- transcript entry `status` and `kind` are projection metadata, not model
  output truth; text transcript entries default to `status=complete` and
  `kind=text`
- transcript entry ids may be derived from `conversation_anchor_id` plus stable
  transcript index until Runtime stores per-message ids directly; that
  derivation is Runtime-owned and must not be re-derived differently by apps
- transcript entry timestamps may be derived from Runtime anchor/session time
  until Runtime stores per-message timestamps directly; apps may display them
  but must not reinterpret them as provider event time
- richer fields such as reasoning text, trace id, media/artifact metadata,
  error state, and parent linkage may only be trusted when Runtime projects
  them. Parent linkage for ordinary text assistant replies is Runtime-owned
  replay metadata, not an app-local adjacency inference.
- this envelope does not admit Desktop-local transcript persistence; it exists
  to let apps replay Runtime session snapshots without fabricating transcript
  identity locally
- this envelope does not admit offline Agent Chat transcript recovery from app
  storage. If Runtime is unavailable, apps may retain in-memory display state for
  the current renderer session, but restart recovery must come from Runtime
  snapshots, not from Desktop-local transcript stores.

## K-AGCORE-006d Agent Chat Non-Equivalence Boundary

Runtime Agent Chat authority is scoped to Runtime Agent lifecycle. It must not
be generalized into a daemon-owned product chat-history service for ordinary
apps.

Agent Chat belongs to `RuntimeAgentService` because it consumes and mutates
agent-owned lifecycle state: explicit `agent_id`, runtime-owned
`ConversationAnchor`, agent memory policy, turn planning, presentation/action
projection, voice/media workflow execution, and agent event emission.

Fixed rules:

- Runtime Agent Chat session / transcript replay remains Runtime-owned.
- `runtime.agent` app-message traffic is a reserved Agent Chat consume seam, not
  a generic app chat bus.
- `RuntimeAiService` owns AI execution, provider/model routing, readiness,
  jobs, artifacts, and fail-closed enforcement; it does not own ordinary app
  product session, thread, message, or draft truth by default.
- Generic ChatGPT-like, Codex-like, domain-assistant, or simple LLM
  product-session history must not be added to Runtime solely because it uses
  Runtime AI consume.
- Reusable non-authoritative app AI session-loop support belongs in SDK DX
  surfaces; durable product session truth belongs to the owning app or Realm
  unless a later Runtime / Cognition / Platform rule explicitly admits it.

Any proposal for a new Runtime-owned AI conversation/session store outside
Agent lifecycle must include a separate authority rule naming the lifecycle,
security, data-correctness, audit, or cross-app invariant that requires Runtime
ownership. Absent that rule, ordinary app AI session persistence remains outside
Runtime.

## K-AGCORE-007 Token Budget Authority

`RuntimeAgentService` owns token budget policy for Life Track autonomy.

Fixed rules:

- token budget configuration is runtime-owned and belongs to agent autonomy state
- token budget remains a quota and safety guardrail, not the primary cadence truth
- budget state must be observable through agent state or agent events; hidden depletion is not admitted
- the default budget window is daily unless a stricter runtime-owned policy is admitted elsewhere
- budget exhaustion suspends or rejects Life Track execution only; Chat Track remains separately governed by runtime product policy
- model output must not mutate budget truth directly

## K-AGCORE-008 Failure Semantics

`RuntimeAgentService` must fail-close on substrate unavailability and keep hook outcomes observable.

Fixed rules:

- agent initialization requires runtime-owned local prerequisites to be
  available; if RuntimeAgentService cannot rely on `RuntimeCognitionService`, retained
  runtime-private memory depth, or the required local substrate, the call must
  fail with `UNAVAILABLE`
- the required local memory substrate boundary referenced here is the runtime-private contract in `K-MEMSUB-*`, not a public local-engine target
- Realm replication unavailability does not authorize pseudo-success; initialization may proceed only when local bootstrap truth is sufficient and pending replication remains observable
- Life Track model failure, memory write failure, or scheduler admission failure must produce an observable agent event or reasoned rejection
- pending hooks may be rescheduled or canceled explicitly, but they must not disappear silently after a failed life-turn attempt

## K-AGCORE-009 Hook Lifecycle Store

`RuntimeAgentService` must keep hook lifecycle truth in a runtime-owned store.

It owns:

- admitted pending-hook persistence
- admission-state transitions for `pending`, `running`, `completed`, `failed`,
  `canceled`, `rescheduled`, and `rejected`
- host-owned cancellation checks
- life-track execution-state projection derived from hook lifecycle truth

Fixed rules:

- `ListPendingHooks` must read from runtime-owned hook state, not from caller-supplied projection or ephemeral renderer memory
- `CancelHook` may only transition hooks that remain host-cancelable; terminal hook outcomes must stay immutable
- typed `HookIntent` and typed trigger detail must be validated before a hook
  becomes admitted scheduler truth
- hook admission-state transitions must persist before event publication so that
  replayed event cursors and hook listing observe the same committed truth
- runtime may keep terminal hook outcomes visible for audit/history, but active hook visibility must remain distinguishable from terminal outcomes

## K-AGCORE-010 Agent Event Stream Source

`SubscribeAgentEvents` must stream from a runtime-owned committed agent event log.

Fixed rules:

- lifecycle, hook, memory, budget, and replication events must be appended only after the corresponding runtime-owned state transition or admission outcome is committed
- cursor resume semantics must read from the committed event log rather than re-synthesizing events from current snapshots
- hook-related events must originate from hook lifecycle transitions, not from thin wrappers around RPC responses
- subscriber filtering may narrow delivery, but it must not invent missing hook outcomes or hide committed cancellation / failure / reschedule events


---

<!-- source: .nimi/spec/runtime/kernel/runtime-local-agent-materialization-contract.md -->

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
canonical Realm base and authenticated account bearer through Runtime-owned
account/custody interfaces, and calls a constructor-injected private
`RealmMaterializationIssuer`. Source materialization is an authenticated
first-party product operation, not an App permission or synthetic grant.

The production authority chain is exact and internal to Runtime acquisition:

1. Runtime captures one authenticated account generation and one strict typed
   source ref selected by the product flow;
2. Runtime sends only that source ref, the authenticated account id, a fresh
   Runtime challenge/audience/expiry and the eight published limits to
   `POST /api/realm/core/source-materialization-packets`;
3. Realm reloads canonical source/world/dependency truth, enforces current
   materialization visibility for the authenticated account, requires complete
   readiness, and returns a short-lived signed Packet v3; and
4. Runtime verifies the complete Packet/closure/proof/replay/account binding and
   performs one atomic LocalAgent commit.

The request and decision contain or consult none of `appId`, `scopeFamily`,
`scopeName`, `qualifier`, `accessGrantId`, `AppPermissionGrant`, a Runtime-local
K-GRANT row, or a caller-selected bearer, header, endpoint or grant id. Runtime
MUST NOT call a Realm permission request or decision endpoint as part of this
flow, especially not request and approve a grant with the same account bearer.
The retired `realm_source.snapshot.consume` and
`realm_source.snapshot.bind` identifiers are non-authorizing and forbidden
from positive implementation or evidence.

`MaterializeRealmSource` does not establish, infer, request, or check a
Runtime-local app permission decision or first-party local app principal. In particular,
`agent.identity.project` and any Avatar local seed grant are not inputs,
authorization gates, or outputs of this operation. Realm owns canonical
Character/World visibility and current Packet v3 issuance; it has no Agent or
LocalAgent ontology. Runtime alone owns acquisition, verification,
transaction, LocalAgent, snapshot, provenance, context compilation, and
lifecycle, and no LocalAgent exists before the verified atomic commit.

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
  `config/runtime-agent-event-projection.yaml` and must carry an `audit_ref`.
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
local-app permission decisions or storage, provider/model/config, Realm canonical records, or
non-source-backed LocalAgents. It reports only safe ids and exact counts.

Source revision, Realm deletion/availability, app metadata, and provider
metadata never mutate, rebase, or write back an existing snapshot. After a
successful capture, Realm may be offline and the LocalAgent remains chat-ready
from its validated SnapshotV2 plus Runtime truth. A newer revision creates a
new opaque LocalAgent, snapshot, conversation/transcript scope, and memory
scope. Restart rehydrates the exact validated state without contacting Realm
or substituting current source data. Missing or invalid snapshot, provenance,
account, agent, or anchor binding fails closed with a typed status.

