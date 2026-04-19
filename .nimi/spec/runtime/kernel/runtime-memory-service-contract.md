# Runtime Cognition And Retained Memory Depth Contract

> Owner Domain: `K-MEM-*`

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
  replacement must not collapse Agent Core, bank/access, provider, replication,
  workflow, or canonical review truth into cognition by implication

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
  `RuntimeAgentCoreService`
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
- when the default `Hindsight` substrate runs in supervised mode, runtime must inject the substrate's embedding path onto a runtime-owned llama OpenAI-compatible loopback rather than allowing direct external embedding provider configuration

## K-MEM-004a Desktop Live Config And Runtime Resolved Truth Split

Editable memory embedding config may exist as Desktop-host-owned live config
truth, but runtime remains the sole owner of resolved retained-memory execution
truth.

Fixed rules:

- Desktop host may own user-editable memory embedding source / binding intent as
  canonical host-local persistence truth
- runtime does not become a second canonical persistence owner for that editable
  config
- runtime is the only admitted owner of resolved embedding profile, binding
  legality/readiness, bank identity, rebuild state, migration state, and
  cutover result
- runtime must consume host-provided memory embedding intent through an admitted
  typed boundary and fail-close when the requested binding cannot resolve to an
  admitted runtime execution path
- if host config scope identity does not uniquely determine the runtime
  canonical bank lifecycle target, the admitted typed boundary must carry an
  explicit runtime target identity rather than inferring one from host-local UI
  state
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
- Desktop/app consumers may read/write editable memory embedding config only
  through admitted typed host-owned config surfaces
- Desktop/app consumers may inspect resolved memory embedding state and request
  canonical bank bind / rebuild / cutover only through an admitted typed
  host/runtime boundary
- `RuntimeCognitionService` public memory family remains fixed by `K-MEM-006`;
  migration convenience must not expand that public family just to expose
  canonical agent-facing bank control
- canonical agent-facing bind / rebuild / cutover semantics remain on
  runtime-private typed paths owned by retained runtime memory depth

## K-MEM-006b Runtime-Private Memory Embedding Operation Family

当 host product 需要 memory embedding resolved state 与 canonical bank lifecycle
操作时，retained runtime-private memory depth 必须提供最小的 typed logical
operation family。

该 family 是 runtime-private typed boundary，不是新的 public RPC family。

最小 logical operations 固定为：

- `InspectMemoryEmbeddingState`
- `RequestCanonicalMemoryEmbeddingBind`
- `RequestMemoryEmbeddingCutover`

固定规则：

- `InspectMemoryEmbeddingState` 必须返回 typed runtime contract data，至少覆盖：
  - 当前 host-provided binding intent 的 resolution verdict
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
- 当当前 bank 未绑定且 binding intent 可解析时，
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
  admitted truths remain runtime-private and are consumed through Agent Core
  owned internal paths only

## K-MEM-012 Runtime-Private Canonical Read And Review Commit Boundary

Retained runtime-private memory depth owns the typed read and commit boundary
consumed by `RuntimeAgentCoreService` for canonical review.

Fixed rules:

- Agent Core must read admitted truths, narrative context, canonical review inputs, and review checkpoints through a runtime-private typed facade rather than direct store access
- runtime-private read surfaces must return typed runtime contract data, not raw SQLite rows or provider-native blobs
- review result commit must be idempotent by `review_run_id`
- all Memory Service owned narrative / truth / lineage mutations for a canonical review run must commit atomically before Agent Core publishes follow-up checkpoint or event truth
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
