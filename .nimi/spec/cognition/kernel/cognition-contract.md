# Cognition Contract

> Owner Domain: `C-COG-*`

## C-COG-001 Standalone Cognition Authority Home

`nimi-cognition` is the authority home for standalone local cognition.

It owns:

- standalone cognition object model
- local cognition semantic boundary
- standalone cognition public surface
- local cognition mutation / retrieval / cleanup semantics
- local cognition prompt/context separation
- local cognition working-state semantics
- external routine boundary for standalone cognition

It does not own:

- runtime bank lifecycle truth
- runtime provider bridge truth
- runtime replication truth
- runtime canonical review truth
- runtime live agent lifecycle truth
- Realm shared-truth governance

## C-COG-002 Runtime Extraction And Upgrade Relation

`nimi-cognition` is extracted from runtime-local memory / knowledge capabilities and upgraded into a standalone cognition domain.

Fixed rules:

- cognition is not a runtime subchapter, helper package, or internal extraction detail
- cognition authority must remain independently specifiable without importing runtime ownership as a prerequisite
- overlap with runtime memory or runtime knowledge does not permit cognition capability downgrade
- where cognition covers capability already present in runtime memory / knowledge, the cognition contract must be at least equally explicit and fail-closed
- shared implementation heritage does not make runtime the continuing semantic owner of cognition

## C-COG-003 No Parallel Truth

The standalone cognition authority must live in `/.nimi/spec/cognition/kernel/**`.

Fixed rules:

- local reports, baseline proposals, and implementation code are not authority once cognition kernel rules are admitted here
- runtime kernel documents may reference cognition boundary rules, but they must not redefine cognition object ownership
- cognition implementation must align to this contract rather than reinterpreting the contract through package layout or test shape

## C-COG-004 Standalone Completion Standard

`nimi-cognition` is not admitted as an MVP, skeleton, or design probe.

Fixed rules:

- standalone cognition must target production-grade semantic closure
- pseudo-implemented surfaces, fake success payloads, placeholder cleanup semantics, and compatibility-shaped non-owners are not admitted
- a package or service surface is incomplete unless its mutation, retrieval, persistence, cleanup, and formatting semantics are all explicitly closed or explicitly out of scope
- “tests pass” is not completion evidence if the tested behavior is semantically weaker than admitted cognition rules
- cognition-local top-level completion may be covered when an independent standalone audit, matching behavior-level proof, and current cognition authority all agree that no owner-path semantic blocker remains
- cognition-local top-level completion does not imply repo-wide final closeout or parity with runtime's deeper overlapping service maturity

## C-COG-005 Top-Level Object Model

Standalone cognition is centered on the following first-order local artifact families:

- `agent_model_kernel`
- `world_model_kernel`
- `memory_substrate`
- `knowledge_projections`
- `skill_artifacts`
- `working_state`

Fixed rules:

- kernels are primary local model artifacts, not generic containers
- memory, knowledge, and skill remain distinct advisory families and must not collapse into kernel truth
- working state is a first-order local cognition family even when transient
- prompt serving, retrieval, cleanup, and routines must respect these family boundaries

## C-COG-006 Kernel Boundary

Kernel semantics are local-model semantics, not external truth governance.

Fixed rules:

- kernel scope contains exactly one local agent kernel and one local world kernel per cognition scope
- kernels begin at admitted `incoming_patch` mutation surface rather than upstream observation capture
- source observation, candidate generation, and external truth arbitration remain outside kernel ownership
- kernel rule state must keep independent anchor-binding, alignment, and lifecycle axes
- kernel mutation must remain fail-closed through the admitted `status / diff / merge / resolve / commit / log` surface

## C-COG-007 Memory Substrate Upgrade Requirement

`memory_substrate` is a standalone cognition family, not merely a weaker clone of runtime memory records.

Fixed rules:

- cognition memory must admit typed local record families with fail-closed payload validation
- overlapping retrieval capability must not silently degrade below runtime memory service strength by convenience or omission
- service-derived support, cleanup, or serving metadata must not be caller-owned persisted truth
- cognition memory may differ from runtime bank / replication / provider shapes, but its local serving semantics must be independently complete
- prompt or routine consumption of memory must rely on service-owned derived views rather than caller-forged metadata

## C-COG-008 Knowledge Projection Upgrade Requirement

`knowledge_projections` are a standalone cognition family, not merely runtime-local page storage under a different name.

Fixed rules:

- cognition knowledge must own projection semantics, lifecycle, retrieval surface, and local relation integrity
- cognition knowledge must not silently regress below runtime knowledge search / graph / ingest closure where overlapping capability is claimed
- same-family and cross-family references must remain explicit, typed, and fail-closed
- cognition knowledge may remain local-only, but local-only scope does not permit weakened semantics or fake graph ownership

## C-COG-009 Skill Artifact Boundary

`skill_artifacts` are service-grade advisory artifacts within cognition.

Fixed rules:

- skill artifacts remain weaker than kernels and knowledge projections in truth weight
- advisory status does not permit malformed bundles, fake selectors, unstable step order, or unowned refs
- skill storage, retrieval, lifecycle, and history must remain semantically closed if admitted on the public cognition surface
- skill must not be used as a backdoor for runtime execution-policy truth

## C-COG-010 Working State Boundary

`working_state` is transient cognition scaffolding.

Fixed rules:

- working state is not durable truth by default
- working state must not absorb runtime hook lifecycle, autonomy policy, control-plane state, or replication truth
- if working state is not persisted, that transient boundary must be explicit and testable
- if a future rule admits persistent working state, that persistence must be declared explicitly rather than smuggled in through a generic artifact store

## C-COG-011 Prompt Boundary

Prompt/context serving must preserve kernel primacy without rewriting cognition semantics.

Fixed rules:

- prompt serving must keep kernel context distinct from advisory context
- prompt serving must not promote advisory artifacts into kernel truth
- prompt serving must consume service-owned derived views where support or cleanup metadata is shown
- prompt serving must not read working state or external routine evidence unless a later rule explicitly admits those lanes

## C-COG-012 Refgraph And Cleanup Boundary

Standalone cognition cleanup must be explicit, reference-aware, and archive-first where admitted.

Fixed rules:

- cleanup and retrieval support reasoning must use an explicit local refgraph authority
- broken references, incoming support, outgoing dependency health, and remove blockers must remain observable
- cleanup must not rely on fake drift markers or pseudo-timeout forgetting when such semantics are not admitted
- refgraph ownership is local static relation truth for cognition; it does not imply runtime replication, alias, or provider ranking ownership

## C-COG-013 External Routine Boundary

Standalone cognition routines are external workers acting on cognition-owned artifact families.

Fixed rules:

- routines are not core cognition commands
- routines must not directly mutate kernels
- routine execution must use a typed non-kernel access contract
- if cognition admits a routine worker path, that path is the authoritative external execution entry rather than a façade-owned pseudo-service

## C-COG-014 Digest Boundary

`digest` is the first admitted cognition routine.

Fixed rules:

- digest acts on memory, knowledge, and skill families only
- digest cleanup proposals and transitions must be explainable through lifecycle and refgraph truth
- archive/remove semantics must remain explicit, observable, and distinct from explicit destructive delete
- digest must not be reduced to a wall-clock stale-item sweeper unless a later rule explicitly admits such forgetting semantics

## C-COG-015 Public Surface Completeness

If a standalone cognition surface is public, it must be semantically complete within its admitted role.

Fixed rules:

- public cognition services must expose only owner-true surfaces
- compatibility wrappers that preserve known-wrong ownership are not admitted as steady-state public contract
- optional capability claims must not appear in the contract unless real wiring, semantics, and failure behavior exist
- typed API shape alone does not count as service-level completion

## C-COG-016 Runtime Bridge Boundary

Runtime may consume or bridge standalone cognition, but runtime does not own cognition semantics.

Fixed rules:

- runtime integration must be expressed as bridge / adapter / consumer behavior
- runtime contracts may constrain how runtime-owned services interact with cognition, but not redefine cognition authority
- cognition must remain viable as a standalone project even when runtime is not present
- any extracted runtime implementation that remains only valid with runtime-owned semantics is not admitted as completed cognition

## C-COG-017 Failure Model

Standalone cognition must fail close on semantic violations.

Fixed rules:

- malformed payloads, illegal refs, illegal lifecycle transitions, and illegal scope crossings must be rejected explicitly
- pseudo-success, best-effort mutation, or silent downgrade are not admitted
- retrieval surfaces must keep degraded capability explicit; they must not quietly pretend parity they do not have
- cleanup and formatting paths must not invent service-owned metadata without explicit derivation logic

## C-COG-018 Explicit Deferrals

The following remain outside the admitted standalone cognition baseline until later rules explicitly admit them:

- runtime provider bridge ownership
- runtime replication ownership
- runtime canonical review ownership
- Realm shared-truth governance
- app-facing or SDK-facing cognition transport contracts
- any requirement that standalone cognition reuse runtime bank scope truth as its own semantic home
