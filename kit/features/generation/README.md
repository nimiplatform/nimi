# Kit Feature: Generation

Reusable UI, headless state, and typed modality contracts for Nimi generation.

## Public Surfaces

- `@nimiplatform/kit/features/generation`
- `@nimiplatform/kit/features/generation/headless`
- `@nimiplatform/kit/features/generation/ui`
- `@nimiplatform/kit/features/generation/runtime`

## Execution Posture

Kit request types do not accept scoped configuration, binding, model, route,
connector, target, readiness, ranking, or fallback authority.

The generated Runtime Scenario wire still declares retired target fields as
required. The handwritten Kit layer does not populate them. Consequently, text,
embedding, image, video, speech synthesis, and speech transcription helpers
return a typed `AI_ROUTE_UNSUPPORTED` unavailable result before dispatch. Kit does not infer a target, restore the retired binding layer,
or fabricate success data.

`runRuntimeVoiceCatalog(...)` remains active for owner-scoped `voice_asset_id`
references. It does not expose preset discovery because the generated preset
wire still requires retired model and connector fields that handwritten callers
must omit.

## What Remains Reusable

- Generation request/result and artifact-summary types.
- `GenerationPanel`, `RuntimeGenerationPanel`, status lists, and toasts.
- Generic headless submit-state handling.
- Runtime job-status labels and mapping for already-owned job projections.
- Owner-scoped voice-asset reference listing.

App-specific artifact persistence, media decoding, and downstream domain writes
remain app-owned.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
