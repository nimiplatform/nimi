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
| real runtime path | Desktop-selected minimal launch context + Runtime-validated agent/session projection + selected local Avatar asset + local materialization resolver + runtime IPC bridge + SDK driver + Avatar carrier | Yes |
| deterministic harness | Controlled Avatar app harness exercising the real carrier draw path with stable inputs | Yes, if it exercises the Avatar carrier canvas/WebGL path |
| fixture/mock path | Explicit `VITE_AVATAR_DRIVER=mock` or mock scenario data source | Regression evidence only |
| Desktop renderer evidence | Desktop chat Live2D renderer smoke or pixel evidence | No |
| historical process evidence | Historical process artifacts | No |

## 2. Required Visual Proof

Carrier visual proof must include current executable evidence for:

- a canvas or equivalent WebGL host owned by `apps/avatar`, not Desktop chat
- model load success through the Avatar app Live2D branch
- at least one frame where the carrier path produces non-placeholder visible
  pixels after model load
- for real runtime path closure, a human-visible image artifact written by the
  Avatar app process and referenced from the same `avatar.carrier.visual`
  evidence record (`human_visible_artifact_path`, `artifact_mime_type`,
  `artifact_byte_length`)
- resilience evidence for resize or host-bound changes when the implementation
  claims responsive surface behavior
- failure evidence showing missing/invalid model input does not render a
  placeholder success state

The proof may be automated through unit/integration tests, a deterministic
headless harness, or a Playwright/browser-style acceptance harness. Whichever
method is used must record enough artifact detail for later audit.

## 2.1 Live2D Preview And Readiness Artifact

Live2D preview/readiness artifacts are Avatar-owned carrier evidence. They
MUST be produced through the Avatar app Live2D carrier visual host backed by the
official Cubism SDK path, or through a deterministic harness over that same
host. They MUST NOT be produced by Desktop chat renderers, Pixi preview
helpers, static screenshots, or file-structure validators.

An admitted Live2D preview/readiness evidence record carries:

- `readiness_artifact_kind: avatar_live2d_official_sdk_preview`
- `evidence_ref`
- `preview_artifact_ref`
- `model_kind: live2d`
- `model_id`
- visible-pixel stats
- drawable stats
- texture binding stats
- canvas dimensions
- human-visible artifact metadata when available

The preview artifact is local evidence only. It does not redistribute source
model files, does not become Desktop configuration truth, and does not widen
Avatar launch payload. Desktop and Runtime debug surfaces may consume the
bounded refs/status, but cannot close Avatar carrier proof from Desktop-rendered
pixels.

## 3. Forbidden Closure

The following evidence must not close Avatar carrier visual proof:

- Desktop chat Live2D pixel tests, even if they exercise Cubism WebGL
- static `<canvas>` existence without non-placeholder pixel evidence
- fixture-only scenario playback reported as the real runtime carrier path
- historical demo screenshots, checklists, or worker results
- command-state-only tests that do not exercise draw/pixel output

## 4. Multi-Backend Visual Proof

`recordCarrierVisualProof` helper is extended with a `modelKind: BackendKind`
input to support multi-backend visual evidence. Signature:

```ts
recordCarrierVisualProof(input: {
  modelKind: 'live2d' | 'vrm' | 'nimi2d';
  // ... existing fields (canvas ref / sample grid / frame index / ...)
}): CarrierVisualProof;
```

Per-backend evidence rules:

| Aspect | Live2D | VRM | Nimi2D |
| --- | --- | --- | --- |
| `framesToWait` budget | up to 12 attempts (Cubism animation idle takes longer to stabilize) | 6 attempts (R3F renders deterministic in 1–2 frames) | deterministic offscreen layer composition over the admitted Nimi2D render plan |
| Sample grid | 24 × 24 = 576 cells | 24 × 24 = 576 cells | 24 × 24 = 576 cells when admitted |
| Visible-pixel threshold | alpha > 0.5 in sample cell | alpha > 0.5 in sample cell | default outfit alpha > 0.5; base-body-only pixels are forbidden success |
| Evidence event detail | includes `model_kind: 'live2d'` | includes `model_kind: 'vrm'` | includes `model_kind: 'nimi2d'` and package capability refs |
| Failure recovery | up to 1 webglcontextlost retry within 1500ms | up to 1 webglcontextlost retry within 1500ms (per `vrm-backend-contract.md` §2.3) | up to 1 renderer context retry within 1500ms after renderer admission |

All render-admitted backends must produce the same evidence shape (`visiblePixels`,
`modelKind`, sampling result) so audit harnesses can run the same assertion
across backends.

Nimi2D is admitted as a backend branch with PixiJS renderer foundation proof,
deterministic offscreen pixel proof over the same render plan/layer assets, and
a bounded mounted Pixi canvas capture foundation. The admitted Nimi2D pixel
proof composes the package's ordered RGBA layers using package `render_layers`
placement/bounds geometry into an Avatar-owned offscreen sampler and verifies
visible default outfit pixels. Mounted Pixi canvas capture may write a
human-visible artifact only when the mounted canvas is readable and has
non-zero visible pixels. Capture failure or blank frames must record visual
error evidence and cannot count as success.
It must not count a base-body-only frame as valid. The mounted capture
foundation is still not release-grade mounted-surface acceptance.

This deterministic proof does not replace real launch recording evidence,
human-visible release artifacts, or Nimi2D Generation Bench go/no-go.

`avatar.carrier.visual` evidence event detail is extended to carry
`model_kind`; existing fields remain stable.

## 5. Scope Boundary

This contract does not admit:

- voice output or lipsync behavior (owned by voice/lipsync authority and tracked separately)
- shared `PresentationTimeline`
- broad platform or SDK Event API behavior
- 3D / Lottie / robot backend visual proof beyond Live2D + VRM + admitted
  Nimi2D Pixi renderer foundation branch

Those branches require separate active authority before they can be used as
acceptance conditions.
