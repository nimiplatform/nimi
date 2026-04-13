# Runtime Memory Service Contract

> Owner Domain: `K-MEM-*`

## K-MEM-001 RuntimeMemoryService Authority Home

`RuntimeMemoryService` is the runtime-owned authority for local operational memory infrastructure.

It owns:

- bank lifecycle
- bank isolation
- retain / recall / history / reflect operations
- embedding profile binding
- provider bridge
- runtime-owned replication into Realm

It does not own:

- agent identity
- agent life state
- agent canonical memory semantics
- account authn/authz truth

`Working memory` is outside this service. Prompt assembly state, tool traces, turn plans, and other runtime execution scratch state must remain outside Memory Service truth.

## K-MEM-002 Bank Scope And Isolation

`RuntimeMemoryService` bank scope is defined by `tables/runtime-memory-bank-scope.yaml`.

Fixed rules:

- every memory unit belongs to exactly one bank
- banks are isolated from one another
- admitted implementation-facing transport must expose a scope-typed bank locator family with dedicated owner branches for `AGENT_CORE`, `AGENT_DYADIC`, `WORLD_SHARED`, `APP_PRIVATE`, and `WORKSPACE_PRIVATE`
- cross-scope owner combinations (for example, a `WORLD_SHARED` bank carrying an app-private owner shape) must not appear as a normal public contract form
- `AGENT_CORE`, `AGENT_DYADIC`, and `WORLD_SHARED` are canonical-agent-facing scopes
- `APP_PRIVATE` and `WORKSPACE_PRIVATE` are infra scopes and must not be collapsed into canonical agent memory
- `WORLD_SHARED` continuity is keyed by `world`, not by `account`
- public app-facing bank creation is admitted only for `APP_PRIVATE` and `WORKSPACE_PRIVATE`
- canonical agent-facing scopes are provisioned by runtime-owned internal paths, not by app-facing `CreateBank`

Account identity may constrain access, but account must not become the physical truth owner of `WORLD_SHARED`.

## K-MEM-003 Provider Boundary

The runtime public memory contract is provider-agnostic.

Fixed rules:

- public memory RPC and SDK surfaces must expose Nimi-owned operation names and types
- primary semantic memory payloads must use Nimi-owned typed messages; dynamic envelopes are limited to metadata, attributes, or extensions fields
- admitted implementation-facing transport must reserve a typed memory record family for `episodic`, `semantic`, and `observational` records rather than collapsing durable memory into a free-form blob payload
- provider-native wire shapes, bank config fields, and provider-specific storage semantics must remain internal
- memory is explicit opt-in rather than a baseline product capability; when enabled without an attached override, the default experimental substrate is runtime-managed `Hindsight`
- runtime-private substrate connectivity, feature floor, and typed identity overlay requirements are governed by `K-MEMSUB-*`
- provider engines must not own account auth, app authz, agent ownership, or canonical memory semantics

## K-MEM-004 Embedding Profile Immutability

Each bank must bind a fixed embedding profile containing at least:

- provider
- model_id
- dimension
- distance_metric
- version
- migration_policy

Fixed rules:

- the embedding profile is part of bank identity
- bank writes and recalls must use the same bound profile
- provider engines must not silently switch embedding models
- profile dimension changes require explicit migration rather than in-place drift
- runtime-owned embedding execution is the only admitted embedding authority
- when the default `Hindsight` substrate runs in supervised mode, runtime must inject the substrate's embedding path onto a runtime-owned llama OpenAI-compatible loopback rather than allowing direct external embedding provider configuration

## K-MEM-005 Realm Replication Boundary

Realm is the cloud/shared replicated persistence and governance plane for continuity memory.

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

## K-MEM-006 Public Surface

`RuntimeMemoryService` admits the following public operations:

- `CreateBank`
- `GetBank`
- `ListBanks`
- `DeleteBank`
- `Retain`
- `Recall`
- `History`
- `Reflect`
- `DeleteMemory`
- `SubscribeMemoryEvents`

Access rules:

- authorized apps may directly use infra scopes admitted to them
- apps must not directly mutate canonical agent memory scopes
- canonical agent memory writes route through `RuntimeAgentCoreService`
- app-facing `CreateBank` / `DeleteBank` must reject canonical agent-facing scopes
- admitted implementation-facing transport for `CreateBank` / `DeleteBank` must keep infra-only locator branches explicit rather than treating canonical scope rejection as an untyped afterthought
- implementation-facing transport must encode bank locator invariants strongly enough that illegal scope/owner combinations are not treated as a normal public contract shape

## K-MEM-007 Failure Model

`RuntimeMemoryService` must fail-close on substrate unavailability.

Fixed rules:

- when the explicitly enabled memory engine, embedding bridge, or required local memory substrate is unavailable, dependent RPCs must fail with `UNAVAILABLE`
- the corresponding runtime reason must stay explicit (`AI_LOCAL_SERVICE_UNAVAILABLE` when the managed local memory service is unavailable)
- no substitute provider, synthetic success payload, or degraded shadow engine may be used to mask failure
- when no admitted memory provider is installed, provider-dependent operations must surface the same `UNAVAILABLE` failure family
- if Realm replication is unavailable, local operational writes may continue only when local admission succeeds and sync backlog remains observable; replication failure must not be hidden as fully synchronized success
- provider replay or rebuild to preserve runtime-owned delete/invalidation truth must follow the runtime-private replay contract in `K-MEMSUB-005`

## K-MEM-008 Replication State And Conflict Semantics

`RuntimeMemoryService` replication semantics must remain explicit at the contract layer.

Replication outcomes are defined by `tables/runtime-memory-replication-outcome.yaml`.

Fixed rules:

- append-only commit lineage is the default replication model
- each replicated write must retain an observable version basis for merge or invalidation handling
- replication state must remain externally distinguishable at least as `pending`, `synced`, `conflict`, or `invalidated`
- governance or moderation invalidation from Realm must produce an explicit invalidation outcome rather than silent disappearance
- admitted implementation-facing transport must expose typed replication state, conflict detail, and invalidation detail families as first-class runtime contract data
- implementation-facing transport must represent conflict / invalidation state as typed runtime contract data, not as provider-native opaque text

## K-MEM-009 Replication Lifecycle Observation Path

`RuntimeMemoryService` owns the runtime-private replication lifecycle store and committed transition path for local memory records.

Fixed rules:

- replication observation ingress is runtime-private and must not require a new public RPC surface
- runtime may mutate replication state only through admitted typed `MemoryReplicationState` families; free-form provider blobs are not admitted replication truth
- committed replication transitions must update the authoritative `MemoryRecord.replication` state before publication so read APIs and event replay observe the same truth
- `MEMORY_EVENT_TYPE_REPLICATION_UPDATED` must originate from the committed record mutation path, not from snapshot inference or accepted-write decoration
- admitted transitions are `PENDING -> SYNCED|CONFLICT|INVALIDATED` and `CONFLICT -> SYNCED|INVALIDATED`; `SYNCED` and `INVALIDATED` are terminal for this runtime contract unless a later rule explicitly admits otherwise
- invalidated records must fail closed out of default history/recall visibility until the caller explicitly opts into invalidated results

## K-MEM-010 Replication Backlog Truth

`RuntimeMemoryService` owns the runtime-private replication backlog for canonical memory records whose replication remains operationally pending.

Fixed rules:

- backlog truth is runtime-local committed state, not transient goroutine state or inferred scheduler memory
- canonical writes that admit `replication=pending` must enqueue exactly one backlog item for the `(bank locator, memory_id)` pair in the same committed local mutation path
- infra scopes must not enter the replication backlog
- backlog items must retain at least local version, basis version, enqueue time, last attempt time, attempt count, and local backlog status
- until a later Realm memory redesign admits real bridge transport, backlog truth is deferred bridge telemetry only and must not be treated as product-ready cloud sync
- runtime-private bridge loops may claim backlog items for single-owner processing only on explicit internal paths; normal daemon startup must not imply active Realm synchronization
- terminal replication outcomes committed through `K-MEM-009` must remove or terminalize the corresponding backlog item in the same committed state transition
