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
- `REPLAY` and `PRIVATE_CONTINUITY` must not stage shared-history append as if they were `CANON_MUTATION`
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
