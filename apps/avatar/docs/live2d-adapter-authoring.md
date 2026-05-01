# Live2D Adapter Authoring Guide

This guide is for artists, riggers, and technical artists who want an existing
Live2D Cubism package to work well in Nimi Avatar without changing the original
model files. The adapter file describes how the model maps to Nimi Avatar's
current carrier behavior.

## What Nimi Avatar Accepts

A Live2D package can be used at one of four computed compatibility tiers:

| Tier | What it means |
| --- | --- |
| `unsupported` | The package or adapter violates required schema, license, model, or claimed-feature checks. It must not load as a successful Avatar carrier. |
| `render_only` | The package renders as a Live2D model in the Avatar carrier. No activity, expression, pose, lipsync, or hit-region behavior is promised. |
| `semantic_basic` | The adapter maps required companion activities and explicitly marks optional features as supported, unsupported, or not applicable. |
| `companion_complete` | The adapter maps the full current Live2D companion behavior expected by the active Avatar carrier. |

The tier is computed by Nimi Avatar. A package can request a tier, but the
validator only returns the highest tier proven by the package, adapter, license
posture, and carrier proof.

## Adapter File

Creator-authored packages should include:

```text
<model-pkg>/runtime/nimi/live2d-adapter.json
```

The file must use this identity:

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

Nimi Avatar can also use an explicitly selected external sidecar adapter for an
existing package. Exactly one adapter source is selected for a launch: embedded
creator file or external sidecar. Nimi Avatar never merges adapter files and
never silently prefers one source over the other.

## Minimum Shape

The adapter must include these top-level fields:

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
    "evidence": "Describe the model owner's reviewed distribution rights.",
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
      "disposition": { "status": "not_applicable", "reason": "Model has no pose3 file." }
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
    },
    "nas_fallback": {
      "default_idle_motion": "Idle",
      "missing_handler": "backend_default_with_diagnostic"
    }
  }
}
```

Every feature claim must be explicit. If a model does not support a feature,
mark it as `unsupported` or `not_applicable` with a reason. Do not leave gaps
for the loader to guess.

## Authoring Checklist

- The package has exactly one selected `*.model3.json`.
- The adapter `target_model.model_id` matches the resolved model id.
- `FileReferences.Moc` and declared textures are present and readable.
- The idle motion group exists.
- For `semantic_basic`, `neutral`, `greet`, `listening`, and `thinking` map to existing motion groups.
- Every expression id in the adapter exists in `FileReferences.Expressions`.
- Pose support is claimed only when a pose file is present.
- Lipsync support points to an available mouth-open parameter such as `ParamMouthOpenY`.
- Physics support is claimed only when the model physics file is present and valid.
- Hit-region aliases refer to declared model hit areas, or the adapter declares an alpha-mask fallback.
- License evidence is reviewed before the package or adapter is redistributed.

## License Posture

The adapter does not grant rights to redistribute the model. The model creator or
package operator must provide license evidence for any package or example asset
that is committed, shared, or shipped.

Use `fixture_use: "committable"` only when redistribution is allowed and the
license evidence is clear. Use `operator_local_only` for local investigation
assets that must not be committed or used as release evidence. Use `not_allowed`
when the asset cannot be used for Nimi Avatar validation.

## Validation Behavior

Nimi Avatar fails closed when claimed support cannot be proven. Typical
diagnostic codes include:

- `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID`
- `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH`
- `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED`
- `AVATAR_LIVE2D_COMPAT_MOTION_MISSING`
- `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING`
- `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE`
- `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING`
- `AVATAR_LIVE2D_COMPAT_PHYSICS_UNAVAILABLE`
- `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING`

A diagnostic is not a partial success. Unsupported or missing behavior must be
shown as unsupported, degraded, or not applicable before the package can make a
higher-tier claim.

## Delivery Notes

For creator-authored packages, place the adapter file under
`runtime/nimi/live2d-adapter.json` beside the model runtime files. Do not modify
third-party model files unless the model owner explicitly asks for a derivative
package.

For existing packages, an operator may keep the original package unchanged and
select an external sidecar adapter from the desktop configuration surface. Nimi
Avatar still validates the adapter and computes the tier before treating the
package as supported.
