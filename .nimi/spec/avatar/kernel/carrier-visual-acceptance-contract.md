# Carrier Visual Acceptance Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active acceptance boundary for current Live2D carrier proof
> **Sibling contracts**:
> - [Live2D render contract](live2d-render-contract.md)
> - [App shell contract](app-shell-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)
> - [Mock fixture contract](mock-fixture-contract.md)

---

## 0. Reading Guide

This contract defines what evidence may close Avatar app carrier visual proof.
It does not implement rendering behavior and does not widen the current Live2D
branch.

The current Live2D render contract proves model/resource loading,
command-state mutation, Cubism `model.update()`, and NAS continuous scheduling.
Carrier visual acceptance is the next proof layer: deterministic evidence that
the Avatar app carrier owns a canvas/WebGL draw path with visible non-placeholder
pixels for the admitted Live2D branch.

## 1. Evidence Classes

Avatar carrier visual evidence is classified as:

| Class | Meaning | Can close carrier visual proof |
| --- | --- | --- |
| real runtime path | Desktop-selected launch context + local Agent Center package + runtime IPC bridge + SDK driver + Avatar carrier | Yes |
| deterministic harness | Controlled Avatar app harness exercising the real carrier draw path with stable inputs | Yes, if it exercises the Avatar carrier canvas/WebGL path |
| fixture/mock path | Explicit `VITE_AVATAR_DRIVER=mock` or mock scenario data source | Regression evidence only |
| Desktop renderer evidence | Desktop chat Live2D renderer smoke or pixel evidence | No |
| closed-topic evidence | Historical 2026-04-20 / 2026-04-25 topic artifacts | No |

## 2. Required Visual Proof

Carrier visual proof must include current executable evidence for:

- a canvas or equivalent WebGL host owned by `apps/avatar`, not Desktop chat
- model load success through the Avatar app Live2D branch
- at least one frame where the carrier path produces non-placeholder visible
  pixels after model load
- resilience evidence for resize or host-bound changes when the implementation
  claims responsive surface behavior
- failure evidence showing missing/invalid model input does not render a
  placeholder success state

The proof may be automated through unit/integration tests, a deterministic
headless harness, or a Playwright/browser-style acceptance harness. Whichever
method is used must record enough artifact detail for later audit.

## 3. Forbidden Closure

The following evidence must not close Avatar carrier visual proof:

- Desktop chat Live2D pixel tests, even if they exercise Cubism WebGL
- static `<canvas>` existence without non-placeholder pixel evidence
- fixture-only scenario playback reported as the real runtime carrier path
- closed-topic demo screenshots, checklists, or worker results
- command-state-only tests that do not exercise draw/pixel output

## 4. Multi-Backend Visual Proof (Wave 0 admit)

> Source: topic `2026-04-30-avatar-vrm-backend-branch` design-10.

`recordCarrierVisualProof` helper is extended with a `modelKind: BackendKind`
input to support multi-backend visual evidence. Signature:

```ts
recordCarrierVisualProof(input: {
  modelKind: 'live2d' | 'vrm';
  // ... existing fields (canvas ref / sample grid / frame index / ...)
}): CarrierVisualProof;
```

Per-backend evidence rules:

| Aspect | Live2D | VRM |
| --- | --- | --- |
| `framesToWait` budget | up to 12 attempts (Cubism animation idle takes longer to stabilize) | 6 attempts (R3F renders deterministic in 1–2 frames) |
| Sample grid | 24 × 24 = 576 cells | 24 × 24 = 576 cells |
| Visible-pixel threshold | alpha > 0.5 in sample cell | alpha > 0.5 in sample cell |
| Evidence event detail | includes `model_kind: 'live2d'` | includes `model_kind: 'vrm'` |
| Failure recovery | up to 1 webglcontextlost retry within 1500ms | up to 1 webglcontextlost retry within 1500ms (per `vrm-backend-contract.md` §2.3) |

Both backends must produce the same evidence shape (`visiblePixels`,
`modelKind`, sampling result) so audit harnesses can run the same assertion
across backends.

`avatar.carrier.visual` evidence event detail is extended to carry
`model_kind`; existing fields remain stable.

## 5. Scope Boundary

This contract does not admit:

- Phase 2 voice output or lipsync (Wave 3 admitted; tracked separately)
- shared `PresentationTimeline`
- broad platform or SDK Event API behavior
- 3D / Lottie / robot backend visual proof beyond Live2D + VRM

Those branches require separate active authority before they can be used as
acceptance conditions.
