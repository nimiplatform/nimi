# Live2D Integration

Live2D is one of Avatar's rendering backends. It uses the
official Cubism SDK for Web, but package behavior is not inferred from
Cubism files alone. Avatar validates the package, computes the proven
compatibility tier, and then exposes the model through the shared
embodiment surface.

This page also covers Live2D adapter manifest authoring. The adapter is
the package author's way to describe how an existing Cubism model maps
to Avatar activity, expression, lipsync, physics, pose, and hit-region
behavior without rewriting the original model files.

## SDK Boundary

| Concern | Implementation |
| --- | --- |
| SDK | Cubism SDK for Web |
| Renderer | WebGL canvas owned by `apps/avatar` |
| Model entry | `model3.json` plus declared motions, expressions, physics, pose, textures, and hit areas |
| Per-frame update | Cubism `model.update()` plus Avatar backend scheduling |
| Audio bridge | `wLipSync` drives `ParamMouthOpenY` and optional mouth-form parameters |
| Package semantics | Adapter manifest plus compatibility validation |

The Live2D backend is `kind: 'live2d'` in Avatar's closed backend
union. Carrier code and NAS handlers consume it through the backend
interface. They do not reach into Cubism internals directly.

## Model Loading

Avatar loads a Live2D package in four steps:

1. Resolve the selected local Avatar asset through the Avatar package
   resolver.
2. Load the selected `model3.json` and every asset it declares.
3. Validate compatibility, adapter claims, license posture, and
   package evidence.
4. Report model bounds and backend nominal bounds so the transparent
   desktop shell can size the window around the visible body.

A package that fails validation is not treated as a successful Avatar
carrier. Missing required behavior fails closed. Missing optional
behavior lowers the compatibility tier or records an explicit
unsupported disposition.

## Compatibility Tiers

| Tier | Meaning |
| --- | --- |
| `unsupported` | Required schema, license, model, or claimed-feature validation failed. |
| `render_only` | The Cubism model renders, but no activity, expression, pose, lipsync, or hit-region behavior is promised. |
| `semantic_basic` | Required companion activities are mapped, and optional features have explicit dispositions. |
| `companion_complete` | The package proves the current full companion behavior for the active Avatar carrier. |

The package may request a tier, but Avatar returns only the highest tier
that the package and adapter prove.

## Adapter Manifest Authoring

A creator-authored Live2D package may include an embedded adapter at:

```text
<model-package>/runtime/nimi/live2d-adapter.json
```

Desktop can also select an external sidecar adapter for an existing
package. A launch uses exactly one adapter source: embedded adapter or
selected sidecar. Avatar does not merge adapters and does not silently
prefer one source over the other.

Every adapter starts with this identity:

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

The useful fields are:

| Field | Purpose |
| --- | --- |
| `adapter_id` | Stable identifier for the adapter file. |
| `target_model` | The intended model id and `model3.json` entry. |
| `license` | Redistribution and fixture-use posture for the package. |
| `compatibility.requested_tier` | The tier the author is asking Avatar to evaluate. |
| `semantics.motions` | Motion groups for idle and companion activities. |
| `semantics.expressions` | Mapping from Avatar expression names to Cubism expression ids. |
| `semantics.poses` | Pose support or an explicit not-applicable reason. |
| `semantics.lipsync` | Mouth-open parameter used by the lipsync bridge. |
| `semantics.physics` | Whether model physics is available and supported. |
| `semantics.hit_regions` | Hit-area aliases and optional alpha-mask fallback. |

Feature claims must be explicit. If a model does not support a feature,
mark it as `unsupported` or `not_applicable` and include the reason.
Leaving a gap for the loader to guess weakens the package and usually
lowers the computed tier.

## Minimum Adapter Shape

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1,
  "adapter_id": "ren-live2d-adapter",
  "target_model": {
    "model_id": "ren",
    "model3": "ren.model3.json"
  },
  "license": {
    "redistribution": "allowed",
    "evidence": "Model owner reviewed redistribution rights.",
    "fixture_use": "committable"
  },
  "compatibility": {
    "requested_tier": "semantic_basic"
  },
  "semantics": {
    "motions": {
      "idle": { "group": "Idle" },
      "activities": {
        "neutral": { "group": "RenNeutral" },
        "greet": { "group": "RenGreet" },
        "listening": { "group": "RenListening" },
        "thinking": { "group": "RenThinking" }
      },
      "missing_activity": "diagnostic_no_success"
    },
    "expressions": {
      "map": { "happy": "smile" },
      "disposition": { "status": "supported" }
    },
    "poses": {
      "map": {},
      "disposition": {
        "status": "not_applicable",
        "reason": "Model has no pose3 file."
      }
    },
    "lipsync": {
      "mouth_open_y_parameter": "ParamMouthOpenY",
      "disposition": { "status": "supported" }
    },
    "physics": {
      "mode": "model_physics",
      "disposition": { "status": "supported" }
    },
    "hit_regions": {
      "map": {
        "head": ["head"],
        "body": ["body"]
      },
      "fallback": "alpha_mask_only",
      "disposition": { "status": "supported" }
    }
  }
}
```

## Authoring Checklist

- The package has exactly one selected `*.model3.json`.
- `target_model.model_id` matches the resolved package model id.
- `FileReferences.Moc` and every declared texture are present.
- The idle motion group exists.
- `neutral`, `greet`, `listening`, and `thinking` map to existing
  motion groups when requesting `semantic_basic`.
- Every expression id in the adapter exists in
  `FileReferences.Expressions`.
- Pose support is claimed only when the package contains a pose file.
- Lipsync points to an available mouth-open parameter such as
  `ParamMouthOpenY`.
- Physics support is claimed only when the model physics file exists
  and loads cleanly.
- Hit-region aliases refer to declared model hit areas, or the adapter
  declares an alpha-mask fallback.
- License evidence is reviewed before the package or adapter is
  shared, committed, or shipped.

## Diagnostics

Adapter diagnostics are typed. Common examples include:

| Code | Typical meaning |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | The adapter JSON does not match the schema. |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | The adapter targets a different model. |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | License posture is missing or insufficient. |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | A claimed motion group does not exist. |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | A claimed expression id does not exist. |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | The mouth parameter is not available. |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | A claimed hit area cannot be resolved. |

A diagnostic is not partial success. It tells the author which claim
must be fixed, lowered, or marked unsupported.

## NAS Parameter Access

Backend-neutral parameter access goes through the NAS context. Direct
Live2D parameter writes use `Live2DBackendExtension` after type
narrowing:

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

The direct write path is for backend-specific effects. Portable
handlers should prefer the host-agnostic NAS surface.

## Reader Scenario: A Package Loads At The Right Tier

An author imports a Live2D package and attaches an adapter requesting
`companion_complete`.

1. Avatar validates the package and adapter.
2. The model renders, but the adapter claims a pose file that is not
   present.
3. Avatar reports the missing pose diagnostic and returns the highest
   proven tier.
4. The package can still load at the lower proven tier if the remaining
   required behavior is valid.

The product surface shows what the package actually supports. It does
not silently upgrade unsupported behavior.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-compatibility-tiers.yaml)
- [`config/avatar-live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-manifest.schema.yaml)
- [`config/avatar-live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-diagnostics.yaml)
