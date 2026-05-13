# Cognition Knowledge Service Contract

> Owner Domain: `C-COG-*`

## C-COG-043 Knowledge Service Operation Registry

The authoritative standalone cognition knowledge operation registry is
`tables/knowledge-service-operations.yaml`.

Fixed rules:

- every admitted knowledge service operation must appear in the registry exactly
  once
- every registered knowledge operation must declare admitted inputs, identity
  invariants, validation posture, retrieval posture, lifecycle effects,
  derived-view behavior, fail-closed reasons, and non-ownership boundary
- same-scope relation, retrieval, and ingest capability claims must be grounded
  in this registry rather than inferred from package names alone

## C-COG-044 Knowledge Page Lifecycle And Retrieval Semantics

Standalone cognition knowledge owns local projection lifecycle and retrieval.

Fixed rules:

- save/update semantics must remain explicit for one page in one cognition scope
- explicit delete semantics are required for knowledge ownership; page removal
  must not be represented as silent index disappearance
- lexical retrieval and hybrid retrieval must remain distinct contracts when
  both are admitted
- retrieval posture must declare ordering, fail-close behavior, and whether the
  returned projection is page truth, first-class relation truth, hybrid ranking,
  or ingest task state
- cognition knowledge must not claim parity with runtime-local knowledge if it
  reduces page lifecycle and retrieval semantics to a generic blob search

## C-COG-045 Knowledge Relation, Ingest, And Progress Semantics

Standalone cognition knowledge may admit same-scope graph and ingest capability
only through explicit owner-true contracts.

Fixed rules:

- relation write paths must validate source page, target page, relation type,
  scope equality, and duplicate/self-link constraints before commit
- relation truth must remain first-class and must not be represented by
  page-embedded pseudo-relations inside `Page.ArtifactRefs`
- backlink and traversal reads must declare traversal boundary, ordering, and
  fail-close behavior explicitly
- ingest capability must declare accepted input envelope, task/progress model,
  and page-write effects rather than collapsing ingest into a hidden side effect
- admitted ingest lifecycle is `queued -> running -> completed/failed`, and
  interrupted local tasks must become explicit failed-state evidence on reopen
- if a knowledge capability is not on the public surface, it must be placed on
  an explicit external routine path or explicit deferral list rather than left
  implicit

## C-COG-046 Knowledge Non-Ownership Boundary

Standalone cognition knowledge remains separate from runtime-owned infra truth.

Fixed rules:

- knowledge service does not own runtime bank authorization, shared-truth
  replication, workflow-service truth, or Agent Core admission
- relation integrity and ingest progress remain cognition-owned only for the
  standalone local projection path
- runtime-facing republication of overlapping knowledge semantics must route
  through `RuntimeCognitionService`; retired `RuntimeKnowledgeService` topology
  must not be restored as the future steady state
- same-scope local graph ownership does not authorize cognition to absorb
  runtime shared citation or runtime review semantics

## C-COG-059 Runtime Knowledge Bank Typed Scope Kind

Runtime-facing knowledge bank lifecycle is owned by a typed cognition scope
kind `runtime_knowledge_bank` registered in the cognition scope registry.
This scope kind is disjoint from agent-bound scope kinds (`agent_core`,
`agent_dyadic`, `world_shared`); it admits only the public infra-scoped
owners declared by K-KNOW-002 (`APP_PRIVATE`, `WORKSPACE_PRIVATE`).

Fixed rules:

- every runtime-facing knowledge bank corresponds to exactly one
  registered scope of kind `runtime_knowledge_bank`; the cognition scope
  registry is the single owner of this binding
- scope id provenance is the typed cognition scope registry; runtime
  facade and downstream consumers must not derive a scope id by ad-hoc
  string concatenation (e.g. `"know_" + bankID`) on production paths
- `runtime_knowledge_bank` scopes do not admit `AGENT_CORE`,
  `AGENT_DYADIC`, or `WORLD_SHARED` owner kinds; agent recall semantics
  (`Retain` / `Recall` / `History`) do not operate on this scope kind
- registered runtime knowledge bank scopes carry typed metadata
  (display_name, owner_kind, owner_key, owner_json, created_at,
  updated_at) sufficient to authorize and audit runtime-facing RPCs
  without re-reading legacy snapshot blobs
- delete of a `runtime_knowledge_bank` scope must cascade in a single
  storage transaction to all scope-anchored stores (page / relation /
  embedding / history / ingest task / FTS); no orphan rows may survive
- this rule is the cognition-side statement of the runtime-side
  retirement K-KNOW-001a; the two rules together forbid any parallel
  runtime-private bank truth

## C-COG-060 Runtime Workspace Authorization Seam

Runtime-facing cognition knowledge owns storage, typed scope registry, local
page/relation/ingest persistence, and action-to-storage facade behavior. It
does not own Runtime account authorization for WORKSPACE_PRIVATE banks.

Fixed rules:

- runtime knowledge authorization must enter through the
  `KnowledgeAuthorizer` seam before any workspace-owned bank data is returned
  or mutated
- `KnowledgeAuthorizer` is the only cognition-side consumer of the internal
  account workspace binding resolver
- cognition must not import account persistence internals, read account
  custody, read workspace membership projection directly, call Realm for
  membership per knowledge RPC, or derive authorization from app-local cache
- cognition must pass target owner kind, target workspace id,
  runtime-authenticated caller context from the protocol envelope
  (`x-nimi-app-id`, `x-nimi-app-instance-id`), workspace binding attachment,
  knowledge action, and required scopes to the authorizer. Device identity must
  be derived or verified by Runtime account/app registry state through the
  account resolver, not supplied by knowledge request body fields
- a deny or unavailable decision from the authorizer must fail closed and must
  not downgrade to APP_PRIVATE, anonymous, subject_user_id, fixture, or legacy
  behavior
