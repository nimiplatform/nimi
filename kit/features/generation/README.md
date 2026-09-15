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

`text.generate` dispatches through the SDK owner-driven Runtime AI model with
App identity and request content only. Runtime composes the canonical AIConfig
and validates its exact committed Loadout or Connector reference at request time.
Kit does not infer a target, restore a retired binding layer, or fabricate
success data. Unsupported consume capabilities remain typed
`AI_ROUTE_UNSUPPORTED` before dispatch; modality-specific job helpers retain
their own typed contracts.

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

## Speech transcription

SDK 0.14.0 / Kit 0.10.0 preserve optional `transcription` in speech-transcribe
job and `runRuntimeSpeechTranscribe` results. It contains original text,
model-reported language, ordered word/character times in seconds, and explicit
`transcribed` or `no-speech` status. `text` remains convenient for text consumers.
Use `timestamps: true` only with an aligned transcription resource; unsupported
resources fail rather than synthesize timings. No-speech is distinct from a
failed inference.

The local Qwen3 Transformers aligned recipe needs both recognition and aligner
assets in the selected Loadout and accepts up to 300 seconds per input. Times
start at input zero; the App owns chunk offsets, subtitle assembly and export.
See the SDK README for language and result bounds. This transcription recipe
does not provide diarization or source separation.

The Faster Whisper recipe captures a Whisper recognition model and a Silero
voice activity detector instead. It returns actual word timestamps for inputs
up to 300 seconds, with no diarization or prompt support. It uses the same
typed result and App-owned chunk offsets; no alternate SDK call is needed.

Choose the current transcription Loadout in Nimi's model configuration. App
AIConfig declares `local: {}`; it does not name or choose another local resource.

## Source separation

Use the Host-bound Local App client's `ai.scenarioJobs.submit` with an
`audio-separate` spec and its own `audio.separate` AIConfig intent. Completed Jobs
carry `audioSeparation.vocalsArtifactId` and `backgroundArtifactId`; both identify
owned audio artifacts with the same timeline. Receive large WAVs through
`storage.assets.adoptArtifact` and read them with `storage.assets.read`.
The SDK README documents the initial Driver's input limits and App chunking
responsibility. A failed or canceled Job does not provide a successful pair.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
