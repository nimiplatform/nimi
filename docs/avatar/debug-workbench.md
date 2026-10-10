# Avatar Backend Diagnostics

Avatar owns local backend evaluation. A diagnostic result can explain whether a backend loaded, a route is supported, or a speech/lipsync projection rendered correctly. It creates no Runtime probe identity, special Runtime store, public App entitlement, or LocalAgent success.

## Result Shape

The Avatar-owned result requires `diagnostic_session_id`, backend kind, probe kind, `observed_at`, and evidence. Each evidence item contains `evidence_id`, `evidence_kind`, `status`, and `source`. Status is exactly `passed`, `failed`, `unsupported`, or `invalid`.

An optional opaque common Runtime correlation reference can connect observations. Raw Agent/account identity, Runtime special-store references, provider/model details, package paths, prompts, reasoning, and public operation authority do not enter the result.

## Evidence Kinds

- `package_descriptor_resolved`
- `backend_loaded`
- `capability_profile_validated`
- `route_support_checked`
- `generated_motion_checked`
- `emotion_expression_checked`
- `speech_lipsync_checked`
- `carrier_diagnostics_checked`

Optional evidence payloads contain typed bounded facts or opaque authorized references. They do not reconstruct Runtime context or create a durable execution replay service.

## Check a Motion Route

Evaluate the authorized typed presentation input against the selected Avatar route, backend, validated capability profile, and optional mapping sidecar. The deterministic provider returns executable output for that backend or the exact typed failure. An unsupported route remains unsupported; a found `.vrma` file, screenshot, preview, or passing fixture does not prove the real Runtime-to-carrier journey.

Use the [visual acceptance](/avatar/visual-acceptance) and [carrier acceptance](/avatar/carrier-acceptance) requirements for a real product result. Local diagnostics and fixture tests remain useful evidence within their own scope.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`config/avatar-generated-motion-routes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-generated-motion-routes.yaml)
- [`config/avatar-backend-capability-profile.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/avatar-backend-capability-profile.schema.yaml)
