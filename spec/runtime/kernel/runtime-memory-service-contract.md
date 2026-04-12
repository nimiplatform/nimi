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
- `AGENT_CORE`, `AGENT_DYADIC`, and `WORLD_SHARED` are canonical-agent-facing scopes
- `APP_PRIVATE` and `WORKSPACE_PRIVATE` are infra scopes and must not be collapsed into canonical agent memory
- `WORLD_SHARED` continuity is keyed by `world/realm`, not by `account`
- public app-facing bank creation is admitted only for `APP_PRIVATE` and `WORKSPACE_PRIVATE`
- canonical agent-facing scopes are provisioned by runtime-owned internal paths, not by app-facing `CreateBank`

Account identity may constrain access, but account must not become the physical truth owner of `WORLD_SHARED`.

## K-MEM-003 Provider Boundary

The runtime public memory contract is provider-agnostic.

Fixed rules:

- public memory RPC and SDK surfaces must expose Nimi-owned operation names and types
- primary semantic memory payloads must use Nimi-owned typed messages; dynamic envelopes are limited to metadata, attributes, or extensions fields
- provider-native wire shapes, bank config fields, and provider-specific storage semantics must remain internal
- the default engine is `Hindsight`, managed as a runtime-owned local daemon
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
- implementation-facing transport must encode bank locator invariants strongly enough that illegal scope/owner combinations are not treated as a normal public contract shape

## K-MEM-007 Failure Model

`RuntimeMemoryService` must fail-close on substrate unavailability.

Fixed rules:

- when the default memory engine, embedding bridge, or required local memory substrate is unavailable, dependent RPCs must fail with `UNAVAILABLE`
- the corresponding runtime reason must stay explicit (`AI_LOCAL_SERVICE_UNAVAILABLE` when the managed local memory service is unavailable)
- no substitute provider, synthetic success payload, or degraded shadow engine may be used to mask failure
- if Realm replication is unavailable, local operational writes may continue only when local admission succeeds and sync backlog remains observable; replication failure must not be hidden as fully synchronized success

## K-MEM-008 Replication State And Conflict Semantics

`RuntimeMemoryService` replication semantics must remain explicit at the contract layer.

Replication outcomes are defined by `tables/runtime-memory-replication-outcome.yaml`.

Fixed rules:

- append-only commit lineage is the default replication model
- each replicated write must retain an observable version basis for merge or invalidation handling
- replication state must remain externally distinguishable at least as `pending`, `synced`, `conflict`, or `invalidated`
- governance or moderation invalidation from Realm must produce an explicit invalidation outcome rather than silent disappearance
- implementation-facing transport must represent conflict / invalidation state as typed runtime contract data, not as provider-native opaque text
