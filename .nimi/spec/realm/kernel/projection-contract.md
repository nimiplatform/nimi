---
id: SPEC-REALM-KERNEL-PROJECTION-001
title: Realm Projection Kernel Contract
status: active
owner: "@team"
updated: 2026-04-21
---

# Projection Contract

> Domain: projection
> Rule family: R

## Scope

This contract defines the canonical `truth -> projection` seam for `nimi-realm`.

Projection is a derived consumption layer. It is not semantic truth, not app-local
view glue, and not ad hoc prompt assembly.

Until a dedicated runtime-mounted authority is admitted under `/.nimi/spec/**`,
this contract remains the canonical owner of `ProjectionInput`,
`ProjectionRequest`, `ProjectionResult`, and `ProjectionTraceRequirement`
semantics. Runtime implementations may consume these objects, but must not
silently redefine them.

## R-PROJ-001

Projection must be derived from canonical truth and explicit allowed state visibility.
Projection output is never truth by default and must not masquerade as a truth write.

## R-PROJ-002

Any authoritative projection path must consume explicit projection inputs anchored
to world truth, agent truth, relation truth, permitted world-state visibility, and
release identity when applicable. Consumers must not reconstruct canonical inputs
from lorebook text, browse summaries, or app-local caches.

## R-PROJ-003

Authoritative projection requests must be explicit and replayable. At minimum they
must identify the world scope, the agent scope, the consumer surface, the governing
release or truth anchor, and the constrained context envelope used for selection.

## R-PROJ-004

For identical projection inputs, consumer surface, release anchor, and constrained
context envelope, authoritative projection must be deterministic and checksumable.
Model/runtime execution may remain probabilistic after projection, but projection
itself must not be nondeterministic.

## R-PROJ-005

Runtime and app consumers must not bypass the projection seam by directly assembling
truth text into prompt payloads. PromptTrace and other execution diagnostics may
consume projection outputs, but they do not replace the projection contract itself.

## R-PROJ-006

Compat and read surfaces such as worldview, lorebooks, public browse aggregates,
and future card-shaped exports are projection surfaces only. They must not become
the canonical semantic source or redefine upstream truth/package structure.

## R-PROJ-007

Authoritative projection must produce traceable results. At minimum, the projection
trace must identify selected inputs, suppressed inputs, governing release/truth
anchor, and resolution outcomes needed to explain why a consumer received a given
projection result.

## R-PROJ-008

Until a dedicated runtime-mounted projection spec is admitted, Realm projection
authority owns the semantic contract for `ProjectionInput`,
`ProjectionRequest`, `ProjectionResult`, and `ProjectionTraceRequirement`.
Downstream runtime or app implementations are consumers of this contract and
must not fork or narrow these object semantics ad hoc.
