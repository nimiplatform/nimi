# SDK World Evolution Engine Consumer Contract

> Owner Domain: `S-RUNTIME-*`

## Scope

This contract defines the controlled app/mod consumer-facing API landing for the World Evolution Engine.
It owns only the downstream consumer seam that composes SDK projection-visible shapes into app-facing SDK facades and mod host-injected facades.
It also defines the selector-read stable method contract for the approved read-only slice and the typed facade framing for the remaining non-stable families.
It does not redefine Runtime execution semantics, SDK projection semantics, host bridge concrete API, or implementation strategy.

Consumer rule map:

- `S-RUNTIME-085` defines the consumer API ownership boundary.
- `S-RUNTIME-086` defines the admissible consumer surface families.
- `S-RUNTIME-087` defines the read/observe surface boundary.
- `S-RUNTIME-088` defines the command/request surface boundary.
- `S-RUNTIME-089` defines the inadmissible affordance and leakage hardcut.
- `S-RUNTIME-090` defines the host/app/mod boundary and no-implementation-assumption hardcut.
- `S-RUNTIME-092` defines the shared typed candidate building blocks.
- `S-RUNTIME-093` defines the admissible observe and selector-read candidate categories.
- `S-RUNTIME-094` defines the admissible request / result / rejection candidate categories.
- `S-RUNTIME-095` defines which candidates may advance to later implementation design and which remain below stable method-contract authority.
- `S-RUNTIME-096` defines candidate shapes that remain inadmissible.
- `S-RUNTIME-097` defines the shared selector-read stable semantic method-category matrix.
- `S-RUNTIME-098` defines the shared selector matrix.
- `S-RUNTIME-099` defines the shared read-result matrix.
- `S-RUNTIME-100` defines the shared read-only rejection matrix.
- `S-RUNTIME-101` defines shared semantic parity and publication layering requirements across app-facing and mod-facing selector-read methods.

## S-RUNTIME-085 Consumer API Ownership Boundary

The World Evolution Engine app/mod consumer-facing API contract lands in SDK kernel as a downstream consumer seam contract.

Therefore:

- Runtime `K-WEV-*` remains the semantic owner for execution events, replay, checkpoint, supervision, effect-stage ordering, and commit-request staging semantics.
- `world-evolution-engine-projection-contract.md` remains the owner of normalized SDK projection-visible shapes.
- This consumer contract owns only how app-facing SDK facades and mod host-injected facades may compose those already-visible shapes into stable consumer API families

This contract must not:

- redefine Runtime execution semantics
- redefine SDK projection-visible shape meaning
- introduce a second consumer semantic owner outside SDK kernel
- define host bridge concrete methods, transport bindings, or host implementation internals

## S-RUNTIME-086 Admissible Consumer Surface Families

The stable World Evolution Engine consumer surface is limited to two families:

- `read/observe` surface, including observe and selector-read candidate families
- `command/request` surface, including request / result / rejection candidate families

Both families must compose only SDK projection-visible shapes already admitted by `S-RUNTIME-079` through `S-RUNTIME-084`.

No stable third family is admissible for:

- workflow substrate truth ownership
- host-private control-plane ownership
- app-local or mod-local shadow semantic ownership
- direct Runtime or Realm private client access

If a proposed consumer API shape cannot be described as one of the two families above using only projection-visible shapes, it is inadmissible.

## S-RUNTIME-087 Read / Observe Surface Boundary

World Evolution Engine read/observe surface is read-only and may expose only normalized consumer-visible projections composed from existing SDK projection-visible shapes.
Within that boundary, the only admissible candidate sub-families are observe and selector-read.

Allowed read/observe families are limited to:

- execution event envelope observation using the normalized `K-WEV-010` field set projected by `S-RUNTIME-080`
- kind-specific discriminated event detail that remains subordinate to the normalized envelope
- replay result or replay evidence-reference views already bounded by `S-RUNTIME-081`
- checkpoint identifier, checkpoint reference, or restore-status views that remain explicitly Runtime-local under `S-RUNTIME-081`
- supervision outcome views using the closed `CONTINUE | DEFER | ABORT | QUARANTINE` vocabulary
- commit-request candidate/result views only as adapter-bound read models already bounded by `S-RUNTIME-082`

Read/observe surface must not expose as stable consumer truth:

- scheduler internals
- queue internals
- workflow node or task progress internals
- raw checkpoint payload or restore substrate
- hidden re-inference state
- route migration or fallback migration internals

Missing required projection-visible fields or evidence references must fail-close.
Consumer read/observe surface must not reinterpret absence as implicit success, implicit recovery, or implicit completion.

## S-RUNTIME-088 Command / Request Surface Boundary

World Evolution Engine command/request surface may exist only as an explicit consumer-intent seam layered on top of SDK projection-visible identifiers, selectors, references, and result shapes.
Within that boundary, the only admissible candidate sub-families are request / result / rejection.

Allowed command/request framing is limited to requests that:

- accept only projection-visible identifiers, references, selectors, filters, or subscription parameters
- return explicit typed acknowledgment, result, or rejection shapes without inventing a second semantic vocabulary
- preserve Runtime-owned replay/checkpoint/supervision/commit-request meaning as observed through `S-RUNTIME-080` through `S-RUNTIME-082`

Command/request surface must not:

- accept workflow DAG, task, node, edge, or output-event identity as consumer control-plane truth
- accept raw commit envelopes, raw history-append payloads, or raw checkpoint state as stable consumer inputs
- expose direct commit authorization, direct history append, or direct canonical world-state mutation as consumer-owned success semantics
- add fallback, route migration, re-inference, or hidden recovery knobs that are not already projection-visible contract truth

This landing freezes the category boundary only.
It does not define a concrete method list, transport binding, host bridge shape, or lifecycle implementation.

## S-RUNTIME-089 Inadmissible Affordance And Leakage Hardcut

World Evolution Engine consumer-facing API must not widen or leak Runtime-local substrate into app/mod stable truth.

The following are inadmissible consumer affordances:

- workflow DAG/task/node/output vocabulary as top-level consumer truth
- scheduler, queue, or worker-local control knobs
- `route_policy`, `fallback`, or equivalent recovery/migration controls
- runtime-private checkpoint substrate or supervision substrate
- consumer-authored semantic reinterpretation of missing evidence
- host-private singleton handles, app-private client handles, or mod-private client handles
- direct authoring of canonical Realm mutation truth, canonical history truth, or canonical audit truth

Consumer API must not turn:

- a commit-request candidate into implied Realm mutation success
- replay evidence into permission for fresh inference or hybrid replay
- read-model absence into synthetic empty success
- Runtime-local execution evidence into Realm/shared canonical truth

## S-RUNTIME-090 Host / App / Mod Boundary And No-Implementation-Assumption Hardcut

App-facing World Evolution Engine consumer API may be published only through SDK public surface.
Mod-facing World Evolution Engine consumer API may be published only through host-injected facade or equivalent stable mod surface that preserves the same consumer contract.

Both paths must preserve one composed contract:

- same projection-visible shape vocabulary
- same fail-close behavior
- same no-leak / no-widening / no-bypass hardcuts

Therefore consumer API must not:

- depend on `runtime/internal/**`
- depend on Realm private clients or private transport
- depend on SDK private internals
- depend on host bridge private methods, app-private state stores, or mod-private bypass clients
- assume concrete subscription plumbing, buffering strategy, caching policy, or host lifecycle behavior as normative contract

If a consumer surface requires those assumptions to be well-defined, that surface is not yet admissible for stable landing.

## S-RUNTIME-092 Shared Typed Candidate Building Blocks

App-facing SDK facades and mod-facing host-injected facades must share one minimal typed candidate vocabulary.

That shared vocabulary is limited to:

- projection-visible envelope anchors and discriminators already admitted by `S-RUNTIME-080`
- projection-visible replay / checkpoint / supervision references and outcomes already admitted by `S-RUNTIME-081`
- projection-visible commit-request candidate / result fields already admitted by `S-RUNTIME-082`
- selector atoms composed only from those already-visible anchors, discriminators, identifiers, references, and adapter-bound candidate fields

Selector framing must remain projection-derived only.
It must not introduce a second semantic vocabulary for execution identity, canonical mutation truth, or workflow substrate identity.

Therefore shared typed building blocks must not require:

- workflow DAG / task / node / edge / output identifiers
- raw checkpoint payloads or restore substrate
- raw commit envelopes, history-append payloads, or audit records as consumer-authored inputs
- host-private handles, app-private handles, or mod-private handles

## S-RUNTIME-093 Admissible Observe And Selector-Read Candidate Categories

The following consumer candidate categories may advance to later implementation design as read-only facades:

- ordered execution-event observation over the normalized envelope and subordinate discriminated detail
- selector-scoped event / evidence collection views composed from projection-visible anchors and references
- runtime-local replay / checkpoint / supervision views that stay explicitly bounded by `S-RUNTIME-081`
- adapter-bound commit-request candidate / result views that stay explicitly bounded by `S-RUNTIME-082`

All observe and selector-read categories must make the evidence class explicit.
They must distinguish runtime-local execution evidence, runtime-local recovery evidence, and adapter-bound commit-request views rather than collapsing them into one canonical-truth model.

They must not:

- imply shared present-state truth
- imply shared history truth
- expose raw workflow substrate or queue / scheduler substrate
- treat absence as implicit success, implicit completion, or implicit "no-op but valid" truth

## S-RUNTIME-094 Admissible Request / Result / Rejection Candidate Categories

The following request-side candidate categories are admissible for later implementation design:

- requests to establish or scope an observe flow using projection-visible selectors or references
- requests to evaluate selector-scoped read models over projection-visible execution or recovery evidence
- requests to derive, inspect, or forward replay / checkpoint / supervision outcomes using Runtime-owned references
- requests to derive, inspect, or forward adapter-bound commit-request candidates or adapter-visible submission outcomes

Result and rejection framing is limited to category-level contract only.
This contract does not yet freeze a concrete enum set, method list, or transport envelope.

Admissible result categories are limited to:

- explicit acknowledgment that a request was admitted for evaluation, without implying semantic success
- explicit typed read models or observation items composed from projection-visible shapes
- explicit Runtime-local outcome views or adapter-bound commit-request candidate / outcome views

Admissible rejection framing is limited to explicit typed failure that preserves existing SDK error projection or Runtime reason truth for one of the following category causes:

- invalid or incomplete selector / reference
- missing required Runtime evidence
- unsupported candidate family at the current authority phase
- authority or boundary denial
- contract-shape mismatch

Request / result / rejection framing must not:

- add fallback, route migration, re-inference, or hidden recovery knobs
- reinterpret a commit-request candidate as canonical mutation success
- reinterpret Runtime-local evidence as Realm/shared canonical truth
- synthesize empty success or silent downgrade when required typed evidence is absent

## S-RUNTIME-095 Candidate Admission To Later Implementation Design

The following World Evolution Engine consumer candidates are admitted to later implementation design:

- app-facing logical facade families governed by `S-RUNTIME-091`
- mod-facing host-injected logical facade families governed by `S-MOD-014`
- shared selector, observe-item, read-model, acknowledgment, and rejection type families governed by `S-RUNTIME-092` through `S-RUNTIME-094`

This admission is category/framing-only.
Selector-read stable methods governed by `S-RUNTIME-097` through `S-RUNTIME-101` are the only exception.
All other admitted candidates remain below stable method-contract authority.

The following remain outside stable method-contract authority and must be decided only in a later implementation design that stays within current frozen authority:

- concrete method names
- concrete package export names beyond existing public surfaces
- concrete host bridge methods or IPC payloads
- subscription lifecycle, buffering, caching, pagination, or replay-delivery policy
- batching, session ownership, or host confirmation UX semantics

## S-RUNTIME-096 Still-Inadmissible Candidate Shapes

The following candidate shapes remain inadmissible even for later implementation design under the current frozen authority:

- workflow executor / DAG controller / task-node control facades
- direct canonical world-state mutator, canonical history append, or canonical audit writer facades
- raw checkpoint-substrate, supervision-substrate, scheduler, queue, or worker control facades
- host bridge passthrough, IPC mirror, or transport-payload passthrough facades
- route migration, fallback migration, re-inference, or hidden semantic recovery facades
- runtime-private, realm-private, app-private, or mod-private bypass facades
- any facade that turns Runtime-local evidence into Realm/shared canonical truth
- any facade that turns commit-request candidacy into implied authorization success or canonical mutation success

## S-RUNTIME-097 Shared Selector-Read Stable Semantic Method-Category Matrix

The World Evolution Engine stable selector-read semantic method-category matrix is closed to the following logical methods:

- `worldEvolution.executionEvents.read(selector)`
- `worldEvolution.replays.read(selector)`
- `worldEvolution.checkpoints.read(selector)`
- `worldEvolution.supervision.read(selector)`
- `worldEvolution.commitRequests.read(selector)`

These logical methods are semantic method categories, not transport methods, daemon RPC parity, host bridge methods, or IPC payload contracts.

No additional stable World Evolution Engine selector-read method categories are admissible in this phase.
The following remain out of scope and must not be added to this stable method matrix:

- observe / subscribe methods
- session or lifecycle methods
- replay / checkpoint / supervision advancement methods
- commit-request forward or submit methods

## S-RUNTIME-098 Shared Selector Matrix

Only projection-visible selector primitives already admitted by `S-RUNTIME-080` through `S-RUNTIME-082` may participate in the stable selector-read contract.

Stable selector matrix:

- `worldEvolution.executionEvents.read(selector)`
  - exact-match selectors:
    - `eventId`
    - `worldId + sessionId + tick`
  - filter-like selectors:
    - must include at least one anchor from `worldId | sessionId | traceId`
    - may additionally include `appId`
    - may additionally include refinements from `eventKind | stage | actorRefs | causation | correlation | effectClass | reason | evidenceRefs`
  - must fail-close when:
    - `eventId` is combined with any additional primitive
    - `tick` appears without `worldId + sessionId`
    - any refinement appears without an anchor
    - `appId` appears as the sole selector primitive

- `worldEvolution.replays.read(selector)`
  - exact-match selectors:
    - a single replay evidence-reference primitive already projection-visible for the replay read-model family
  - filter-like selectors:
    - may use that replay evidence-reference primitive with optional replay-mode refinement when replay mode is projection-visible for the replay read-model family
    - otherwise must include at least one execution-context anchor already projection-visible for the replay read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include projection-visible replay-mode refinement
  - must fail-close when:
    - replay mode appears without a replay evidence-reference primitive or execution-context anchor
    - `eventId` or `tick` appears without a replay evidence-reference primitive or execution-context anchor
    - any selector primitive is not projection-visible for the replay read-model family

- `worldEvolution.checkpoints.read(selector)`
  - exact-match selectors:
    - `checkpointId`
    - a single checkpoint-reference primitive already projection-visible for the checkpoint read-model family
  - filter-like selectors:
    - may use `checkpointId` or a checkpoint-reference primitive with optional restore-status refinement when restore status is projection-visible
    - otherwise must include at least one execution-context anchor already projection-visible for the checkpoint read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include projection-visible restore-status refinement
  - must fail-close when:
    - restore status appears without `checkpointId`, checkpoint reference, or execution-context anchor
    - `eventId` or `tick` appears without `checkpointId`, checkpoint reference, or execution-context anchor
    - any selector primitive is not projection-visible for the checkpoint read-model family

- `worldEvolution.supervision.read(selector)`
  - exact-match selectors:
    - none admitted in this phase
  - filter-like selectors:
    - must include at least one execution-context anchor already projection-visible for the supervision read-model family, chosen from `worldId | sessionId | traceId`
    - may additionally include projection-visible execution-context refinements from `eventId | tick`
    - may additionally include `supervisionOutcome`
  - must fail-close when:
    - `supervisionOutcome` appears without an execution-context anchor
    - `eventId` or `tick` appears without an execution-context anchor
    - any selector primitive is not projection-visible for the supervision read-model family

- `worldEvolution.commitRequests.read(selector)`
  - exact-match selectors:
    - none admitted in this phase
  - filter-like selectors:
    - must include the adapter-envelope anchors `worldId + appId + sessionId`
    - may additionally include candidate-envelope refinements from `effectClass | scope | actorRefs | reason | evidenceRefs`
    - may additionally include the pair `schemaId + schemaVersion`
    - may additionally include projected sidecar refinements from `sourceEventIds | traceId | tick | causation | correlation` and projection-visible checkpoint or supervision references
  - must fail-close when:
    - any of `worldId | appId | sessionId` is missing
    - `schemaId` appears without `schemaVersion`
    - `schemaVersion` appears without `schemaId`
    - any sidecar refinement appears without the required adapter-envelope anchors
    - any selector primitive is not projection-visible for the commit-request read-model family

Global selector hardcuts:

- unknown selector primitives must fail-close
- duplicate selector primitives with conflicting values must fail-close
- mixing exact-match and filter-like forms for the same method must fail-close
- workflow DAG / task / node / output vocabulary must fail-close
- private handles or host-private tokens must fail-close

## S-RUNTIME-099 Shared Read-Result Matrix

Every stable selector-read method must use a shared outer result contract with the following fields:

- `selector`
- `matchMode`
- `matches`

`matchMode` is closed to `exact | filter`.
No stable selector-read result may add cursor, buffering, reconnect, pagination, session-lifecycle, or transport-owned fields.

`matches` may be empty only when:

- the selector is valid and complete
- the requested read-model family is projection-supported
- no admitted match exists for the selector

`matches` must not be used to hide missing required evidence, unsupported projection shape, or boundary denial.

Stable read-result matrix:

- `worldEvolution.executionEvents.read(selector)`
  - returns `WorldEvolutionExecutionEventReadResult`
  - `matches` contains `WorldEvolutionExecutionEventView[]`
  - each view is limited to the normalized event envelope projected by `S-RUNTIME-080` plus subordinate discriminated detail
  - every returned view remains Runtime-local execution evidence, not Realm/shared canonical truth

- `worldEvolution.replays.read(selector)`
  - returns `WorldEvolutionReplayReadResult`
  - `matches` contains `WorldEvolutionReplayView[]`
  - each view is limited to projection-visible replay mode / result / evidence-reference shapes admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local replay evidence, not canonical replay authority beyond recorded-replay truth

- `worldEvolution.checkpoints.read(selector)`
  - returns `WorldEvolutionCheckpointReadResult`
  - `matches` contains `WorldEvolutionCheckpointView[]`
  - each view is limited to projection-visible checkpoint identifier / reference / restore-status shapes admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local recovery evidence, not Realm state or Realm history truth

- `worldEvolution.supervision.read(selector)`
  - returns `WorldEvolutionSupervisionReadResult`
  - `matches` contains `WorldEvolutionSupervisionView[]`
  - each view is limited to projection-visible supervision outcomes and related projection-visible references admitted by `S-RUNTIME-081`
  - every returned view remains Runtime-local supervision evidence, not canonical audit truth or canonical shared-world truth

- `worldEvolution.commitRequests.read(selector)`
  - returns `WorldEvolutionCommitRequestReadResult`
  - `matches` contains `WorldEvolutionCommitRequestView[]`
  - each view is limited to adapter-envelope-compatible candidate or outcome fields admitted by `S-RUNTIME-082` plus projected sidecar references already admitted there
  - every returned view remains adapter-bound commit-request candidacy or adapter-visible outcome only, not canonical mutation success, canonical history append, or SDK write authority

## S-RUNTIME-100 Shared Read-Only Rejection Matrix

Stable selector-read methods must share one closed rejection category matrix:

- `INVALID_SELECTOR`
- `INCOMPLETE_SELECTOR`
- `MISSING_REQUIRED_EVIDENCE`
- `UNSUPPORTED_PROJECTION_SHAPE`
- `BOUNDARY_DENIED`

Rejection matrix:

- `INVALID_SELECTOR`
  - selector uses an unknown primitive
  - selector uses a forbidden primitive family
  - selector combines primitives in a forbidden exact-match or filter-like form

- `INCOMPLETE_SELECTOR`
  - selector omits a required anchor or required pair
  - selector is syntactically admitted but under-specified for the chosen method family

- `MISSING_REQUIRED_EVIDENCE`
  - selector is valid and complete, but required projection-visible evidence or reference is absent for evaluation

- `UNSUPPORTED_PROJECTION_SHAPE`
  - returned projection shape lacks required fields
  - returned projection shape contains unsupported enum or discriminator value
  - selector asks for a primitive that is not projection-visible in the chosen read-model family

- `BOUNDARY_DENIED`
  - the consumer is outside the admitted authority boundary for the requested selector-read method
  - the request would require private bypass, host-private state, or otherwise forbidden authority crossing

App-facing and mod-facing publication profiles must preserve the same rejection categories, same fail-close meaning, and same unknown-category behavior.
Neither path may:

- replace the closed category set with free-text-only rejection
- add app-only or mod-only selector-read rejection categories
- reinterpret rejection as empty success or hidden downgrade

## S-RUNTIME-101 Shared Semantic Parity And Publication Layering

`S-RUNTIME-097` through `S-RUNTIME-100` define one shared semantic selector-read method matrix.
That shared semantic matrix must be identical across app-facing SDK publication and mod-facing host-injected publication for:

- method-category names
- selector matrix
- read-result matrix
- read-only rejection matrix
- no-leak / no-widening / no-bypass hardcuts

Publication layering may differ only by access path and construction boundary.
It must not differ by semantic method meaning.

Therefore:

- app-facing publication profile is defined by `runtime-contract.md` (`S-RUNTIME-102`)
- mod-facing publication profile is defined by `mod-contract.md` (`S-MOD-015`)
- surface placement hardcut is defined by `surface-contract.md` (`S-SURFACE-013`)

No publication layer may use selector-read stable methods to smuggle in:

- observe or subscribe semantics
- session or lifecycle semantics
- effectful request semantics
- host concrete API semantics
- workflow substrate truth

## Fact Sources

- `spec/platform/kernel/architecture-contract.md` — `P-ARCH-024` through `P-ARCH-029`
- `world-evolution-engine-projection-contract.md` — `S-RUNTIME-079` through `S-RUNTIME-084`
- `runtime-contract.md` — `S-RUNTIME-091`, `S-RUNTIME-102`
- `runtime-route-contract.md` — `S-RUNTIME-074` through `S-RUNTIME-078`
- `surface-contract.md` — `S-SURFACE-001`, `S-SURFACE-004`, `S-SURFACE-013`
- `mod-contract.md` — `S-MOD-001`, `S-MOD-003`, `S-MOD-006`, `S-MOD-014`, `S-MOD-015`
