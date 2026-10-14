# Live2D Integration

Live2D serves as a primary rendering backend for Nimi Avatar. Powered by the official Cubism SDK for Web, Avatar does not guess package capabilities from scattered Cubism files alone. Instead, it systematically validates package assets, computes the **proven compatibility tier**, and presents the character through a shared, cross-platform embodiment surface.

This guide also explains how to author the Live2D Adapter Manifest. The adapter manifest enables creators to map an existing Cubism model to Avatar activities, expressions, lipsync channels, physics simulations, postures, and hit-test regions without altering the original model assets.

## SDK and Renderer Boundaries

| Concern | Implementation Component |
| --- | --- |
| Underlying SDK | Official Cubism SDK for Web |
| Canvas Renderer | WebGL Canvas managed within `apps/avatar` |
| Model Entrypoint | `model3.json`, along with declared motions, expressions, physics, textures, and hit areas |
| Frame Update Cycle | Cubism `model.update()` coordinated with Avatar frame scheduling |
| Audio Lipsync Bridge | `wLipSync` driving `ParamMouthOpenY` and optional mouth-form parameters |
| Package Metadata | Verified adapter manifest and compatibility tier evaluation |

Live2D operates under the closed backend discriminator `kind: 'live2d'`. The Avatar carrier translation layer consumes the neutral embodiment interface, meaning creator scripts never directly access Cubism internal classes or Live2D parameter extensions.

## Asset Ingestion Pipeline

Avatar processes a Live2D package through four deterministic steps:

1. **Resolution**: Locate and verify local asset paths using the Avatar package resolver.
2. **Resource loading**: Parse the designated `model3.json` and load all referenced Moc bytecode, textures, and motion files.
3. **Compatibility evaluation**: Validate the adapter manifest, license metadata, and asset signatures.
4. **Window bounds calculation**: Calculate nominal physics bounds and mesh extents so the transparent desktop window neatly fits the character's visible silhouette.

Packages failing schema or licensing validation are rejected immediately. Missing essential files triggers fail-closed isolation, whereas missing optional parameters or expressions lowers the computed compatibility tier while emitting actionable diagnostic traces.

## Compatibility Tiers

| Compatibility Tier | Description & System Posture |
| --- | --- |
| `unsupported` | Validation failed: missing core schemas, invalid licenses, or corrupted model files |
| `render_only` | Basic rendering: character renders visually, but lacks promised motions, expressions, or lipsync |
| `semantic_basic` | Baseline companion: essential companion activities (`neutral`, `greet`, `listening`, `thinking`) are mapped |
| `companion_complete` | Full companion experience: verified support for all advanced Avatar desktop companion interactions |

A package may declare a requested tier in its manifest, but Avatar only grants the highest tier verified by empirical validation.

## Adapter Manifest Authoring

Creators can embed an adapter manifest directly within the model package:

```text
<model-package>/runtime/nimi/live2d-adapter.json
```

Alternatively, desktop launchers can configure an external sidecar adapter. The system enforces a single-source-of-truth policy: embedded and sidecar adapters are never merged or blended.

The manifest begins with standard headers:

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

### Key Field Reference

| Field | Purpose & Usage |
| --- | --- |
| `adapter_id` | Stable unique identifier for the adapter file |
| `target_model` | Target model ID and relative path to `model3.json` |
| `license` | Redistribution rights and test fixture terms |
| `compatibility.requested_tier` | Author's requested evaluation tier |
| `semantics.motions` | Maps general activities (`idle`, `greet`, `thinking`) to Cubism motion groups |
| `semantics.expressions` | Maps standardized Avatar expression names to Cubism expression IDs |
| `semantics.lipsync` | Designates the mouth opening parameter for audio lipsync |
| `semantics.physics` | Configures model physics simulations |
| `semantics.hit_regions` | Maps user click aliases (`head`, `body`) to internal model hit areas |

Feature declarations must be unambiguous: if a capability is missing from the model, mark it explicitly as `unsupported` or `not_applicable` with an explanation, rather than leaving fields empty for loaders to guess.

## Minimum Adapter Example

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

- [ ] Exactly one `*.model3.json` file resides in the root.
- [ ] `target_model.model_id` precisely matches the resolved model ID.
- [ ] `FileReferences.Moc` and all referenced texture assets exist.
- [ ] A looping `idle` motion group is configured.
- [ ] When requesting `semantic_basic`, `neutral`, `greet`, `listening`, and `thinking` map to valid motion groups.
- [ ] All mapped expression IDs exist within `FileReferences.Expressions`.
- [ ] Lipsync parameters point to an active opening parameter (e.g. `ParamMouthOpenY`).
- [ ] Hit region aliases map to declared model hit areas or specify an alpha-mask fallback.
- [ ] Licensing terms are verified prior to distribution.

## Diagnostic Codes

| Diagnostic Code | Underlying Cause & Resolution |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | Adapter JSON failed schema validation |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | Adapter target model does not match resolved model |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | Missing redistribution rights or license metadata |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | Declared motion group cannot be found in model definitions |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | Declared expression ID missing from expression files |
| `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE` | Supported pose mapping claimed but FileReferences.Pose missing or unusable |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | Specified mouth-opening parameter missing in model |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | Declared hit region cannot be resolved |

Diagnostics clearly communicate what needs resolution; Avatar avoids pretending partial failures are complete successes.

## Typical Scenario: Diagnostic and Resolution

When validating a Live2D package claiming pose support:

1. **Inspection**: Avatar evaluates the model package and adapter manifest against declared capability requirements.
2. **Identify defect**: A supported pose mapping is declared, but `FileReferences.Pose` is absent or unusable.
3. **Diagnostic feedback**: Emits typed diagnostic `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE` and marks the tier as unsupported rather than silently masking the error.
4. **Resolution**: The creator either removes the unsupported pose declaration or adds the missing pose asset and re-validates the package.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-live2d-compatibility-tiers.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-compatibility-tiers.yaml)
- [`config/avatar-live2d-adapter-manifest.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-manifest.schema.yaml)
- [`config/avatar-live2d-adapter-diagnostics.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-live2d-adapter-diagnostics.yaml)
