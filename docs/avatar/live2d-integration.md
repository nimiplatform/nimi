# Live2D Integration

> Status: Running today. Live2D is the shipped backend branch; Cubism
> SDK for Web is the official integration path.

Live2D is the active rendering backend for Avatar. Integration is via
the official Cubism SDK for Web, with the parameter / motion /
expression / physics surface exposed through the host-agnostic
projection layer plus a `Live2DBackendExtension` escape hatch for
parameter-id direct writes.

## SDK Boundary

| Concern | Implementation |
| --- | --- |
| SDK | Cubism SDK for Web (official) |
| Renderer | WebGL canvas owned by `apps/avatar` |
| Model loading | `model3.json` + motion / expression / physics / pose / texture assets |
| Per-frame update | `model.update()` driven by NAS continuous scheduler |
| Audio bridge | `wLipSync` pipeline writes `ParamMouthOpenY` (+ optional `ParamMouthForm` per asset tier) |
| Default behaviors | Cubism breath / blink / lipsync; NAS handlers may override per the contract |

The Live2D branch is `kind: 'live2d'` in the closed `BackendKind`
union. It implements `BackendBranch`; carrier and projection consume
it through that interface, not by reaching into Cubism directly.

## Model Loading

The Avatar app loads a Live2D model package by:

1. Resolving the package descriptor through the admitted resolver.
2. Loading `model3.json` and its declared assets (motions,
   expressions, physics, pose, textures, hit areas).
3. Running compatibility validation against
   `live2d-asset-compatibility-contract.md` and computing the asset
   tier.
4. Reporting `embodiment_bounds` (model alpha bounding box) and
   `BackendNominalBounds` to projection so the shell can size the
   window.

A model that fails compatibility validation does not load as success.
Missing required parameters fail closed; missing optional parameters
downgrade the asset tier.

## Asset Compatibility Tiers

| Tier | Meaning | Product claim |
| --- | --- | --- |
| `unsupported` | Layout / license / schema / claimed-feature check failed | Must not load as success |
| `render_only` | Cubism renders the model; no semantic activity / expression / pose / lipsync support promised | "Renders as a Live2D model only" |
| `semantic_basic` | Required basic companion semantics mapped; optional features explicitly dispositioned | "Works as a basic companion with bounded degraded features" |
| `companion_complete` | Full current activity set + expression / pose / lipsync / hit region + optional physics | "Complete current Live2D companion behavior for the active Avatar carrier" |

Tier requirements live in
`.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml`.

## Parameter API

Backend-neutral parameter access goes through the projection API
(`ctx.params`). Direct parameter-id writes — the kind every Live2D
author eventually wants — go through `Live2DBackendExtension`:

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

Direct writes are explicit, type-narrowed, and tied to the package
declaring the dependency.

## Lipsync Pipeline (wLipSync)

| Stage | Owner | Surface |
| --- | --- | --- |
| Voice generation | runtime | `runtime.agent.voice.*` events |
| Audio bytes | runtime | `runtime.artifacts.readBytes` |
| `wLipSync` analysis | Avatar (Live2D branch) | `audio-pipeline.ts` |
| Frame batches | Avatar | `lipsync_frame_batch` |
| Parameter write | Live2D backend | `ParamMouthOpenY` (+ optional `ParamMouthForm` per tier) |

Lipsync is the most cross-domain choreography path in the platform.
It crosses runtime → SDK queue → Avatar projection → Live2D parameter
write, all through admitted seams.

## NAS Continuous Scheduling

NAS continuous handlers (e.g., `breathe.js`, `eye_tracker.js`) run
per the Live2D `model.update()` schedule. Default Cubism behaviors
(breath, blink, lipsync) compose with NAS overrides per the override
boundary in the render contract — overrides do not silently kill
defaults; they replace them per declared scope.

## Reader Scenario: A Live2D Package Loads at the Right Tier

1. **Author packages.** Their `model3.json` plus motions, expressions,
   physics, pose, hit areas. They publish a manifest claiming
   `companion_complete`.
2. **Avatar validates.** The validator computes the highest tier
   actually proven. If a required pose is missing, the manifest's
   claim is downgraded.
3. **Result.** The validator returns `semantic_basic` with explicit
   diagnostic codes naming the missing pose. The package loads at the
   proven tier; product claim adjusts.

The validator does not silently fix the manifest. It reports the truth
of what the package actually supports.

## Reader Scenario: A Handler Drives a Live2D-Specific Effect

1. **Author handler.** `mychar/runtime/nimi/event/onSurprise.js`. The
   author wants to drive `ParamMouthForm` directly for a stylized
   reaction.
2. **Declare requirement.** `requires: ['live2d-extension']`.
3. **Type narrow.** `if (ctx.backend.kind !== 'live2d') return;`
4. **Direct write.** `ctx.live2dExtension.setParameter(...)`.
5. **Behavior.** On Live2D, the parametric effect plays. On a future
   VRM mount of the same model character, the handler skips because
   the requirement is unmet — no silent fallback, no crash.

The escape hatch is admitted. The discipline is in the type narrow.

## What Live2D Integration Does Not Do

- It does not redefine activity / emotion / posture truth — that's
  runtime.
- It does not own embodiment projection semantics — that's
  `embodiment-projection-contract.md`.
- It does not replace declared default Cubism behaviors silently —
  overrides are per-scope, per the render contract.
- Desktop chat's separate Live2D renderer cannot stand in as proof
  for Avatar carrier acceptance — see
  [Visual Acceptance](/avatar/visual-acceptance.md).

## Source Basis

- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-asset-compatibility-contract.md)
- [`.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-compatibility-tiers.yaml)
- [`.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-adapter-manifest.schema.yaml)
- [`.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/tables/live2d-adapter-diagnostics.yaml)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
