# Runtime Memory World - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/canonical/runtime/memory-world.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/runtime-agent-canonical-memory-contract.md -->

# Runtime Agent Canonical Memory Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent canonical review, truth read, coordination, and chat/life evidence admission authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-016 Canonical Review Ownership

`RuntimeAgentService` owns canonical review for agent-facing memory scopes.

It owns:

- review scheduling
- review token-budget admission
- review trigger policy
- review executor selection
- truth candidate admission and supersession policy

It does not own:

- public Memory Service `Reflect` semantics
- Memory Service storage and cascade of admitted derived outputs

Fixed rules:

- canonical review for `AGENT_CORE`, `AGENT_DYADIC`, and admitted `WORLD_SHARED` scopes must execute through a RuntimeAgentService-owned runtime-private review path
- retired public `Reflect` semantics on the runtime cognition cutover path must
  not be reintroduced as the canonical review scheduler by implication
- canonical review must use a dedicated runtime-private review executor contract rather than extending the admitted `Life Turn` result contract
- admitted review output is limited to narrative candidates, truth candidates, optional relation candidates, summary, token usage, and review-window metadata
- the model-facing canonical review executor output contract is the APML
  `<canonical-review>` root admitted by `agent-output-wire-contract.md`; JSON
  executor output compatibility is not admitted
- extracting review storage mechanics into a runtime-owned internal memory library does not transfer review ownership, scheduling, admission policy, or recovery semantics away from RuntimeAgentService
- truth candidate admission and conflict handling remain RuntimeAgentService-owned even when Memory Service persists the resulting state

## K-AGCORE-016a Canonical Review Status Projection

`RuntimeAgentService` admits a narrow read-only canonical review status
projection for agent-facing memory banks.

It may project:

- the validated canonical bank locator
- whether the Runtime-owned canonical review executor is currently available
- the last committed review follow-up id, checkpoint basis, and completion time
- the next eligibility time derived from Runtime-owned review cadence policy
- whether a recoverable runtime review run currently blocks fresh scheduling

Fixed rules:

- this projection is bank-level scheduler/follow-up observability, not a
  per-memory-record review truth field
- the projection must derive from RuntimeAgentService-owned review persistence,
  committed follow-up rows, and review cadence constants; SDKs and apps must
  not derive equivalent status from memory metadata, summaries, timestamps,
  UI state, or app-local caches
- the projection must not expose admitted truth state, narrative bodies,
  prepared review outcomes, or model-facing canonical review input/output
  payloads
- no mutation, redaction, forget, retire, or review execution command is
  admitted by this read surface
- recoverable `prepared` / `memory_committed` review runs must be explicit
  blocking state rather than hidden as ordinary eligibility or pseudo-success
- missing canonical bank state must be explicit `BANK_UNAVAILABLE` readiness
  rather than causing callers to synthesize lifecycle state

## K-AGCORE-017 Runtime-Private Chat Track Sidecar Contract

`RuntimeAgentService` may consume a runtime-private sidecar result from Chat Track execution.

Fixed rules:

- sidecar parsing and validation must remain runtime-owned; renderer or client code must not become the semantic owner of sidecar payloads
- admitted sidecar output is limited to posture patch, emotion update, hook
  cancellations, typed `HookIntent`, and canonical memory candidates
- the model-facing sidecar executor output contract is the APML
  `<chat-track-sidecar>` root admitted by `agent-output-wire-contract.md`; JSON
  executor output compatibility is not admitted
- sidecar output must not admit proactive initiate-chat semantics, arbitrary state mutation, direct world/user mutation, or free-form scheduling logic
- typed `HookIntent` and canonical memory candidates returned by the sidecar
  must pass the same runtime-owned validators used elsewhere on
  RuntimeAgentService
- invalid sidecar output must fail closed without silently mutating committed posture, hooks, or memory truth

## K-AGCORE-018 Runtime-Private Canonical Truth Read Boundary

`RuntimeAgentService` must consume admitted truth and review-input data
through a runtime-private typed read boundary provided by retained
runtime-private memory depth.

Fixed rules:

- RuntimeAgentService must not read admitted truths, narrative context, canonical review inputs, or review checkpoints by direct database access
- runtime-private truth read surfaces must return typed runtime contract data rather than raw store rows or provider-native blobs
- RuntimeAgentService must continue to consume this boundary through the retained
  runtime-private memory facade even if the underlying mechanics are implemented
  by a runtime-owned internal library
- prompt assembly may inject admitted truths and narrative context from this runtime-private read path, but that does not create a public truth API

## K-AGCORE-019 Canonical Review Coordination Model

`RuntimeAgentService` owns cross-owner coordination for canonical review
runs, while retained runtime-private memory depth owns atomic persistence of
memory state.

Fixed rules:

- RuntimeAgentService must submit canonical review outcomes through a single runtime-private commit request identified by `review_run_id`
- Memory Service must commit all review-owned narrative / truth / lineage mutations atomically and idempotently for that `review_run_id`
- RuntimeAgentService must publish follow-up checkpoint, hook, or event truth only after the Memory Service commit succeeds
- internal library extraction must preserve this dual-phase coordination model rather than collapsing RuntimeAgentService into direct store mutation or distributed-transaction coupling
- RuntimeAgentService recovery and coordination must not absorb backlog/replay ownership or mutate pending replay truth outside the Memory Service owned boundary, even when internal helper extraction changes where storage mechanics live
- the admitted coordination model is idempotent dual-phase coordination, not distributed transaction coupling

## K-AGCORE-020 Chat/Life Evidence To Canonical Memory Admission Boundary

`RuntimeAgentService` owns the runtime-private stabilization boundary between
chat/life conversational evidence and canonical memory candidate admission.

It owns:

- evidence-to-candidate stabilization for chat-track and life-track outputs
- same-window correction absorption before durable candidate admission
- candidate-level distinction between transient conversational evidence and
  stable canonical memory proposal

It does not own:

- direct persistence of raw chat transcript as canonical memory truth
- retained runtime-private memory dedup mechanics or downstream storage behavior
- truth-level supersession once conflicting durable memory has already been
  committed across separate windows

Fixed rules:

- chat transcript, conversation continuity, and life-turn conversational evidence are
  source evidence inputs, not canonical memory truth by default
- runtime-private chat-sidecar and life-turn outputs may emit canonical memory
  candidates only after RuntimeAgentService-owned stabilization over the current evidence
  window
- explicit same-window self-correction or contradiction must not by default be
  emitted as two conflicting durable canonical memory candidates from the same
  evidence window
- candidate `source_event_id` and provenance preserve evidence lineage, but
  they do not imply that every intermediate utterance becomes durable memory
  truth
- retain-time dedup remains a downstream concern over stabilized candidates; it
  must not become the primary owner of immediate conversational correction
- truth admission, stale/supersession, and later derived projection updates
  remain the downstream path for cross-window correction after durable memory
  has already been committed

## K-AGCORE-021 Standalone Cognition Consumption Boundary

`RuntimeAgentService` may consume standalone cognition through explicit bridge paths, but it does not own cognition semantics.

Fixed rules:

- RuntimeAgentService remains the runtime owner of live agent execution, canonical admission, and runtime-private posture/hook truth
- if runtime consumes standalone cognition kernels, prompt context, or advisory outputs, that consumption must remain adapter-owned rather than semantic ownership
- cognition runtime bridge and prompt-serving boundaries are governed by `.nimi/spec/cognition/kernel/runtime-bridge-contract.md`, `.nimi/spec/cognition/kernel/prompt-serving-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-bridge-boundary.yaml`
- RuntimeAgentService must not redefine cognition object model, cleanup semantics, or standalone public surface by implementation convention
- runtime/private cognition consumption does not authorize collapsing cognition authority back into runtime contracts


---

<!-- source: .nimi/spec/runtime/kernel/runtime-memory-service-contract.md -->

# Runtime Cognition And Retained Memory Depth Contract

> Owner Domain: `K-MEM-*`

## K-MEM-000 Runtime Target Identity v2 Hard Cut

Runtime Agent AI Config `text.embed` intent uses v2 target refs from
`K-RTARGET-*` or another spec-admitted typed binding reference. Provider/model
facts may appear only after resolution as bank profile facts. Any older
`provider + model_id` durable memory identity in this file is retired.

## K-MEM-001 RuntimeCognitionService Authority Home And Retained Memory Depth

`RuntimeCognitionService` is the sole admitted runtime-facing cognition owner
surface on the runtime path.

This authority home also records the retained runtime-private memory depth that
remains outside that public service topology.

It owns:

- the runtime-facing memory overlap slice republished through
  `RuntimeCognitionService`
- bank lifecycle and bank isolation truth
- embedding profile binding
- provider bridge and substrate truth
- runtime-owned replication into Realm
- runtime-private narrative / lineage / canonical read-commit boundaries

It does not own:

- agent identity
- agent life state
- agent canonical memory semantics
- account authn/authz truth

Fixed rules:

- `RuntimeCognitionService` replaces `RuntimeMemoryService` and
  `RuntimeKnowledgeService` as the future runtime-facing public topology
- no second runtime-facing memory/knowledge owner surface may remain admitted in
  steady state beside `RuntimeCognitionService`
- retained runtime-private memory depth must stay explicit; topology
  replacement must not collapse RuntimeAgentService, bank/access, provider,
  replication, workflow, or canonical review truth into cognition by
  implication

`Working memory` remains outside retained runtime memory truth. Prompt assembly
state, tool traces, turn plans, and other runtime execution scratch state must
remain outside this retained memory authority.

## K-MEM-002 Bank Scope And Isolation

Retained runtime memory bank scope is defined by
`tables/runtime-memory-bank-scope.yaml`.

Fixed rules:

- every memory unit belongs to exactly one bank
- banks are isolated from one another
- admitted implementation-facing transport must expose a scope-typed bank locator family with dedicated owner branches for `AGENT_CORE`, `AGENT_DYADIC`, `WORLD_SHARED`, `APP_PRIVATE`, and `WORKSPACE_PRIVATE`
- `APP_PRIVATE` and `WORKSPACE_PRIVATE` are the infra-only locator branches on
  the public app-facing runtime cognition path
- runtime may internally normalize these scopes through a typed-principal descriptor model only if the admitted public locator family, owner-role meaning, and locator-key compatibility remain unchanged
- cross-scope owner combinations (for example, a `WORLD_SHARED` bank carrying an app-private owner shape) must not appear as a normal public contract form
- `AGENT_CORE`, `AGENT_DYADIC`, and `WORLD_SHARED` are canonical-agent-facing scopes
- `APP_PRIVATE` and `WORKSPACE_PRIVATE` are infra scopes and must not be collapsed into canonical agent memory
- `WORLD_SHARED` continuity is keyed by `world`, not by `account`
- public app-facing bank creation is admitted only for `APP_PRIVATE` and `WORKSPACE_PRIVATE`
- canonical agent-facing scopes are provisioned by runtime-owned internal paths, not by app-facing `CreateBank`

Account identity may constrain access, but account must not become the physical truth owner of `WORLD_SHARED`.

## K-MEM-003 Provider Boundary

The runtime memory path remains provider-agnostic across both the retained
runtime-private depth and the runtime-facing `RuntimeCognitionService` memory
family.

Fixed rules:

- runtime-facing memory RPC and SDK surfaces must expose Nimi-owned operation
  names and types through `RuntimeCognitionService`
- primary semantic memory payloads must use Nimi-owned typed messages; dynamic envelopes are limited to metadata, attributes, or extensions fields
- admitted implementation-facing transport must reserve a typed memory record family for `episodic`, `semantic`, and `observational` records rather than collapsing durable memory into a free-form blob payload
- provider-native wire shapes, bank config fields, and provider-specific storage semantics must remain internal
- extracting memory mechanics into a runtime-owned internal library or subpackage is not provider admission and must not create a new public engine-facing naming or proto layer
- memory is explicit opt-in rather than a baseline product capability; when enabled without an attached override, the default experimental substrate is runtime-managed `Hindsight`
- retired public `Reflect` must not be reintroduced as a substrate-owned
  pseudo-review surface; canonical review remains runtime-private under
  `RuntimeAgentService`
- runtime-private substrate connectivity, feature floor, and typed identity overlay requirements are governed by `K-MEMSUB-*`
- provider engines must not own account auth, app authz, agent ownership, or canonical memory semantics

## K-MEM-004 Embedding Profile Immutability

Each bank may begin without a bound embedding profile.

If a bank binds an embedding profile, the fixed profile must contain at least:

- provider
- model_id
- dimension
- distance_metric
- version
- migration_policy

Fixed rules:

- bank creation may admit `embedding_profile = null`
- a null-profile bank remains valid operational memory truth and must not be treated as malformed by default
- if the embedding profile is null, embedding-backed retain/recall/dedup behavior is not admitted for that bank
- once a bank binds a non-null embedding profile, the profile is part of bank identity
- bank writes and embedding-backed recalls must use the same bound profile
- provider engines must not silently switch embedding models
- profile dimension changes require explicit migration rather than in-place drift
- any material profile change to `provider`、`model_id`、`dimension`、
  `distance_metric`、`version`、or equivalent bound profile identity field must
  be treated as bank-identity change rather than route retargeting
- the first admitted switching form for a materially changed non-null profile is
  runtime-owned create-new-bank-or-generation rebuild plus explicit cutover;
  silent in-place mutation is not admitted
- runtime-owned embedding execution is the only admitted embedding authority
- the resolved profile `dimension` authority is the runtime model catalog
  (`model-catalog-voice-workflow-contract.md` `K-MCAT-030` `embedding.dimension`), not the local
  asset record and not a hardcoded constant; resolving an embedding profile for a
  `text.embed` model with no admitted catalog dimension must fail close rather
  than fabricate a dimension or silently retarget to another model
- the embedding vector length returned by execution is used only for runtime
  validation and drift evidence; on mismatch with the resolved profile dimension
  runtime must fail close, and must never mutate the resolved profile to match an
  observed length
- when the default `Hindsight` substrate runs in supervised mode, runtime must inject the substrate's embedding path onto a runtime-owned llama OpenAI-compatible loopback rather than allowing direct external embedding provider configuration

## K-MEM-004a Runtime Agent AI Config And Runtime Resolved Truth Split

Memory embedding consume intent for Runtime Local Agent belongs to Runtime Agent
AI Config, not Desktop, Zhiyu, standalone cognition, or a memory-local intent
store. Runtime memory and RuntimeCognitionService own only resolved retained
memory execution truth and bank lifecycle state.

Fixed rules:

- Runtime Agent AI Config owns the agent-instance committed `text.embed` intent
  for memory, cognition, activity/query, knowledge/retrieval, and future local
  agent consume paths
- Desktop and Zhiyu may render Kit controls and submit typed mutations through
  Runtime/SDK only; they must not own user-editable memory embedding source or
  binding persistence
- standalone cognition may retain standalone profile/config authority for
  non-runtime use, but RuntimeCognitionService must not persist an independent
  runtime embedding intent
- runtime is the only admitted owner of resolved embedding profile, binding
  legality/readiness, bank identity, rebuild state, migration state, and
  cutover result
- runtime must consume the committed `text.embed` intent through the admitted
  RuntimeAgentService boundary and fail-close when the binding cannot resolve to
  an admitted runtime execution path
- resolved memory embedding profile identity must preserve the typed runtime
  execution binding consumed from Runtime Agent AI Config. For cloud source, the
  resolved profile must carry `connector_id`, `remote_model_catalog_id`,
  `provider_model_id`, and `provider` as a typed cloud binding in addition to
  provider/model/dimension facts. For local source, the resolved profile must
  carry the v2 local binding (`profile_binding_id` or `readiness_ref`) in
  addition to provider/model/dimension facts.
- runtime embedding execution must consume the resolved profile's typed
  execution binding. It must not reconstruct a cloud execution target from
  `version`, raw `model_id`, or the retired connector/model pair, and must
  fail-close when the typed binding is absent for a cloud profile.
- Runtime Agent AI Config `text.embed` is keyed once per Runtime Local Agent
  instance; per-bank resolved profile, bind status, rebuild, migration, and
  cutover remain Runtime memory / RuntimeCognitionService state
- renderer-local heuristics, local-asset presence checks, or host convenience
  projections must not be reinterpreted as runtime bank truth

## K-MEM-005 Realm Replication Boundary

Realm is the cloud/shared replicated persistence and governance plane for runtime-owned continuity memory. On the public repo authority path, Realm is not the semantic owner.

Fixed rules:

- runtime local memory is the operational authority
- RealmSyncBridge is runtime-owned and provider-independent
- replication into Realm must preserve explicit provenance and version history
- conflict handling must be observable and auditable
- silent overwrite merge is not admitted
- app or SDK code must not bypass runtime to mutate agent canonical memory once runtime-owned memory authority is active

Realm-originated governance operations remain authoritative for the replicated plane:

- moderation or governance invalidation committed in Realm must propagate down into runtime local memory
- runtime must not continue serving a locally cached canonical memory item as valid after a replicated invalidation is observed
- local operational authority does not permit runtime to override or ignore an admitted replicated governance decision

## K-MEM-006 RuntimeCognitionService Public Memory Family

`RuntimeCognitionService` admits the absorbed runtime-facing memory family:

- `CreateBank`
- `GetBank`
- `ListBanks`
- `DeleteBank`
- `Retain`
- `Recall`
- `History`
- `DeleteMemory`
- `SubscribeMemoryEvents`

Fixed rules:

- these operations are now admitted only on `RuntimeCognitionService`; they
  must not be written back as a separate future public service
- `Reflect` is retired from the public steady-state surface and survives only as
  a re-audit baseline for the cutover
- app-facing access remains infra-scoped; canonical agent-facing scopes remain
  runtime-private and must not be widened back into a public memory service by
  migration convenience
- app-facing bank creation may still omit an embedding profile, and runtime must
  preserve that null-profile truth
- runtime-facing memory reads may expose additive narrative projections, but
  canonical truth, review admission, and replication truth remain outside the
  public service surface
- extracting implementation logic into runtime-owned internal libraries must not
  recreate `RuntimeMemoryService` as a second public owner surface

## K-MEM-006a Typed Boundary And Canonical Bind/Cutover Boundary

Canonical retained-memory bind / rebuild / cutover flows must not be admitted
through convenience transport by drift.

Fixed rules:

- the current private loopback HTTP convenience path for canonical bind is not
  the admitted steady-state product contract
- Desktop/app consumers may read/write Runtime Local Agent memory embedding
  consume intent only through Runtime Agent AI Config typed SDK surfaces
- Desktop/app consumers may inspect resolved memory embedding state and request
  canonical bank bind / rebuild / cutover only through admitted Runtime memory /
  RuntimeCognitionService typed surfaces
- `RuntimeCognitionService` public memory family remains fixed by `K-MEM-006`;
  migration convenience must not expand that public family just to expose
  canonical agent-facing bank control
- canonical agent-facing bind / rebuild / cutover semantics remain on
  runtime-private typed paths owned by retained runtime memory depth

## K-MEM-006b Runtime-Private Memory Embedding Operation Family

当 host product 需要 memory embedding resolved state 与 canonical bank lifecycle
操作时，retained runtime-private memory depth 必须提供最小的 typed logical
operation family。

该 family 是 runtime-private typed boundary，不是新的 public RPC family，也不是
新的 embedding intent owner。

最小 logical operations 固定为：

- `InspectMemoryEmbeddingState`
- `RequestCanonicalMemoryEmbeddingBind`
- `RequestMemoryEmbeddingCutover`

固定规则：

- Runtime Agent AI Config owns the agent-instance committed `text.embed` intent;
  retained runtime-private memory depth must consume it and must not persist a
  second memory-local binding intent
- Desktop / Web / Tester 不得通过 localStorage、renderer store、app-local config
  file、或每次请求夹带的 snapshot 持久化或重放 `text.embed` intent
- `InspectMemoryEmbeddingState` 必须返回 typed runtime contract data，至少覆盖：
  - 当前 Runtime Agent AI Config `text.embed` intent 的 resolution verdict 与
    `config_revision`
  - resolved embedding profile identity 或 fail-close unavailable result
  - 当前 canonical bank binding status
  - 是否存在 rebuild / generation / cutover pending state
  - explicit unavailable / blocked reason
- 若 host-facing config scope 不足以唯一确定 canonical bank lifecycle owner，
  runtime-private request payload 必须包含显式 runtime target identity；不得从
  active app scope、renderer-local selected agent、或 convenience default bank
  推断目标
- `RequestCanonicalMemoryEmbeddingBind` 只允许做 runtime-owned bind admission；
  它不得把 material profile change 解释成 in-place bank mutation
- 当当前 bank 未绑定且 Runtime Agent AI Config `text.embed` intent 可解析时，
  `RequestCanonicalMemoryEmbeddingBind` 可执行首次 canonical bind
- 当当前 bank 已绑定且 resolved profile 与既有 bank identity 等价时，
  `RequestCanonicalMemoryEmbeddingBind` 必须是 idempotent no-op 或 typed
  “already-bound” success，不得制造第二份 bank truth
- 当当前 bank 已绑定且 resolved profile 发生 material identity change 时，
  `RequestCanonicalMemoryEmbeddingBind` 必须进入 runtime-owned rebuild /
  generation path，并把后续切换表达为 pending cutover，而不是静默原地重绑
- `RequestMemoryEmbeddingCutover` 只允许在 admitted rebuild/generation result
  已准备完成时提交 explicit cutover；cutover 未就绪时必须 fail-close
- 上述 operations 可由 host bridge 暴露为 host logical methods，但其 runtime 语义
  owner 始终是 retained runtime-private memory depth

## K-MEM-007 Failure Model

Retained runtime memory depth must fail-close on substrate unavailability.

Fixed rules:

- when the explicitly enabled memory engine, embedding bridge, or required local memory substrate is unavailable, dependent RPCs must fail with `UNAVAILABLE`
- the corresponding runtime reason must stay explicit (`AI_LOCAL_SERVICE_UNAVAILABLE` when the managed local memory service is unavailable)
- no substitute provider, synthetic success payload, or degraded shadow engine may be used to mask failure
- introducing a runtime-owned internal library boundary must not weaken or reinterpret these fail-close outcomes
- when no admitted memory provider is installed, provider-dependent operations must surface the same `UNAVAILABLE` failure family
- if Realm replication is unavailable, local operational writes may continue only when local admission succeeds and sync backlog remains observable; replication failure must not be hidden as fully synchronized success
- provider replay or rebuild to preserve runtime-owned delete/invalidation truth must follow the runtime-private replay contract in `K-MEMSUB-005`

## K-MEM-008 Replication State And Conflict Semantics

Retained runtime memory replication semantics must remain explicit at the
contract layer.

Replication outcomes are defined by `tables/runtime-memory-replication-outcome.yaml`.

Fixed rules:

- append-only commit lineage is the default replication model
- each replicated write must retain an observable version basis for merge or invalidation handling
- replication state must remain externally distinguishable at least as `pending`, `synced`, `conflict`, or `invalidated`
- governance or moderation invalidation from Realm must produce an explicit invalidation outcome rather than silent disappearance
- admitted implementation-facing transport must expose typed replication state, conflict detail, and invalidation detail families as first-class runtime contract data
- implementation-facing transport must represent conflict / invalidation state as typed runtime contract data, not as provider-native opaque text

## K-MEM-009 Replication Lifecycle Observation Path

Retained runtime-private memory depth owns the replication lifecycle store and
committed transition path for local memory records.

Fixed rules:

- replication observation ingress is runtime-private and must not require a new public RPC surface
- runtime may mutate replication state only through admitted typed `MemoryReplicationState` families; free-form provider blobs are not admitted replication truth
- committed replication transitions must update the authoritative `MemoryRecord.replication` state before publication so read APIs and event replay observe the same truth
- `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` must originate from the committed record mutation path, not from snapshot inference or accepted-write decoration
- admitted transitions are `PENDING -> SYNCED|CONFLICT|INVALIDATED` and `CONFLICT -> SYNCED|INVALIDATED`; `SYNCED` and `INVALIDATED` are terminal for this runtime contract unless a later rule explicitly admits otherwise
- invalidated records must fail closed out of default history/recall visibility until the caller explicitly opts into invalidated results

## K-MEM-010 Replication Backlog Truth

Retained runtime-private memory depth owns the replication backlog for canonical
memory records whose replication remains operationally pending.

Fixed rules:

- backlog truth is runtime-local committed state, not transient goroutine state or inferred scheduler memory
- canonical writes that admit `replication=pending` must enqueue exactly one backlog item for the `(bank locator, memory_id)` pair in the same committed local mutation path
- infra scopes must not enter the replication backlog
- backlog items must retain at least local version, basis version, enqueue time, last attempt time, attempt count, and local backlog status
- backlog claim/replay ownership remains on retained runtime-private memory
  depth; internal helper extraction must not create a second backlog or replay
  owner
- until a later Realm memory redesign admits real bridge transport, backlog truth is deferred bridge telemetry only and must not be treated as product-ready cloud sync
- runtime-private bridge loops may claim backlog items for single-owner processing only on explicit internal paths; normal daemon startup must not imply active Realm synchronization
- terminal replication outcomes committed through `K-MEM-009` must remove or terminalize the corresponding backlog item in the same committed state transition

## K-MEM-011 Derived Projection Lineage And Cascade

Retained runtime-private memory depth owns the storage truth for derived memory
projections and their source lineage.

It owns:

- narrative projection storage
- local truth storage
- source-junction lineage for derived outputs
- cascade mutation of derived outputs after canonical delete / invalidation / supersession

It does not own:

- canonical review scheduling
- truth admission policy
- posture policy

Fixed rules:

- runtime-owned derived projections must retain explicit lineage back to canonical source records; lineage is not an optional optimization
- source-junction truth for derived outputs must remain runtime-owned and committed before publication of derived results
- lineage rows must soft-deactivate on cascade rather than hard-delete audit history by default
- canonical delete, governance invalidation, or admitted DYADIC delete must invalidate dependent derived outputs immediately and fail-close them out of default serving paths
- canonical supersession must prefer `stale` over silent delete for derived outputs whose canonical source lineage remains valid, unless a stricter invalidation rule applies
- `invalidated` and `stale` are not interchangeable: `invalidated` derived outputs fail closed out of default serving paths, while `stale` narrative projections may remain as additive projections with explicit stale state
- stale narrative projection is tolerated adaptation lag rather than admitted truth; runtime must not silently treat a stale narrative as an admitted truth row or canonical source record
- runtime may later suppress, replace, or further down-rank stale narrative projections through admitted runtime-owned review or decay policy, but that later lifecycle must not silently promote narrative projection into canonical memory
- runtime-facing cognition recall may expose admitted narrative projections, but
  admitted truths remain runtime-private and are consumed through
  RuntimeAgentService-owned internal paths only

## K-MEM-012 Runtime-Private Canonical Read And Review Commit Boundary

Retained runtime-private memory depth owns the typed read and commit boundary
consumed by `RuntimeAgentService` for canonical review.

Fixed rules:

- RuntimeAgentService must read admitted truths, narrative context, canonical review inputs, and review checkpoints through a runtime-private typed facade rather than direct store access
- runtime-private read surfaces must return typed runtime contract data, not raw SQLite rows or provider-native blobs
- review result commit must be idempotent by `review_run_id`
- all Memory Service owned narrative / truth / lineage mutations for a canonical review run must commit atomically before RuntimeAgentService publishes follow-up checkpoint or event truth
- the typed facade may be implemented by a runtime-owned internal memory
  library, but that library must remain behind the retained runtime-private
  memory boundary
- the review boundary must not require distributed transactions across Agent
  Core and retained runtime-private memory depth

## K-MEM-013 Retain-Time Duplicate Suppression On Eligible Banks

## K-MEM-014 Standalone Cognition Boundary

Retained runtime memory depth is not the semantic owner of standalone
cognition.

Fixed rules:

- retained runtime memory remains the runtime-owned authority for bank,
  provider, replication, and runtime-private review/substrate semantics on the
  runtime path
- extracted standalone cognition semantics must live under the cognition authority home rather than being redefined here
- cognition memory upgrade and no-downgrade requirements are governed by `.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`, `.nimi/spec/cognition/kernel/memory-service-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`
- runtime memory must not absorb cognition kernel, prompt, working-state, or routine ownership by implementation convenience
- runtime-facing overlap memory semantics are now owned by
  `RuntimeCognitionService`; overlapping record mechanics or adapter reuse do
  not make retained runtime memory the continuing public owner of cognition
  memory semantics

Retained runtime-private memory depth may admit a narrow retain-time duplicate
suppression rule for already-stabilized semantic memory candidates.

It owns:

- same-bank duplicate comparison over retained memory rows
- reuse of an existing retained row when a duplicate match is admitted

It does not own:

- dialogue/window stabilization before candidate admission
- in-place canonical rewriting of retained memory rows
- structural `updates` / `extends` relation admission

Fixed rules:

- retain-time duplicate suppression is admitted only for banks with a non-null
  bound embedding profile
- first-slice duplicate suppression must remain same-bank only and must not
  widen into cross-bank matching
- first-slice duplicate suppression must remain conservative; it may only reuse
  an existing retained row when the runtime can determine that a stabilized
  semantic candidate is materially the same memory under the admitted
  first-slice equality rule
- for the current first slice, the admitted equality rule is strict normalized
  semantic subject/predicate/object equality inside the same eligible bank
- duplicate suppression in the first slice must return the existing retained row
  in `RetainResponse` rather than mutating that row in place
- duplicate suppression in the first slice must preserve existing canonical row
  immutability; it must not silently rewrite prior payload, provenance, or
  version lineage
- duplicate suppression in the first slice must not require `updates` /
  `extends` relation admission
- duplicate suppression in the first slice must not publish
  `MEMORY_EVENT_TYPE_RECORD_RETAINED` as if a new canonical row were inserted
  when the runtime reuses an existing retained row


---

<!-- source: .nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md -->

# Runtime Memory Substrate Contract

> Owner Domain: `K-MEMSUB-*`

## K-MEMSUB-001 Authority Home

`RuntimeMemorySubstrate` is the runtime-private implementation contract that
binds retained runtime-private memory depth to any future admitted memory
provider.

It owns:

- the rule that runtime may project provider-backed memory through retained
  runtime-private memory depth and the absorbed `RuntimeCognitionService`
  memory family only when a future substrate is explicitly admitted
- runtime-owned overlay needed to preserve Nimi bank locator truth, embedding profile truth, and typed record identity above provider-native storage
- the rule that current extraction of runtime memory logic into internal runtime-owned libraries remains an overlay refactor rather than a provider admission event

It does not own:

- public memory RPC naming or public typed payload authority
- agent canonical memory semantics
- Realm replication authority
- local public engine target enumeration in `K-LENG-*`

## K-MEMSUB-002 Current Admission

No built-in runtime memory provider is currently admitted.

Fixed rules:

- runtime must not ship a default supervised or attached memory substrate path under `runtime/internal/**`
- runtime config must not advertise provider-specific memory bootstrap fields as active authority
- extracting runtime-owned memory logic into internal libraries or subpackages under the existing runtime module does not by itself admit a new provider, public engine identity, or public wire contract
- any future memory provider admission requires a later redesign under `.nimi/spec/runtime/kernel/**`

## K-MEMSUB-003 Runtime-Owned Overlay And Identity Binding

No provider owns Nimi locator truth or typed memory identity.

Fixed rules:

- runtime must preserve the authoritative mapping from scope-typed bank locator to provider `bank_id`
- runtime must preserve the authoritative embedding profile bound to each bank
- runtime must preserve authoritative typed record identity for retained
  runtime memory records, even when the provider stores only provider-native
  memory units
- if runtime internally normalizes locator identity through a typed-principal library model, the mapping must remain deterministic and compatibility-preserving with the admitted public locator family
- if a future provider returns a retained / recalled item that does not map back to an admitted runtime-owned bank or typed record identity, runtime must fail-close or explicitly suppress that item; it must not silently widen provider-native data into public truth

## K-MEMSUB-004 Feature Floor And Health Contract

If a future memory provider is admitted, it must expose a runtime-private feature floor sufficient for:

- bank lifecycle: list / create-or-update / get profile / delete
- memory operations: retain / recall / list memories / clear bank memories

Fixed rules:

- retained runtime-private memory depth may assume only this admitted feature
  floor; it must not depend on undocumented provider-native endpoints

## K-MEMSUB-005 Failure And Replay Semantics

Fixed rules:

- if no admitted memory provider is installed, provider-dependent memory operations must fail with `UNAVAILABLE`
- runtime must not use a substitute provider, shadow engine, or synthetic success path when no admitted memory provider exists
- when runtime-owned typed records are deleted or invalidated and the provider cannot perform an admitted per-record delete, runtime may rebuild provider state only through explicit runtime-owned replay from the surviving authoritative overlay
- replay must remain deterministic from runtime-owned bank + record truth; runtime must not rehydrate from provider-native blobs as canonical truth

## K-MEMSUB-006 Public Boundary Preservation

Fixed rules:

- public memory and agent-service RPC surfaces must continue to emit Nimi-owned typed payloads only
- provider-native wire shapes remain runtime-private
- internal extraction into a runtime-owned overlay library must not create a second public engine-facing contract, proto package, or provider-style identity boundary
- runtime may project provider-backed reflect / recall results into Nimi typed families, but the projection boundary must stay in runtime-owned code under `runtime/internal/**`

## K-MEMSUB-007 RealmSyncBridge Ingress Boundary

`RealmSyncBridge` remains a runtime-private ingress/egress boundary above the admitted local memory substrate.

Fixed rules:

- runtime-private downlink observations from Realm or governance must enter local memory truth through the same committed replication mutation path admitted by `K-MEM-009`
- bridge ingress may feed only admitted typed replication outcomes; provider-native or transport-native blobs must not mutate runtime memory truth directly
- backlog/outbox ownership remains with retained runtime-private memory depth;
  the substrate bridge must not become a second source of pending replication
  truth
- the current seam treats backlog/replay ownership on retained runtime-private
  memory depth as the stable runtime-owned boundary; moving that ownership
  requires a later redesign rather than routine internal extraction
- real endpoint, transport, and polling policy remain deferred for the current local-only phase; runtime must not imply active Realm memory sync without a later admitted redesign
- any future bridge implementation must preserve the same committed runtime-owned mutation path and fail-close semantics

## K-MEMSUB-008 Runtime-Owned Derived Replay Boundary

Provider-native substrates do not own derived projection lineage, review idempotency, or truth admission state.

Fixed rules:

- runtime-owned source-junction lineage and committed review-run identity must remain above provider-native storage semantics
- if provider-backed state must be rebuilt, runtime may replay only from committed canonical records plus committed runtime-owned derived-projection truth; provider-native reflect output must not become canonical or derived authority by itself
- provider-native storage must not become the source of truth for admitted narrative / truth lineage or `review_run_id` idempotency
- if replay, lineage, or review-commit mechanics are extracted into a runtime-owned internal library, the library remains an implementation carrier only; the admitted authority and fail-close semantics remain runtime-owned
- helper extraction must not be interpreted as moving backlog/replay ownership
  off the retained runtime-private memory path; deterministic replay/rebuild
  ownership remains runtime-owned unless a later redesign explicitly reopens
  that boundary


---

<!-- source: .nimi/spec/runtime/kernel/knowledge-contract.md -->

# Retired Runtime Knowledge Topology Contract

> Owner Domain: `K-KNOW-*`

## K-KNOW-001 Retired RuntimeKnowledgeService Topology

`RuntimeKnowledgeService` is retired as a future runtime-facing public service
topology.

The runtime-facing knowledge projection slice is now absorbed into
`RuntimeCognitionService`.

This contract continues to define the semantic floor for the absorbed
runtime-local knowledge projection family:

- runtime-local knowledge bank lifecycle
- runtime-local knowledge page lifecycle
- keyword and hybrid knowledge retrieval
- same-bank relation and ingest semantics

It still does not own:

- Realm/shared knowledge truth
- knowledge replication or sync backlog truth
- canonical agent-facing knowledge policy
- AgentCore prompt-assembly knowledge lanes
- cross-service citation/relation truth

## K-KNOW-001a Retired Runtime Knowledge Implementation Package

The internal Go implementation package
`runtime/internal/services/knowledge` is retired alongside the public
`RuntimeKnowledgeService` topology. The runtime no longer owns its own
knowledge bank in-memory state, its own `knowledge_snapshot` persistence
schema, or any `knowledgeservice.Service`-shaped wrapper around the
cognition store.

Fixed rules:

- runtime-facing knowledge bank, page, relation, search, and ingest
  truth must originate from `nimi-cognition` storage through the
  cognition typed scope registry (see C-COG-059)
- runtime backend code must not maintain a parallel in-memory bank
  state, a parallel page index, a parallel relation table, or a
  parallel ingest task map
- the `knowledge_snapshot` persistence schema is retired; runtime
  persistence must not create, register, load, or write any table or
  blob bound to that name
- internal naming `knowledgeservice.Service`,
  `knowledgeservice.NewWithBackend`, and `knowledgeservice.NewPersistent`
  is retired; new internal helpers must consume the cognition typed
  scope registry directly
- this rule is a strictly stronger statement of K-KNOW-001 — it
  forbids the absorbed slice from being shadowed by a runtime-private
  parallel implementation
- pre-cutover history of the retired package remains available only
  through Git; no compat shim, no migration loader, no dual-read
  fallback is admitted

## K-KNOW-002 Baseline Bank Scope And Owner Boundary

Baseline public knowledge scopes are fixed to:

- `APP_PRIVATE`
- `WORKSPACE_PRIVATE`

Baseline public surface must reject:

- `AGENT_CORE`
- `AGENT_DYADIC`
- `WORLD_SHARED`

Fixed rules:

- every knowledge page belongs to exactly one knowledge bank
- every knowledge bank uses an admitted typed owner shape rather than free-form `scope + owner_id`
- `APP_PRIVATE` knowledge banks are app-owned
- `WORKSPACE_PRIVATE` knowledge banks are workspace-owned
- illegal scope/owner combinations must fail close
- page access inherits bank authorization; the baseline does not admit a separate page owner model

## K-KNOW-003 Superseded Knowledge Public Surface Baseline

The following public operations are superseded as a standalone service topology
and are now admitted only as the absorbed knowledge family on
`RuntimeCognitionService`:

1. `CreateKnowledgeBank`
2. `GetKnowledgeBank`
3. `ListKnowledgeBanks`
4. `DeleteKnowledgeBank`
5. `PutPage`
6. `GetPage`
7. `ListPages`
8. `DeletePage`
9. `SearchKeyword`
10. `SearchHybrid`
11. `AddLink`
12. `RemoveLink`
13. `ListLinks`
14. `ListBacklinks`
15. `TraverseGraph`
16. `IngestDocument`
17. `GetIngestTask`

Fixed rules:

- this absorbed knowledge slice replaces the older design-first 3-method index
  draft as the admitted design authority
- `CreateKnowledgeBank` / `DeleteKnowledgeBank` are admitted only for baseline infra scopes
- `PutPage` creates or updates one page inside one admitted bank
- `DeletePage` is page-level delete; `DeleteKnowledgeBank` is bank-level delete
- `ListKnowledgeBanks` and `ListPages` are paginated list surfaces
- `SearchKeyword` remains the baseline lexical / FTS-only surface
- `SearchHybrid` is the only hybrid retrieval expansion
- the graph/backlink expansion admits only same-bank page-to-page graph / backlink surfaces
- `AddLink` and `RemoveLink` operate on runtime-local page links inside one admitted bank
- `ListLinks` returns outgoing links for one page inside one admitted bank
- `ListBacklinks` returns incoming links for one page inside one admitted bank
- `TraverseGraph` returns same-bank graph expansion from one root page and does not imply cross-bank or cross-service citation
- the ingest/progress expansion admits only single-document async ingest plus explicit task polling
- `IngestDocument` accepts one runtime-local document payload and returns one ingest task rather than synchronously returning a page write result
- `GetIngestTask` is the only admitted progress surface; the ingest/progress expansion does not admit ingest event streams or batch task lists
- public proto, runtime implementation, CLI, and SDK projection must align to
  this admitted surface through `RuntimeCognitionService`
- legacy `BuildIndex` / `SearchIndex` / `DeleteIndex` names remain migration-only and must not be treated as stable public contract

## K-KNOW-004 SearchKeyword Semantics

`SearchKeyword` remains lexical / FTS-only on the runtime-facing absorbed
knowledge family.

Fixed rules:

- baseline keyword search does not require an embedding profile
- baseline lexical search does not admit vector search
- baseline lexical search does not admit hybrid search / RRF fusion
- baseline lexical search does not admit graph expansion
- baseline lexical search does not admit multi-query expansion
- search results remain runtime-local knowledge hits; they do not imply AgentCore or canonical-memory admission

## K-KNOW-004a SearchHybrid Semantics

`SearchHybrid` remains a runtime-local retrieval-expansion surface on the
absorbed knowledge family.

Fixed rules:

- combines lexical and vector-backed recall
- may use fusion / dedup internally
- does not imply graph expansion
- does not imply AgentCore admission
- does not imply shared truth
- must fail close when hybrid retrieval capability is unavailable
- must not silently downgrade to `SearchKeyword`

## K-KNOW-004b Graph / Backlink Semantics

`AddLink` / `RemoveLink` / `ListLinks` / `ListBacklinks` / `TraverseGraph`
remain a runtime-local same-bank graph expansion on the absorbed knowledge
family.

Fixed rules:

- links are directed page-to-page relations inside exactly one admitted bank
- public graph surfaces must reject cross-bank and cross-service relation truth
- page existence and bank authorization must be validated before graph reads or writes
- `link_type` is caller-provided but non-empty; runtime does not admit a blank relation type
- duplicate same-bank relations with the same `from_page_id + to_page_id + link_type` must fail close
- self-links must fail close
- `ListLinks` and `ListBacklinks` are paginated read surfaces
- `TraverseGraph` is a paginated breadth-first graph read surface
- `TraverseGraph` depth must be explicit and bounded; invalid depth must fail close
- graph hits remain runtime-local knowledge projections; they do not imply citation redesign, canonical truth, or AgentCore admission

## K-KNOW-004c Ingest / Progress Semantics

`IngestDocument` / `GetIngestTask` remain a runtime-local async ingest surface
on the absorbed knowledge family.

Fixed rules:

- the ingest/progress expansion admits only single-document ingest; it does not admit multi-document batch ingest
- `IngestDocument` must validate bank existence and bank authorization before accepting a task
- `IngestDocument` must fail close on invalid envelopes; it must not silently coerce missing `bank_id`, `slug`, or `content`
- accepted ingest work is represented as a runtime-local knowledge ingest task with explicit status and `progress_percent`
- `GetIngestTask` must return task state by explicit `task_id`; missing task ids must fail close
- ingest task completion may create or update one page inside one admitted bank
- the ingest/progress expansion does not admit timeline/version/revert semantics
- the ingest/progress expansion does not admit cross-bank ingest, cross-service citation, shared truth, or AgentCore admission
- progress is poll-based; it does not imply workflow-service reuse or server-stream task events

## K-KNOW-005 Supporting Requirements

Supporting contract requirements are fixed:

- bank/page authorization is bank-scoped and must fail close
- `ListKnowledgeBanks` and `ListPages` must use admitted pagination semantics from `K-PAGE-*`
- admitted write paths must emit audit events under `K-AUDIT-*`
- admitted baseline failures must map to explicit knowledge reason codes
- `SearchHybrid` pagination semantics and unavailable states must be explicit
- graph/backlink reads must use explicit pagination semantics
- graph/backlink writes must remain same-bank only and auditable
- ingest task reads and writes must remain runtime-local, explicit, and auditable
- if page writes affect durable hybrid retrieval readiness, the resulting indexing-side-effect posture must be explicit and auditable

Minimum baseline audited writes:

- `CreateKnowledgeBank`
- `DeleteKnowledgeBank`
- `PutPage`
- `DeletePage`
- `AddLink`
- `RemoveLink`
- `IngestDocument`

Minimum baseline paginated reads:

- `ListKnowledgeBanks`
- `ListPages`
- `ListLinks`
- `ListBacklinks`
- `TraverseGraph`

## K-KNOW-005a 消费契约状态

KnowledgeService 的跨域消费契约状态：

| 消费层 | 当前状态 | Baseline 必须保持 |
|---|---|---|
| **SDK 方法投影** | admitted / landed | 保持 baseline SDK 方法投影与 runtime proto / reason-code / pagination 语义对齐 |
| **Desktop UI Spec** | retired hard-cut | Desktop Runtime Config 不再暴露 bank/page/search/graph/ingest 管理页；未来 cognition UX 必须新建产品契约，不得复活旧 Runtime Config Knowledge 页 |

> **设计完整性注意**：当前 admitted knowledge slice 只定义 runtime-local infra-scoped ownership；AgentCore integration、shared truth、cross-service citation redesign 仍未交付。Runtime、CLI、SDK 方法投影已就绪；旧 Desktop Runtime Config Knowledge 管理页已 hard-cut retired，任何产品消费必须另行 admission。
>
> **Hybrid retrieval 注意**：`SearchHybrid` 只扩 retrieval surface；它不改变 baseline bank/page ownership、也不引入 graph、AgentCore、shared truth 或 citation admission。
>
> **Graph/backlink 注意**：graph/backlink 只扩同 bank page-to-page runtime-local relations；它不引入 cross-bank relation truth、cross-service citation、shared truth 或 AgentCore knowledge lane。
>
> **Ingest/progress 注意**：ingest/progress 只扩 runtime-local single-document async ingest 与 task polling；它不引入 batch ingest、timeline/version、workflow-service ownership、shared truth 或 AgentCore admission。

## K-KNOW-006 Explicit Deferrals

Current admitted surface之外，以下内容仍明确 deferred：

- shared-truth / Realm replication
- `AGENT_CORE` / `AGENT_DYADIC` / `WORLD_SHARED`
- AgentCore `QueryAgentMemory` knowledge expansion
- `Layer 1K`
- consolidation / dream cycle
- public reindex / ingest admin surface
- richer ingest admin / batch progress protocol
- timeline management
- version history / revert
- relation-based memory-to-knowledge citation redesign

## K-KNOW-007 Standalone Cognition Boundary

Retained runtime knowledge projection semantics are not the semantic owner of
standalone cognition.

Fixed rules:

- runtime-facing knowledge projection semantics now route through
  `RuntimeCognitionService`, while this file preserves the absorbed semantic
  floor for runtime-local bank/page/search/graph/ingest behavior
- extracted standalone cognition knowledge semantics must live under cognition authority rather than being redefined here
- cognition knowledge upgrade and no-downgrade requirements are governed by `.nimi/spec/cognition/kernel/runtime-upgrade-contract.md`, `.nimi/spec/cognition/kernel/knowledge-service-contract.md`, and `.nimi/spec/cognition/kernel/tables/runtime-capability-upgrade-matrix.yaml`
- runtime knowledge must not absorb cognition kernel, working-state, prompt, or routine ownership by extension
- shared page or relation mechanics do not make the retired runtime knowledge
  topology the continuing owner of cognition knowledge projections

## K-KNOW-008 WORKSPACE_PRIVATE Authorization Carrier

WORKSPACE_PRIVATE knowledge banks may be positively authorized only through an
explicit workspace binding attachment on `KnowledgeRequestContext` and an
internal account-owned workspace binding resolver allow decision.

Fixed rules:

- `APP_PRIVATE` remains app-owned and is not authorized by workspace binding
- `WORKSPACE_PRIVATE` requires a workspace binding attachment for create, read,
  list, write, delete, graph, search, ingest, and task polling paths
- `KnowledgeRequestContext.app_id` is compatibility context only and must not
  be used as resolver identity or authorization proof
- `KnowledgeRequestContext.subject_user_id` is compatibility context only and
  must not be used as account truth, subject truth, membership truth, or
  resolver proof
- Runtime-authenticated caller identity for WORKSPACE_PRIVATE resolver
  consumption must come from the Runtime protocol envelope: `x-nimi-app-id`
  for app id and `x-nimi-app-instance-id` for app instance id. Device identity
  must be derived or verified by Runtime account/app registry state, not from
  `KnowledgeRequestContext`, attachment fields, SDK/Desktop cache, or caller
  body payload
- cognition must not read account persistence, Realm membership state, or app
  local cache to authorize WORKSPACE_PRIVATE
- resolver denies must map to typed knowledge / workspace binding reason codes
  and fail closed

The only admitted positive WORKSPACE_PRIVATE allow path is:

1. knowledge request targets or resolves to a workspace-owned bank
2. request carries a workspace binding attachment
3. cognition asks `KnowledgeAuthorizer` for a decision
4. `KnowledgeAuthorizer` delegates to the internal account resolver
5. account resolver returns `ALLOW` after checking binding, caller relation,
   account state, membership projection, target workspace, and required scopes

Any missing step must deny.

## K-KNOW-009 Knowledge Action Scope And Enumeration Semantics

The admitted knowledge action-to-scope matrix is
`tables/knowledge-action-scope-matrix.yaml`.

Scope implication is explicit:

- `runtime.knowledge.admin` authorizes admin actions and also satisfies read
  and write requirements
- `runtime.knowledge.write` authorizes write actions and also satisfies read
  requirements
- `runtime.knowledge.read` authorizes read actions only

List/search/get-ingest fixed rules:

- no caller may enumerate all workspace-owned banks across workspaces
- `ListKnowledgeBanks` without a workspace binding attachment must not return
  WORKSPACE_PRIVATE banks
- `ListKnowledgeBanks` with an explicit workspace filter requires a matching
  workspace binding attachment and resolver allow decision; mismatch must
  fail closed or return an explicitly specified empty result according to the
  RPC's reason-code mapping, never silently widen
- `SearchKeyword`, `SearchHybrid`, graph reads, page reads, and link reads must
  authorize the resolved bank before returning results
- `GetIngestTask` must resolve the task to its bank/workspace owner before
  returning progress; task-id-only polling must not bypass workspace binding
- write/admin actions must validate bank authorization before mutating storage
  or accepting ingest work


---

<!-- source: .nimi/spec/runtime/kernel/scheduling-contract.md -->

# Scheduling Contract

> Owner Domain: `K-SCHED-*`

## Scope

定义 runtime 调度器的 five-state preflight judgement 模型。本契约扩展 K-AIEXEC-004 声明的 semaphore baseline，增加非阻塞 peek、occupancy telemetry、typed denial 与 risk assessment 能力。

## K-SCHED-001 — Scheduling Judgement State Enum

调度判断状态固定为六值封闭枚举：

| State | Terminal | Meaning |
|-------|----------|---------|
| `runnable` | no | 有可用 slot，无资源冲突预测 |
| `queue_required` | no | 无可用 slot，需排队等待 |
| `preemption_risk` | no | 有可用 slot，但当前运行中任务可能被降级 |
| `slowdown_risk` | no | 资源紧张（VRAM / RAM / disk），执行可能变慢 |
| `denied` | yes | 硬约束阻止执行（如本地模型无 GPU、磁盘不足） |
| `unknown` | no | 调度器无法评估该维度（如缺少资源遥测） |

约束：

- `denied` 是唯一阻止进入 `Acquire` 的状态。其余五种状态均为 advisory，不阻止执行。
- `unknown` 只允许在调度器确实缺少评估信息时返回（如 Phase 1 缺少 VRAM 遥测）。不允许用 `unknown` 掩盖可评估但未实现的判断。
- 枚举值域扩展需修改本规则并通过 spec consistency check。

## K-SCHED-002 — Peek Contract

`Peek` 是非阻塞的 preflight 调度评估，不获取 slot。其 canonical evaluation model 固定为：

- **atomic unit**：单个 `SchedulingEvaluationTarget`
- **aggregate unit**：同一个 `appID` 下的一组 `SchedulingEvaluationTarget` 的 batch evaluation

### Atomic canonical input

```
SchedulingEvaluationTarget {
  capability: string
  target_id?: string
  profile_id?: string
  resourceHint?: ResourceHint
}
```

约束：

- 一个 `SchedulingEvaluationTarget` 表示一个**具体可执行的 capability path**，不是 scope 全量配置。
- `target_id` + `profile_id` 标识该 target 对应的 local profile identity；两者是 target-scoped，不是 batch-global。
- `resourceHint` 只允许描述该 target 的资源预估，不允许提升为 scope-global / batch-global 模糊字段。

### Batch input

- `appID: string` — 应用标识，与 `Acquire` 使用相同的 appID 语义
- `targets: []SchedulingEvaluationTarget` — 非空 target 集合。单 target 请求是 batch 的退化形态。

### Batch output

```
SchedulingBatchJudgement {
  aggregateJudgement: SchedulingJudgement
  occupancy: OccupancySnapshot
  targetJudgements?: []TargetSchedulingJudgement
}

TargetSchedulingJudgement {
  target: SchedulingEvaluationTarget
  judgement: SchedulingJudgement
}
```

语义：

- `aggregateJudgement` 是 scope / batch 级结论，不替代 target judgement 的语义来源。
- `targetJudgements`（如果返回）中的每一项对应一个 atomic target judgement。
- 单 target 请求时，`aggregateJudgement` 必须与该 target judgement 等值；不允许出现 aggregate 与 atomic 相互矛盾。

### Aggregate fold rule

aggregate state precedence 固定为：

1. `denied`
2. `queue_required`
3. `preemption_risk`
4. `slowdown_risk`
5. `unknown`
6. `runnable`

fold 规则：

- 对每个 target 独立计算一个 atomic `SchedulingJudgement`
- aggregate state 取 batch 内最高优先级 state
- `unknown` 永远不得被提升 / 投影为 `runnable`

`unknown` 参与规则固定为：

- 任一 target = `denied` -> aggregate = `denied`
- 否则任一 target = `queue_required` -> aggregate = `queue_required`
- 否则任一 target = `preemption_risk` -> aggregate = `preemption_risk`
- 否则任一 target = `slowdown_risk` -> aggregate = `slowdown_risk`
- 否则任一 target = `unknown` -> aggregate = `unknown`
- 否则 aggregate = `runnable`

### Aggregate detail / warning merge

aggregate `detail` 合并规则固定为：

1. 选出所有 `state == aggregate.state` 的 contributor targets
2. 按 `capability`、`target_id`、`profile_id` 做稳定排序
3. 每个 contributor 渲染为 `<capability> (<target_id>/<profile_id>): <detail>`
4. 用 `; ` 连接
5. 若 aggregate state 不是 `unknown` 且 batch 内存在 `unknown` target，则在末尾追加 `; unevaluated targets: <ordered target list>`

aggregate `resourceWarnings` 合并规则固定为：

- 对 batch 内全部 target 的 `resourceWarnings` 做稳定顺序 union
- 以 exact string 去重
- 不允许 synthesize 新 warning category

### Shared batch observation

- `Peek` 对一个 batch 请求必须只采样**一个** scheduler occupancy observation point。
- `SchedulingBatchJudgement.occupancy` 是该 batch 的 shared occupancy snapshot。
- 若 transport 同时在 `SchedulingJudgement.occupancy` 中嵌入 occupancy，则 `aggregateJudgement` 与所有 `targetJudgements` 中的 `occupancy` 必须与 shared batch occupancy **字节等值**；它们不是独立观测值。
- 若实现通过 repeated single-target peeks 内部拼装 batch 结果，只有当所有 atomic 结果的 occupancy 完全一致时才允许返回 aggregate 结果；否则必须 fail-close 到 `aggregateJudgement.state = unknown`，且不得伪造 merged occupancy。

### Proto direction

`proto/runtime/v1/ai.proto` 的 scheduling transport 方向固定为：

- request 采用 `repeated SchedulingEvaluationTarget targets`
- response 采用 shared batch occupancy + aggregate judgement
- response 可选返回 repeated per-target judgements 供 consumer 做精确映射 / 诊断

不允许长期保留“singular capability/target_id/profile_id 请求”和“repeated targets 请求”并列作为双轨 canonical 形态。

Non-blocking guarantee：

- `Peek` 不得阻塞等待 slot。
- `Peek` 不得修改 scheduler 内部状态（不获取、不释放、不排队）。
- `Peek` 的结果是瞬时快照，不保证与后续 `Acquire` 结果一致。
- `Peek` 在 scheduler 不可用时必须返回 `state=unknown`，不得报错。

## K-SCHED-003 — Occupancy Telemetry

`Peek` 与 `Acquire` 结果必须包含 occupancy 快照：

```
OccupancySnapshot {
  globalUsed: int       // 当前已占用全局 slot 数
  globalCap: int        // 全局 slot 上限
  appUsed: int          // 当前 appID 已占用 slot 数
  appCap: int           // 每 app slot 上限
}
```

约束：

- occupancy 值必须在 slot acquire/release 时原子更新。
- occupancy 读取必须是 lock-free 或 short-critical-section，不得因 occupancy 查询阻塞执行路径。
- 实现可使用 atomic counters 或 channel length 查询，但必须保证与 slot 状态一致。
- 对 batch `Peek`，所有返回 judgement 引用的是同一个 shared occupancy snapshot；不存在 target-local occupancy timeline。

## K-SCHED-004 — Denied Hard Rules

`denied` 状态仅在以下条件成立时返回。multi-target 语义下，`denied` 首先是 **target-local** judgement，再按 K-SCHED-002 aggregate precedence 折叠到 batch 级结果。

| 条件 | 判断依据 | 状态 |
|------|---------|------|
| 本地模型需要 GPU 但设备无 GPU | `CollectDeviceProfile().gpu.available == false`（K-DEV-001） | 已实现 |
| 磁盘可用空间低于安全阈值 | `CollectDeviceProfile().disk_free_bytes < threshold`（K-CFG 配置路径驱动） | 已实现 |
| 必需依赖不满足 | `Peek` target 提供 `target_id` + `profile_id` 标识目标 local profile。Runtime 从内部 profile registry 查找对应的 `LocalProfileDescriptor`，使用 `ResolveProfile` preflight decision 逻辑评估。当 required entry 的 preflight decision `ok=false` 时返回 `denied`。 | 已实现。target 未提供 `profile_id` 时此检查跳过。profile 在 registry 中未找到 / cannot evaluate 时跳过，不等于 infeasible。 |

约束：

- `denied` 必须附带 `detail` 说明具体原因。
- `denied` 不用于 transient failures（如网络超时）。transient failures 由 `Acquire` context cancellation 处理。
- `denied` 判断必须基于当前设备状态，不得缓存超过单次 `Peek` 调用。
- dependency denial 仅在对应 target 提供了 `profile_id` 且 runtime profile registry 中存在对应 profile 时触发。缺少 `profile_id` 或 profile 未注册时，该 target 跳过检查，不返回 `denied`。"无法评估" ≠ "infeasible"。
- Runtime profile registry 通过 `ResolveProfile` RPC 调用自动填充：每次 `ResolveProfile` 调用时，runtime 将请求中的 `LocalProfileDescriptor` 注册到 registry，供后续 `Peek` dependency denial 查找。
- 一个 target 的 dependency denial 不得“污染”其他 target 的 atomic judgement；aggregate `denied` 只来自 K-SCHED-002 的正式 fold，不允许以 batch-level side channel 直接构造 `denied`。
- 当 batch 内任一 target 为 `denied` 时，aggregate judgement 必须为 `denied`，即使其他 target 为 `runnable` 或 advisory state。

## K-SCHED-005 — Risk State Heuristic Boundary

### preemption_risk

`preemption_risk` 在以下条件成立时返回：

- 有可用 slot（不是 `queue_required`）
- 当前运行中任务的 aggregate resource demand + 新任务的 estimated demand 超过设备资源容量的 warning 阈值

Phase 1：runtime 缺少 per-execution resource footprint tracking，返回 `unknown`。
Phase 2：通过 `collectDeviceProfile()` 在 peek 时采集 VRAM/RAM，与运行中执行数做交叉评估。

### slowdown_risk

`slowdown_risk` 在以下条件成立时返回：

- 有可用 slot（不是 `queue_required`）
- 设备当前 available VRAM / RAM / disk 低于 per-capability 建议阈值

Phase 1：缺少 VRAM/RAM 实时遥测集成，返回 `unknown`。
Phase 2：消费 `CollectDeviceProfile()` 实时数据与 per-capability resource heuristic。

约束：

- risk state 阈值必须可配置（通过 K-CFG 配置路径）。
- risk state 不阻止执行；只作为 advisory warning 传递到 consumer。
- 不允许把 `unknown` 升级为 `runnable` 来掩盖评估缺失。

## K-SCHED-006 — Relationship To Acquire

- `Peek` 是 advisory preflight；`Acquire` 是 authoritative slot acquisition。
- `Peek` 返回 `runnable` 不保证后续 `Acquire` 不需等待（slot 可能在 peek 和 acquire 之间被占用）。
- `Peek` 返回 `queue_required` 不保证 `Acquire` 一定排队（slot 可能在 peek 和 acquire 之间被释放）。
- `Peek` 返回 `denied` 时 caller 不应调用 `Acquire`，但 scheduler 不强制（`Acquire` 仍然可调用，但大概率 context timeout 或 starvation）。
- execution path 中 `Peek` 是可选步骤。caller 可以直接 `Acquire` 而不先 `Peek`。
- `Peek` 的 `SchedulingJudgement` 可被捕获进 execution snapshot（K-AIEXEC-003），但不是 `Acquire` 的前置条件。

## K-SCHED-007 — Capability And Resource Hint Semantics

`Peek` 的 capability / profile identity / resource hint 语义固定为 **target-scoped repeated targets**，不再以 singular request fields 作为最终模型。

### Phase 1

- 每个 `SchedulingEvaluationTarget.capability` 被接受但可忽略。scheduler 仍可保持 capability-blind。
- 每个 `SchedulingEvaluationTarget.resourceHint` 被接受但可忽略。

### Phase 2+

- `capability` 用于对应 target 的 dependency feasibility 检查 filter（K-SCHED-004）。
- `resourceHint` 包含对应 target 的 estimated VRAM / RAM / disk consumption，用于 `slowdown_risk` 与 `preemption_risk` 评估。
- `target_id` + `profile_id`：对应 target 的 profile identity reference，用于 dependency infeasible denial 判断。Runtime 从内部 profile registry 查找对应的 `LocalProfileDescriptor` 并使用 `ResolveProfile` preflight decision 逻辑评估。两者都提供时触发该 target 的 dependency denial 检查；缺少 `profile_id` 时仅跳过该 target 的此项检查。

`ResourceHint` 最小 schema：

```
ResourceHint {
  estimatedVramBytes?: int64
  estimatedRamBytes?: int64
  estimatedDiskBytes?: int64
  engine?: string
}
```

约束：

- resource heuristic 必须来自配置或设备画像推导，不允许 hardcode 固定值。
- `profile_id` 未提供时或 profile 在 registry 中未找到时，不得伪造 `denied`。"无法评估" 不等于 infeasible。
- `resourceHint` 只允许挂在 `SchedulingEvaluationTarget` 上；不允许引入 scope-global / batch-global `resourceHint` 作为模糊替代。
- `capability`、`target_id`、`profile_id`、`resourceHint` 的 proto 方向应收敛到 `repeated SchedulingEvaluationTarget`。不允许继续把 singular request fields 视为最终 canonical shape。

## Fact Sources

- `scheduler.go` — current semaphore scheduler baseline
- `device-profile-contract.md` — K-DEV-001~007 (device profile collection)
- `ai-profile-execution-contract.md` — K-AIEXEC-003~004 (execution snapshot, scheduling boundary)
- `config-contract.md` — K-CFG-* (configuration paths)
- `local-profile-application-contract.md` — K-LOCAL-013~015 (ResolveProfile, ApplyProfile)


---

<!-- source: .nimi/spec/runtime/kernel/world-evolution-engine-contract.md -->

# World Evolution Engine Contract

> Owner Domain: `K-WEV-*`

## Scope

This contract freezes the Runtime semantic-owner framing for the World Evolution Engine.
It defines the first controlled Runtime contract baseline for shared execution-event semantics, replay/checkpoint semantics, supervision boundaries, effect-stage ordering, commit-request staging, and workflow partial-reuse hardcuts.
It does not define SDK projection surface, consumer API shape, transport bindings, or implementation strategy.

## K-WEV-001 Runtime Semantic Owner Boundary

Runtime kernel is the semantic owner for World Evolution Engine execution semantics.

The `K-WEV-*` family owns:

- execution-event semantic home
- replay semantics
- checkpoint semantics
- supervision and fault-isolation semantics
- effect-stage and transition-ordering semantics
- commit-request staging semantics

Platform kernel owns placement and cross-layer boundary text only.
SDK remains downstream projection only.
Realm remains canonical truth owner for shared world state and history.

## K-WEV-002 Runtime-Local Execution Evidence Boundary

The World Evolution Engine may produce runtime-local execution evidence, but that evidence remains runtime-local and non-canonical.

The following runtime-local artifacts stay under Runtime semantic ownership rather than Realm truth ownership:

- execution events
- replay metadata
- checkpoint metadata
- supervision state
- effect-stage evidence
- operator-facing execution correlation

These artifacts must not be represented as Realm shared present-state truth or Realm canonical happened-fact truth.

## K-WEV-003 Shared Event / Envelope Semantic Home

If the World Evolution Engine introduces a stable execution event or envelope contract, its semantic home is `K-WEV-*`, not `K-WF-*`, `K-AUDIT-*`, SDK projection, or Platform boundary text.

That future execution event / envelope contract must:

- reuse Realm provenance anchors required by `R-WHIST-003`
- reuse commit-envelope anchors required by `R-WSTATE-002`
- reuse Runtime correlation floors required by `K-AUDIT-001`, `K-AUDIT-003`, `K-AUDIT-019`, and `K-AUDIT-020`

That future contract must not redefine:

- Realm run-mode authority
- Realm `effectClass` vocabulary
- Realm commit-envelope authority
- Runtime audit-record schema as semantic truth

## K-WEV-004 Commit / History / Audit Truth Boundary

World Evolution Engine semantics must reuse and extend existing authority without creating a parallel truth family.

Boundary rules:

- Realm commit authorization remains governed by `R-WSTATE-005` and the commit authorization matrix.
- Realm history append remains governed by `R-WHIST-002` through `R-WHIST-005`.
- Runtime audit remains governed by `K-AUDIT-*` as observability and correlation authority.

Therefore:

- shared kernel commit semantics are limited to adapter-bound commit requests, not a new write contract
- shared kernel history semantics are limited to explicit append candidates or derived commit artifacts, not automatic history truth
- shared kernel replay/checkpoint evidence must not be represented as the canonical audit ledger

## K-WEV-005 Workflow Partial Reuse Boundary

The existing Runtime workflow DAG / task / node / output event model is not the semantic owner of the World Evolution Engine.

Allowed partial reuse is limited to runtime-local substrate candidates such as:

- `K-WF-003` workflow status vocabulary
- `K-WF-004` ordered runtime-local stream traits: `sequence`, `trace_id`, `timestamp`, `reason_code`, and terminal close behavior
- implementation-level stream delivery patterns that remain explicitly non-canonical

The following are not admissible as World Evolution Engine semantic truth:

- DAG / task / node as the top-level shared kernel vocabulary
- `payload: Struct` as a stable semantic envelope by itself
- direct promotion of workflow output events into shared kernel event truth
- `route_policy` / `fallback` bearing workflow node semantics as shared kernel semantic defaults

Workflow remains a reusable runtime subsystem, not the semantic home of the World Evolution Engine.

## K-WEV-006 Runtime-Owned Execution Semantics Family

The following semantic families belong to Runtime kernel because they describe runtime-local execution behavior rather than bridge access or placement topology:

- replay mode and replay restore boundaries
- checkpoint write / restore boundaries
- supervision, abort, quarantine, and defer semantics
- transition sequencing and effect-stage separation
- commit-request staging before Realm submission

These semantics are Runtime-owned because they depend on runtime-local scheduling, runtime-local effect execution, and runtime-local evidence handling.
They are not SDK bridge semantics and they are not Platform packaging semantics.

## K-WEV-007 Reuse-Without-Parallel-Truth Requirement

Any future expansion of `K-WEV-*` must reuse or extend the following authority families rather than duplicate them:

- `R-WHIST-*`
- `R-WSTATE-*`
- commit authorization matrix
- `K-AUDIT-*`

Future `K-WEV-*` rules must not introduce:

- a second commit-envelope contract
- a second run-mode vocabulary
- a second `effectClass` vocabulary
- a second canonical history contract
- a second audit-truth contract

## K-WEV-010 Minimal Canonical Runtime Event Shape

The World Evolution Engine event envelope is Runtime-owned semantic truth only for runtime-local execution semantics.

The minimal canonical Runtime event shape is:

| Field | Role |
|---|---|
| `eventId` | runtime-local stable event identity |
| `worldId` | shared world anchor for world-scoped execution |
| `appId` | caller / authority app anchor |
| `sessionId` | execution session anchor |
| `traceId` | cross-layer correlation anchor |
| `tick` | runtime execution order anchor |
| `timestamp` | event observation time |
| `eventKind` | semantic event kind |
| `stage` | execution stage vocabulary defined by `K-WEV-011` |
| `actorRefs` | actor participation anchor reused from Realm provenance |
| `causation` | prior-event causal reference |
| `correlation` | sibling / group correlation reference |
| `effectClass` | Realm-compatible mutation intent vocabulary |
| `reason` | semantic reason anchor |
| `evidenceRefs` | explicit evidence references |

Additional event-kind payload is allowed, but payload must remain subordinate to the envelope.
`payload: Struct` by itself must not be treated as semantic truth.

The following are **not** canonical Runtime event fields; they are adapter-bound or derived-only:

- `schemaId`
- `schemaVersion`
- `scope`
- `runMode`
- Realm commit authorization result
- history-append authorization result

Those values appear only when a later stage derives a commit-request or history-append candidate.

## K-WEV-011 Execution Stage Separation

The World Evolution Engine uses a fixed semantic stage boundary:

1. `INGRESS`
2. `NORMALIZE`
3. `SCHEDULE`
4. `DISPATCH`
5. `TRANSITION`
6. `EFFECT`
7. `COMMIT_REQUEST`
8. `CHECKPOINT`
9. `TERMINAL`

Boundary rules:

- `TRANSITION` owns runtime-local state evolution and may derive effect intents, but must not execute external effects.
- `EFFECT` executes external or observable work, but must not redefine the transition result after the fact.
- `COMMIT_REQUEST` may derive Realm-facing mutation candidates, but must not itself claim canonical Realm mutation authority.
- `CHECKPOINT` may persist runtime-local recovery state, but must not be represented as Realm shared present or history truth.

Any future Runtime implementation may optimize or batch internal steps, but it must preserve this semantic ordering.

## K-WEV-012 Replay Contract

V1 World Evolution Engine replay semantics are fixed to **recorded replay**.

That means:

- replay consumes recorded Runtime execution events, recorded supervision outcomes, recorded commit-request outcomes, and recorded checkpoint artifacts
- replay must not silently substitute fresh inference, fresh route selection, or fresh fallback decisions in place of recorded execution evidence
- if required replay evidence is missing, replay must fail-close rather than synthesize a pseudo-success path

Re-inference replay or hybrid replay is not part of the V1 canonical Runtime contract.

## K-WEV-013 Checkpoint Contract

Checkpoint is a Runtime-local recovery artifact, not a Realm truth artifact.

A checkpoint may contain:

- runtime-local state required to resume scheduling or supervision
- references to prior Runtime event IDs
- references to prior commit-request outcomes
- references to prior checkpoint IDs

A checkpoint must not be treated as:

- Realm world state
- Realm world history
- a substitute for commit authorization
- a substitute for audit truth

Checkpoint restore may restore Runtime-local execution context only.
Any Realm-visible mutation after restore still requires a newly staged, explicitly authorized commit path.

## K-WEV-014 Supervision And Fault-Isolation Outcomes

World Evolution Engine supervision semantics are Runtime-owned and use a closed outcome set:

- `CONTINUE`
- `DEFER`
- `ABORT`
- `QUARANTINE`

Optional re-attempt behavior is allowed only as an internal Runtime strategy under one constraint:

- a re-attempt must preserve the same semantic input, same execution mode, and same authority boundary
- a re-attempt must not become route migration, fallback migration, or hidden owner migration

Supervision outcomes are Runtime-local execution truth and must be represented in Runtime events or checkpoint evidence, not in Realm canonical truth.

## K-WEV-015 Commit-Request Staging Adapter Boundary

The World Evolution Engine may derive a commit-request candidate only at `COMMIT_REQUEST` stage.

The canonical staged commit-request must be a lossless projection to the Realm commit envelope fields required by `R-WSTATE-002`:

- `worldId`
- `appId`
- `sessionId`
- `effectClass`
- `scope`
- `schemaId`
- `schemaVersion`
- `actorRefs`
- `reason`
- `evidenceRefs`

Runtime may attach sidecar staging metadata such as:

- `sourceEventIds`
- `traceId`
- `tick`
- `causation`
- `correlation`
- checkpoint or supervision references

But that sidecar metadata is Runtime-local only and must not be treated as a second commit-envelope contract.

Authorization rules:

- Runtime must not invent a new `runMode` vocabulary
- Runtime must not self-authorize commit eligibility outside the commit authorization matrix
- `REPLAY` and any non-`CANON_MUTATION` runtime-local continuity path must not stage shared-history append as if they were `CANON_MUTATION`
- missing Realm envelope fields or unverifiable provenance must fail-close before the candidate is presented as a valid commit path

## K-WEV-016 Workflow Partial-Reuse Substrate Contract

If Runtime implementation reuses existing workflow substrate internally, the reuse is limited to implementation substrate only.

Allowed substrate reuse:

- ordered stream transport and subscriber lifecycle
- task-local progress/status vocabulary aligned with `K-WF-003`
- runtime-local sequencing and terminal close behavior aligned with `K-WF-004`
- internal dispatch or queue-management helpers that remain hidden beneath `K-WEV-*`

Forbidden top-level semantic reuse:

- `workflow`
- `task`
- `node`
- `edge`
- `callback_ref`
- `external_async`
- `route_policy`
- `fallback`

Forbidden semantic shortcuts:

- exposing workflow DAG identity as shared-kernel semantic identity
- treating workflow output events as shared-kernel canonical event truth
- treating workflow node payloads as a stable shared-kernel envelope

If an implementation uses workflow substrate, it must first project all externally relevant semantics into `K-WEV-*` event, stage, checkpoint, replay, supervision, and commit-request vocabulary.

## Fact Sources

- `.nimi/spec/platform/kernel/architecture-contract.md` — `P-ARCH-022` through `P-ARCH-028`
- `.nimi/spec/realm/kernel/world-state-contract.md` — `R-WSTATE-001` through `R-WSTATE-006`
- `.nimi/spec/realm/kernel/world-history-contract.md` — `R-WHIST-001` through `R-WHIST-006`
- `.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`
- `audit-contract.md` — `K-AUDIT-001`, `K-AUDIT-003`, `K-AUDIT-015`, `K-AUDIT-019`, `K-AUDIT-020`, `K-AUDIT-021`
- `workflow-contract.md` — `K-WF-003`, `K-WF-004`
- `scheduling-contract.md` — `K-SCHED-001` through `K-SCHED-007`
- `ai-profile-execution-contract.md` — `K-AIEXEC-003`, `K-AIEXEC-004`

