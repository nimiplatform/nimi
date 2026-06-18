# Nimi2D Live Action Bench Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active bounded bench for the admitted Nimi2D
>   `pixi_renderer_foundation` path.
> **Sibling contracts**:
> - [Nimi2D backend contract](nimi2d-backend-contract.md)
> - [Backend branch contract](backend-branch-contract.md)
> - [Carrier visual acceptance contract](carrier-visual-acceptance-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)

---

## 0. Reading Guide

This contract defines the first Avatar-owned Nimi2D Live Action Bench. It is a
value-ceiling probe over a real Avatar `kind: 'nimi2d'` backend path. It is not
a Nimi2D Generation Bench and does not admit default generated asset viability.

Canonical result posture:

```ts
{
  verdict: 'pass_minimal_tier1' | 'fail',
  scope: 'pixi_renderer_foundation',
  closesGenerationBench: false,
  closesCarrierVisualAcceptance: false
}
```

## 1. Authority Boundary

Avatar owns this bench because it measures runtime embodiment behavior:

- backend branch creation
- backend-local scheduler/composer behavior
- projection-to-action response
- audio consumer to mouth lane response
- interrupt/reset recovery
- rendered surface observation

The pure scorer may live in `@nimiplatform/nimi2d/runtime` so other Nimi hosts
can reuse the same deterministic algorithm. That package location does not move
bench authority out of Avatar; the admitted metrics, pass/fail posture, and
runtime boundary remain defined here.

Nimi2D owns only package generation and package admission evidence. Passing this
bench must not be promoted into:

- Nimi2D Generation Bench `go`
- default RealmPersona Nimi2D generation admission
- mounted-surface release visual acceptance
- mesh/deformer renderer admission beyond PixiJS sprite foundation
- true viseme support

## 2. Required Runtime Path

The bench must exercise a real Avatar Nimi2D backend path:

1. Load a valid `Nimi2D` package manifest.
2. Load a valid Avatar Nimi2D capability profile.
3. Create `BackendBranch { kind: 'nimi2d' }`.
4. Mount the branch-owned surface.
5. Observe rendered layer refs from the real surface.
6. Apply only `BackendProjection` methods and `BackendAudioConsumer` methods.
7. Let the carrier frame loop advance the renderer-agnostic composer scheduler.

Fixture-only scoring that does not create the backend and surface is not a
passing bench. It may be used only as a negative/control path.

## 3. Required Measurements

The bounded tier-1 bench measures:

| Metric | Meaning | Required for `pass_minimal_tier1` |
| --- | --- | --- |
| default outfit visibility | selected outfit layer refs are present in the rendered composite | yes |
| base composite presence | base body visual layers are present only together with default outfit | yes |
| projection latency | activity/expression/motion update observed after projection call | `maxProjectionLatencyMs <= 50` |
| state legibility | activity, expression, motion, mouth, and reset states are observable | `1.0` |
| scheduler/blend stability | observed frames have finite bounded scheduler state and no missing render layers | `1.0` |
| jaw alignment | tier-1 amplitude opens mouth and interrupt/silent closes it | `1.0` |
| interrupt recovery | reset/silent state observed after interrupt | `<= 50ms` |
| gaze behavior | tracked only; not admitted in v1 | `unsupported_v1` |

## 4. Fail-Closed Rules

The bench fails if any of the following occurs:

- backend kind is not `nimi2d`
- default outfit layer is absent
- observed render layers are empty
- a base-body-only frame is counted as success
- projection state does not become observable
- mouth remains silent during synthetic amplitude
- mouth remains open after interrupt/silent
- projection or interrupt response exceeds the admitted budget
- raw APML or LLM numeric frame control is introduced
- the result claims to close Generation Bench or mounted-surface release visual
  acceptance

## 5. Not Admitted

This bench does not admit:

- mesh/deformer renderer behavior beyond PixiJS sprite foundation
- mounted-surface release visual evidence
- gaze controller
- tier-2 true viseme
- tier-3 semantic full-body action
- release-grade gesture queue or route-specific motion transform quality
- default generated Nimi2D asset viability
- product UI / Realm Persona Studio workflow

## 6. Evolution

- Release visual acceptance must add mounted-surface sampling or recording,
  human-visible artifact evidence, and launch/degraded path coverage. Offscreen
  default-outfit pixel proof is necessary but not sufficient.
- Tier-2 bench must add true viseme input and scoring.
- Gaze support requires a separate runtime lane admission and capability
  profile binding.
