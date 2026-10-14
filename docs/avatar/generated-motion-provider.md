# Generated Motion and Mapping Sidecars

Avatar generates backend presentation output from validated model capabilities and built-in routes. The current generated-motion catalog targets VRM. Live2D relies on its own built-in mappings and model capabilities; these VRM sidecars do not admit routes for Live2D.

## Current VRM Path

Runtime supplies admitted semantics (such as `agree`), and Avatar maps them to catalog routes (such as `nod_yes`). The current routes are `idle_subtle`, `listen_lean`, `nod_yes`, `shake_no`, and `greet_wave`. These are Avatar backend IDs, not public APML tags or new Runtime activities.

The VRM provider takes the model, route, intensity, and loop inputs, returning either a generated clip or a `fail_closed` result with a `reasonCode`. When a capability profile is missing, a target is unsupported, or a pose is unsafe, the provider fails closed rather than silently falling back to idle. These routes do not require a physical `.vrma` file.

## Exact Sidecar Fields

The current VRM parser accepts only these top-level fields; any unrecognized fields are rejected:

| Field | Purpose |
| --- | --- |
| `sidecar_id` | Non-empty mapping identifier |
| `route_id` | Admitted VRM route from the current catalog |
| `backend_kind` | Must be `vrm` for this parser |
| `profile_id` | Must match the capability profile used for support evaluation |
| `confidence` | Value from 0 to 1; support requires it to meet or exceed `threshold` |
| `threshold` | Value from 0.82 to 1; may raise, but not lower, the current confidence floor |
| `manual_confirmation` | `unconfirmed`, `confirmed`, or `rejected` |
| `source_kind` | `deterministic_manifest`, `static_name_match`, `llm_semantic_match`, or `human_review` |
| `target_fields` | Non-empty list; each target has `target_kind` and `name`, with an optional `role` |

The schema contains no `route` or `fallback` fields. Confidence controls admission, not candidate ranking. Supply one unambiguous mapping per route rather than relying on ordering among duplicate route entries.

An LLM-derived mapping requires `confirmed` status. Rejected or below-threshold mappings remain unsupported. Valid values for `target_kind` are `humanoid_bone`, `expression_preset`, `lookat`, `motion_group`, and `parameter_id`; all declared targets must match the facts of the selected backend and capability profile.

## Structural Example

This YAML can pass structural schema parsing. However, `demo-vrm-profile` and the `neck` target must still match an actual validated profile before the route is treated as supported:

```yaml
sidecar_id: demo-nod
route_id: nod_yes
backend_kind: vrm
profile_id: demo-vrm-profile
confidence: 0.95
threshold: 0.9
manual_confirmation: confirmed
source_kind: human_review
target_fields:
  - target_kind: humanoid_bone
    name: neck
```

Passing structural parsing does not mean the model has executed the motion. Full support evaluation verifies the profile, backend kind, declared route, confirmation status, and target facts.

## Related Documentation

- [Model Capabilities](/avatar/model-capabilities)
- [VRMA Interchange](/avatar/vrm-motion-authoring)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
- [`config/avatar-mapping-sidecar.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-mapping-sidecar.schema.yaml)
- [`apps/avatar/src/shell/renderer/vrm/vrm-mapping-sidecar.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-mapping-sidecar.ts)
- [`apps/avatar/src/shell/renderer/vrm/vrm-generated-motion-contract.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/vrm/vrm-generated-motion-contract.ts)
