# Cognition Completion Contract

> Owner Domain: `C-COG-*`

## C-COG-053 Completion Gate Registry

The authoritative standalone cognition completion gates are
`tables/completion-gates.yaml`.

Fixed rules:

- every cognition completion gate must declare exactly one closure class
- admitted closure classes are `semantic_closure`, `implementation_closure`, and
  `runtime_independence`
- completion gates must remain explicit and enumerable rather than inferred from
  test count or package count

## C-COG-054 Semantic And Implementation Closure Separation

Standalone cognition completion must distinguish semantic closure from current
implementation status.

Fixed rules:

- semantic closure is satisfied only when owner surface, failure model, cleanup,
  retrieval, and formatting semantics are decision-complete
- production-grade completion additionally requires one admitted durable backend
  path rather than parallel low-strength persistence surfaces
- `C-COG-004=covered` records a cognition-local evidence state, not a global or
  final project-completion verdict
- implementation closure is satisfied only when admitted semantics have matching
  code paths, reopen-safe persistence/recovery evidence, and behavior-level
  proof strong enough to justify `covered`
- top-level completion requires authoritative routine worker mutation paths to
  be semantically equivalent to the service-owned lifecycle policy they claim
  to represent, and that equivalence must be established by behavior-level
  proof rather than inferred solely from local green gates
- top-level completion also requires public mutation surfaces to reject illegal
  lifecycle resurrection, relation/graph writes to non-live targets, and
  provenance payloads that have not yet been closed into owner-true semantics
- when redesign audit reopens `C-COG-004`, rule evidence must return to
  `deferred` until the narrower subsystem rules, their direct behavior tests,
  and a fresh independent completion review are re-established
- `C-COG-004` may be restored to `covered` only when:
  - authoritative worker and service owner paths are semantically aligned
  - legacy low-strength cleanup helpers are no longer part of admitted truth
  - fail-closed behavior is covered across admitted retrieval and cleanup
    failure families
  - a fresh independent standalone audit agrees the remaining gaps are no
    longer semantic blockers
- once `C-COG-004` is `covered`, any new durable backend path or newly admitted
  public cognition surface requires prior cognition authority update plus a
  fresh completion audit rather than automatic inheritance of existing closeout
- rule evidence must use `deferred` whenever admitted semantics outpace current
  implementation or available proof
- if prompt, digest, or refgraph proof regresses from behavior-level evidence to
  formatting-only, best-effort, or weak-string evidence, affected rule evidence
  must be downgraded before production-grade closeout can still be claimed

## C-COG-055 Runtime Independence Completion Gate

Standalone cognition completion requires runtime independence in both authority
and operation.

Fixed rules:

- standalone cognition must remain spec-complete without importing runtime as a
  prerequisite owner
- build, retrieval, prompt, cleanup, and mutation semantics must not require
  runtime-owned provider, replication, review, or lifecycle truth to appear
  complete
- build/test/race gates are necessary runtime-independence evidence, but they do
  not by themselves prove top-level standalone semantic closure
- race-safe standalone execution evidence must remain part of the completion
  gate for production-grade closeout
- runtime bridge presence may strengthen coexistence but must not become a
  hidden completion dependency
- repo-wide non-cognition governance drift must be recorded explicitly rather
  than misreported as cognition completion failure
