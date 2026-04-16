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
- same-scope local graph ownership does not authorize cognition to absorb
  runtime shared citation or runtime review semantics
