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
`tables/runtime-memory-hook-trigger.yaml`.

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
  local-app principal, project path, process identity, record or grant

- AUTHORITY-RELATION subject=runtime action=accept object=consumer-attached-localagent-turn-context value=denied polarity=forbid

## K-AGCORE-006 Public Surface

`RuntimeAgentService` admits the following public operations:

- `CreateSourceMaterializationChallenge`
- `BeginSourceMaterializationUpload`
- `PutSourceMaterializationChunk`
- `CommitSourceMaterialization`
- `AbortSourceMaterializationUpload`
- `InitializeAgent`
- `TerminateAgent`
- `GetAgent`
- `ListAgents`
- `ListLocalAppAgentInventory`
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

The local-app protected carrier exposes only the zero-grant bounded inventory
operation admitted by K-AGCORE-006e and the selected conversation subset: open
an explicit conversation anchor, submit a user turn, subscribe to that turn,
and recover the explicit conversation snapshot. Conversation calls must pass
the `K-ACCSVC-026` decision for the same principal/session/grant and exact agent
and conversation relation. Inventory uses the narrower zero-grant caller
decision defined by K-ACCSVC-022 and does not create, imply, or cache a grant.
All other RuntimeAgent operations are typed unavailable to `LOCAL_APP` until an
owner rule admits them; local-app session validity alone does not broaden this
list. Bundled first-party callers retain their separately admitted posture and
are not converted into third-party principals.

The source-materialization operations above register the K-AGCORE-151..153
semantic surface only. Their concrete Proto messages and fields are not defined
by this authority iteration; the implementation-facing transport must be added
through the later Proto/codegen authority cut without weakening the state
machine, typed limits, immutable record, or public privacy boundary.

Primary semantic outputs on this surface must use Nimi-owned typed messages:

- hook trigger detail must remain typed rather than free-form execution payload
- recalled agent memory must project typed memory records rather than raw provider JSON
- `QueryAgentMemory` may expose additive narrative projections, but it must not expose admitted truth state or behavioral posture as public wire truth
- when `QueryAgentMemory` exposes a stale narrative projection, the stale marker must remain explicit; RuntimeAgentService must not collapse stale narrative context into admitted truth state
- agent events must expose explicit failure / reschedule / budget states as typed event kinds
- app-facing transient turn / presentation / state projections must use the
  stable family-specific envelopes and detail shapes pinned in
  `tables/runtime-agent-event-projection.yaml`
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

## K-AGCORE-006e Bounded Local-App Agent Inventory

`ListLocalAppAgentInventory` is the sole LOCAL_APP inventory operation. Its
request is empty. It is available to an admitted `local_development` principal
with a live, verified, process-bound local-app session even when that session
has zero grant. This exception exists only to break the bootstrap cycle between
discovering an Agent ref and requesting the exact
`runtime_agent.conversation.open` grant for `agent:<local_agent_ref>`.

Runtime must revalidate the current OS-user-bound session, principal, record,
project generation, account id/generation, process, and boot epoch on every
call. It then filters canonical RuntimeAgentService truth to active LocalAgents
whose `owner_user_id` equals the current authenticated account. The caller may
provide no account, OS user, owner, filter, page, capability, resource, grant,
or authority field. A different OS user can never reuse the verified session;
a different account sees no rows. Session/account/revoke/epoch failure denies
the call before projection. Every admitted inventory read is audit logged with
the Runtime-derived principal, account, session and result count; absence of
the audit owner fails closed.

The response is bounded to at most 200 entries and contains exactly
`owner_user_id`, `count`, and `local_agents`. Each `local_agents` entry contains
exactly `local_agent_ref`, `display_name`, `owner_user_id`,
`runtime_source_ref`, and `source_ready`. Runtime fails closed rather than
returning a partial result when the bound would be exceeded or when an entry
cannot satisfy canonical ref/owner/source correlation. Memory, AI config,
provider/model detail, conversation data, source hashes/content, private
runtime state, timestamps, grant state, and portable authority material are
forbidden.

The selected Standard Shell operation name is `local-app.agentInventory`; the
SDK surface is `agent.listInventory()`. The operation has no caller-selected
resource and no grant-binding row: its implicit resource is the ephemeral
intersection of the current verified OS-user session and current authenticated
account. Its result is not authorization or durable app truth. Consumers must
refetch after session rebuild; logout, account switch, process replacement,
project revoke, and Runtime restart retain their existing invalidation
semantics. Generic `ListAgents`, `runtime.unary`, and app-side inventory caches
are not fallbacks.

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
- a single-active-conversation policy for each SourceMaterializationPacket
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
