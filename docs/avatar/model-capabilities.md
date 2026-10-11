# Model Capabilities and Mapping

A model package must describe the facts of its selected Live2D or VRM backend. Avatar validates those facts before using a route. A file's presence, a confidence score, or a creator's JavaScript does not establish support.

## Capability Profile

Follow the backend capability profile schema:

- `profile_id`, `backend_kind`, and `model_fingerprint` identify the profile and model.
- `generated_motion` declares disjoint supported and unsupported routes plus safety limits.
- A VRM profile records humanoid bones, expression presets, look-at, and pose limits.
- A Live2D profile records motion groups, expression IDs, and parameter IDs.

Declare capabilities that the model actually has. A missing or mismatched profile and unsupported targets fail closed.

## Mapping Sidecar

The current generated-motion catalog targets VRM, and its sidecar parser requires backend_kind=vrm. Live2D uses built-in mapping from its own motion groups, expressions, and parameter facts rather than gaining routes through these VRM sidecars.

A sidecar associates one admitted Avatar route with validated model targets. It uses `route_id`, the matching `profile_id`, confidence and threshold, source classification, confirmation, and target fields. It does not contain keyframes or a fallback route. See [Generated Motion Provider](/avatar/generated-motion-provider) for the exact fields and a structural example.

For an LLM-derived name mapping, manual confirmation is required before admission. Confidence must meet the configured threshold; it is not a tie-breaker among candidates.

## Check a Model Change

1. Match the model fingerprint and backend kind to its capability profile.
2. Check each claimed route against the current route catalog and model facts.
3. Validate any sidecar against the closed schema and matching profile.
4. Run the real Avatar presentation path for the changed behavior; inspect the returned failure when unsupported.

Local diagnostics help inspect a selected model, but fixture output alone does not establish live product readiness. See [Backend Diagnostics](/avatar/debug-workbench) and [Visual Acceptance](/avatar/visual-acceptance).

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
- [`config/avatar-mapping-sidecar.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-mapping-sidecar.schema.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
