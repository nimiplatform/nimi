# Live2D Asset Compatibility Contract

> **App**: `@nimiplatform/avatar`
> **Authority**: Avatar kernel contract
> **Status**: Active contract for existing Live2D asset adaptation
> **Sibling contracts**:
> - [Live2D render contract](live2d-render-contract.md)
> - [Carrier visual acceptance contract](carrier-visual-acceptance-contract.md)
> - [Agent script contract](agent-script-contract.md)
> - [Embodiment projection contract](embodiment-projection-contract.md)

---

## 0. Reading Guide

This contract defines how Nimi Avatar adapts existing Live2D Cubism packages
without claiming arbitrary model support. It governs compatibility tiers, the
Avatar-owned adapter manifest, semantic mapping, validation diagnostics, legal
fixtures, and Avatar carrier acceptance.

The markdown contract and its machine-readable tables are a single Avatar
authority surface. The tier requirements live in
[`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml),
the manifest schema lives in
[`tables/live2d-adapter-manifest.schema.yaml`](tables/live2d-adapter-manifest.schema.yaml),
and the diagnostic code registry lives in
[`tables/live2d-adapter-diagnostics.yaml`](tables/live2d-adapter-diagnostics.yaml).

This contract does not redefine Runtime/SDK agent semantics. Runtime and SDK
continue to own activity, emotion, posture, turn, and timeline truth. Avatar
owns only the Avatar-local mapping from those semantics into a model-local Live2D
package.

## 1. Non-Negotiable Rules

- Existing upstream asset packages are read-only unless a human explicitly
  chooses to create a new derivative package.
- No test or loader path may silently rewrite `model3.json`, motion files,
  expressions, textures, physics, pose, or hit-area declarations.
- No package is "supported" without a computed compatibility tier and explicit
  feature dispositions.
- Missing motions, expressions, pose, lip-sync ids, physics, or hit regions are
  not success states. They are either lower-tier explicit dispositions or
  fail-closed diagnostics.
- Unauthorized Live2D sample models or third-party assets must not be committed
  or redistributed.
- Desktop renderer evidence never closes Avatar carrier compatibility proof.

## 2. Compatibility Tiers

Compatibility is computed by Avatar validation. A manifest may request a tier,
but the validator must return the highest tier actually proven.

| Tier | Name | Meaning | Product claim |
| --- | --- | --- | --- |
| `unsupported` | Unsupported | The package or manifest violates mandatory layout, license, schema, or claimed-feature checks. | Must not load as success. |
| `render_only` | Render Only | Official Cubism runtime package loads and can render in the Avatar carrier, but no semantic activity/expression/pose/lipsync support is promised. | "Renders as a Live2D model only." |
| `semantic_basic` | Semantic Basic | Manifest maps required basic companion semantics and explicitly dispositions optional features. | "Works as a basic companion with bounded degraded features." |
| `companion_complete` | Companion Complete | Manifest maps the full current Avatar core activity set, expression/pose/lipsync/hit-region expectations, and optional physics without unsupported current-scope gaps. | "Complete current Live2D companion behavior for the active Avatar carrier." |

Tier requirements are listed in
[`tables/live2d-compatibility-tiers.yaml`](tables/live2d-compatibility-tiers.yaml).

## 3. Adapter Manifest

### 3.1 Manifest Identity

The manifest kind is:

```json
{
  "manifest_kind": "nimi.avatar.live2d.adapter",
  "schema_version": 1
}
```

The manifest is Avatar Avatar authority. It maps an existing Live2D package
to Avatar carrier expectations; it is not a Runtime, SDK, Desktop, NAS, or
platform event contract.

### 3.2 Manifest Locations

Avatar may load an adapter manifest from exactly one explicit source:

| Source | Path | Mutates upstream package | Use |
| --- | --- | --- | --- |
| embedded creator manifest | `<model-pkg>/runtime/nimi/live2d-adapter.json` | No, when shipped by the creator as part of the package | First-party or creator-authored Nimi-ready packages. |
| external sidecar manifest | Host-local Avatar adapter store, selected explicitly by import/launch context | No | Adapting existing packages without changing upstream files. |

If both are present, launch/import context must select one. Avatar must not merge
manifests or silently prefer one over the other.

### 3.3 Required Fields

The normative machine-readable v1 manifest schema is
[`tables/live2d-adapter-manifest.schema.yaml`](tables/live2d-adapter-manifest.schema.yaml).
The TypeScript shape below is an explanatory projection of that closed schema,
not a separate app-local manifest authority.

```typescript
type Live2DAdapterManifestV1 = {
  manifest_kind: 'nimi.avatar.live2d.adapter';
  schema_version: 1;
  adapter_id: string;
  target_model: {
    model_id: string;
    model3: string | 'auto';
    expected_runtime_digest?: string;
  };
  license: {
    redistribution: 'allowed' | 'forbidden' | 'unknown';
    evidence: string;
    fixture_use: 'committable' | 'operator_local_only' | 'not_allowed';
  };
  compatibility: {
    requested_tier: 'render_only' | 'semantic_basic' | 'companion_complete';
  };
  semantics: Live2DSemanticMapV1;
};
```

`adapter_id` is stable within the adapter store. `target_model.model_id` must
match the resolved `*.model3.json` filename unless the manifest is explicitly
declared as `model3: "auto"` and validation finds exactly one model entry.

### 3.4 Semantic Map

```typescript
type FeatureDisposition =
  | { status: 'supported'; reason?: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'not_applicable'; reason: string };

type Live2DSemanticMapV1 = {
  motions: {
    idle: { group: string };
    activities?: Record<string, {
      group?: string;
      weak_group?: string;
      strong_group?: string;
      disposition?: FeatureDisposition;
    }>;
    missing_activity: 'diagnostic_no_success' | 'idle_degraded_with_diagnostic';
  };
  expressions: {
    map?: Record<string, string>;
    disposition: FeatureDisposition;
  };
  poses: {
    map?: Record<string, string>;
    disposition: FeatureDisposition;
  };
  lipsync: {
    mouth_open_y_parameter?: string;
    /** Wave 0 admit (topic 2026-04-30-avatar-vrm-backend-branch, design-05):
     *  Whether the model declares ParamMouthForm. Driver writes both
     *  ParamMouthOpenY and ParamMouthForm when 'supported'; falls back to
     *  OpenY-only when 'absent'. */
    paramMouthForm?: 'supported' | 'absent';
    disposition: FeatureDisposition;
  };
  physics: {
    mode: 'model_physics' | 'absent' | 'unsupported';
    disposition: FeatureDisposition;
  };
  hit_regions: {
    map?: {
      head?: string[];
      face?: string[];
      body?: string[];
      accessory?: string[];
    };
    fallback: 'alpha_mask_only' | 'fail_closed';
    disposition: FeatureDisposition;
  };
  nas_fallback: {
    default_idle_motion: string;
    missing_handler: 'backend_default_with_diagnostic' | 'no_default';
  };
};
```

All activity keys use active Runtime activity ids consumed through Avatar
projection. They do not create new Runtime ontology truth.

## 4. Validation Rules

The validator must fail closed with structured diagnostics when:

- manifest JSON is missing, malformed, or has an unsupported
  `manifest_kind/schema_version`;
- `target_model.model_id` does not match the resolved package model id;
- `target_model.expected_runtime_digest` is present and does not match;
- license posture is `unknown` for committable fixtures;
- a `supported` motion group is not present in `FileReferences.Motions`;
- a `supported` expression id is not present in `FileReferences.Expressions`;
- a `supported` pose mapping is declared but `FileReferences.Pose` is absent;
- a `supported` lip-sync parameter id is absent from the model parameter set
  when parameter inspection is available;
- `model_physics` is declared but `FileReferences.Physics` is absent or rejected
  by Cubism;
- hit-region aliases declare `supported` regions not present in `HitAreas`;
- `missing_activity` would treat an unsupported activity as successful.

The closed diagnostic registry is
[`tables/live2d-adapter-diagnostics.yaml`](tables/live2d-adapter-diagnostics.yaml).
The diagnostic namespace is `AVATAR_LIVE2D_COMPAT_*`. Required codes:

| Code | Meaning |
| --- | --- |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_MISSING` | Requested tier requires a manifest but none was selected. |
| `AVATAR_LIVE2D_COMPAT_MANIFEST_INVALID` | Manifest JSON or schema is invalid. |
| `AVATAR_LIVE2D_COMPAT_MODEL_ID_MISMATCH` | Manifest target does not match resolved model. |
| `AVATAR_LIVE2D_COMPAT_LICENSE_UNVERIFIED` | Fixture or package license evidence is insufficient for the requested use. |
| `AVATAR_LIVE2D_COMPAT_MOTION_MISSING` | A supported motion mapping points to a missing group. |
| `AVATAR_LIVE2D_COMPAT_EXPRESSION_MISSING` | A supported expression mapping points to a missing expression. |
| `AVATAR_LIVE2D_COMPAT_POSE_UNAVAILABLE` | Supported pose mapping was claimed but pose support is unavailable. |
| `AVATAR_LIVE2D_COMPAT_LIPSYNC_PARAMETER_MISSING` | Supported lipsync mapping lacks a valid mouth parameter. |
| `AVATAR_LIVE2D_COMPAT_PHYSICS_UNAVAILABLE` | Supported physics was claimed but physics is unavailable or invalid. |
| `AVATAR_LIVE2D_COMPAT_HIT_REGION_MISSING` | Supported hit-region mapping points to absent hit areas. |
| `AVATAR_LIVE2D_COMPAT_UNSUPPORTED_SEMANTIC` | A runtime semantic request has no supported model-local mapping. |

## 5. NAS Fallback Binding

NAS remains convention-based handler code under `<model>/runtime/nimi/`. The
adapter manifest does not replace NAS and does not create a declarative NAS DSL.

When a NAS activity handler is absent:

1. Avatar checks the adapter motion mapping if an adapter is active.
2. If no adapter mapping exists, Avatar may use the Live2D branch convention
   fallback (`Activity_<CamelCase>`) only when the computed tier allows it.
3. If neither path supports the semantic request, Avatar emits a diagnostic and
   must not count the request as successful activity playback.

## 6. Legal Fixtures

Fixture policy is mandatory:

- `fixture_use: "committable"` requires redistribution evidence in the manifest
  and must not rely on private or ambiguous third-party terms.
- `fixture_use: "operator_local_only"` may be used for local manual acceptance
  but cannot be committed as an asset fixture and cannot close automated CI by
  itself.
- `fixture_use: "not_allowed"` blocks the package from fixture use.

Wave 2 must include legal fixture evidence before claiming current compatibility
closure. Synthetic fixtures are acceptable only when they are rights-owned and
exercise real Cubism package layout and Avatar carrier rendering.

## 7. Carrier Acceptance

`render_only` and higher tiers require Avatar carrier visual evidence, not just
loader success:

- model loads through Avatar Live2D branch;
- Avatar-owned canvas/WebGL path produces non-placeholder visible pixels;
- mapped semantic behavior changes model-local command state or pixels when the
  tier claims semantic support;
- invalid/missing package or manifest inputs fail closed with diagnostics.

Desktop chat Live2D renderer evidence and static fixture screenshots are not
accepted.

## 8. ParamMouthForm Winner-Key Mapping (Wave 0 admit)

> Source: topic `2026-04-30-avatar-vrm-backend-branch` design-05
> §"Live2D ParamMouthForm 映射".

`ParamMouthForm` is the Cubism standard mouth-shape parameter (range
`[-1, 1]`; -1 = round/closed, 0 = neutral, +1 = wide). When the wLipSync
driver selects a winner viseme, it writes the following standard mapping:

| Winner key | Viseme | ParamMouthForm value | 嘴型描述 |
| --- | --- | --- | --- |
| `A` | aa | **-0.6** | 圆张大（如 "啊"）；OpenY 较高 |
| `E` | ee | **+0.4** | 横向半开（如 "诶"） |
| `I` | ih | **+0.8** | 横向最窄（如 "易"） |
| `O` | oh | **-0.2** | 中性偏圆（如 "哦"） |
| `U` | ou | **-0.8** | 圆形收口（如 "乌"） |
| _silent / no winner_ | — | **0** | 中性；OpenY 同时归零 |

Driver constraints:

- When `runner` co-contributes, `ParamMouthForm` takes the **winner-only**
  value (no blending; avoids form jitter). `ParamMouthOpenY` may still take
  the winner+runner blend sum (because openness is continuous).
- `ParamMouthForm` tier check goes through `semantics.lipsync.paramMouthForm`
  (§3.4). When the manifest reports `'absent'`, the driver writes
  `ParamMouthOpenY` only and emits an evidence record
  `paramMouthForm: not_supported`.
- This mapping is reproduced verbatim as a `const` table in
  `apps/avatar/src/shell/renderer/live2d/live2d-lipsync-driver.ts`. Scattered
  hardcoded values across other files are forbidden (drift check).

## 9. Evolution

- New tiers require a minor contract bump and table update.
- Changing tier semantics or manifest required fields requires a major contract
  bump.
- Adding VRM/3D/Lottie support requires a separate backend compatibility
  contract, not widening this Live2D contract.
- Changing the ParamMouthForm winner-key mapping values requires a minor bump
  + sync to the lipsync driver `const` table + sync to evidence regression
  fixture.
