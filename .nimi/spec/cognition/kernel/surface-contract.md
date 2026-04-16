# Cognition Surface Contract

> Owner Domain: `C-COG-*`

## C-COG-026 Root Constructor Surface

The root standalone cognition constructor surface is defined by `tables/public-surface.yaml`.

Fixed rules:

- `New` is the admitted standalone root constructor
- admitted constructor options may configure standalone-local behavior, but must not introduce runtime semantic dependency
- constructor success means the standalone store, refgraph authority, transient working-state lane, and public subservices are all ready

## C-COG-027 Root Facade Surface

The root `cognition.Cognition` facade must remain exact and owner-true.

Fixed rules:

- the admitted root facade methods are:
  - `KernelService`
  - `MemoryService`
  - `KnowledgeService`
  - `SkillService`
  - `WorkingService`
  - `PromptService`
  - `KernelEngine`
  - `NewRoutineContext`
  - `InitScope`
  - `DeleteScope`
  - `ListScopes`
  - `Close`
- digest facade methods, compatibility wrappers, and optional capability claims without real wiring are not admitted
- root facade growth requires cognition kernel admission rather than convenience aggregation

## C-COG-028 Kernel Public Surface

Kernel public surface is narrow and explicit.

Fixed rules:

- `KernelService` admits only kernel initialization, typed load, and engine access
- direct kernel mutation remains governed by the admitted kernelops surface rather than ad hoc service helpers
- root `KernelEngine` exposure does not authorize bypass of kernel validation or commit semantics

## C-COG-029 Advisory Family Service Surfaces

Advisory family services must keep artifact truth and derived serving truth distinct.

Fixed rules:

- `MemoryService` admits raw artifact save/load/list/search, explicit delete, explicit history/lineage read, and derived view reads
- `KnowledgeService` admits typed page lifecycle, lexical retrieval, lexical-plus-vector hybrid retrieval, first-class relation graph ownership, ingest/progress lifecycle, and history reads over validated knowledge projections
- `SkillService` admits typed bundle save/load/list/lexical-search, explicit delete, and explicit history reads over validated skill artifacts
- `WorkingService` admits only `Save`, `Load`, and `Clear` over transient working state
- advisory family services must not silently inherit runtime review, replication, or event-stream ownership

## C-COG-030 Derived View And Prompt Surface

Prompt serving must consume owner-true surfaces.

Fixed rules:

- derived serving views remain service-owned outputs rather than caller-owned stored truth
- `MemoryService` derived views carry service-owned support, lineage, invalidation,
  and cleanup posture; callers must not persist those fields as raw memory truth
- `PromptService` admits `FormatCore`, `FormatAdvisory`, and `FormatAll`
- `FormatCore` serves kernel truth only
- advisory prompt formatting consumes validated advisory artifacts and derived views, not working state or routine evidence
- admitted prompt lanes and derived-input rules are defined by `tables/prompt-serving-lanes.yaml`

## C-COG-031 Routine Context Surface

The authoritative external routine entry on the standalone root is `NewRoutineContext`.

Fixed rules:

- routine context must expose typed non-kernel artifact access plus clock access
- routine context must not expose direct kernel mutation or raw store ownership as its primary contract
- one routine context is scoped to exactly one cognition scope

## C-COG-032 Routine Package And Worker Surface

Routine packages may expose explicit worker entrypoints without reintroducing facade ownership.

Fixed rules:

- worker-first entrypoints such as `digest.NewWorker(...).Run(ctx)` are admitted routine package surfaces
- routine cleanup mutation must flow through lifecycle-aware archive/remove surfaces rather than raw delete access
- low-level digest analysis/apply helpers must remain internal implementation detail rather than public execution contract
- standalone cognition must not grow a façade-owned digest pseudo-service
