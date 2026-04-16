# Cognition Reference Contract

> Owner Domain: `C-COG-*`

## C-COG-047 Admitted Reference Matrix

The authoritative standalone cognition reference matrix is
`tables/admitted-reference-matrix.yaml`.

Fixed rules:

- every registered cognition family must appear exactly once in the reference
  matrix
- the matrix must declare allowed outgoing refs, allowed incoming refs,
  forbidden cross-family refs, cross-scope prohibition, and missing-target
  effects per family
- cross-family reference admission must be defined by this matrix rather than
  inferred from storage convenience or permissive tests
- kernel rules may own outgoing refs to standalone advisory artifacts only where
  the matrix explicitly admits `memory_substrate`, `knowledge_projections`, and
  `skill_artifacts` as kernel targets
- kernels remain forbidden as incoming reference targets; advisory artifacts must
  not claim kernel ownership by storing reverse refs into kernel families

## C-COG-048 Refgraph Explainability Boundary

Standalone cognition refgraph is the explainability authority for local static
artifact relations.

Fixed rules:

- cleanup proposals must remain traceable to broken refs, incoming support,
  outgoing dependency health, and remove blockers
- refgraph explainability must remain explicit and queryable rather than hidden
  inside digest heuristics
- refgraph owns only local static relation truth; it does not absorb runtime
  review, replication, alias, or provider-ranking semantics
- first-class `knowledge_relation` rows are part of cognition-local relation
  truth and must participate in backlink, traversal, delete blocker, and digest
  cleanup reasoning
- remove blockers must distinguish strong vs weak inbound support and must not
  flatten both classes into one generic blocker string
- removed sources do not contribute live support; removed targets remain visible
  as broken dependency evidence

## C-COG-049 Missing-Target And Cleanup Blocking Semantics

Missing-target behavior must remain family-specific and fail-closed.

Fixed rules:

- when a family marks missing targets as `reject`, save-time mutation must fail
  before commit
- archive or remove blocking caused by missing or incoming relations must remain
  explicit in cleanup reasoning
- cleanup blocking must not be silently bypassed by forcing a generic remove
  path through storage ownership alone
- digest `remove` requires prior archival plus a later pass confirmation; same-
  pass archive-and-remove is not admitted
