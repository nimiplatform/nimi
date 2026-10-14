# Kit Feature: Generation

Reusable UI, headless state, and typed modality contracts for Nimi generation.

## Public Surfaces

- `@nimiplatform/kit/features/generation`
- `@nimiplatform/kit/features/generation/headless`
- `@nimiplatform/kit/features/generation/ui`
- `@nimiplatform/kit/features/generation/runtime`

## Execution Posture

Kit request types do not accept scoped configuration, binding, model, route, connector, target, readiness, ranking, or fallback authority.

- **`text.generate`**: Dispatches through the SDK owner-driven Runtime AI model using only App identity and request content. Runtime composes the canonical AIConfig and validates its exact committed Loadout or Connector reference at request time. Kit never infers a target, restores a retired binding layer, or fabricates success data.
- **Unsupported capabilities**: Unsupported consume capabilities fail prior to dispatch as typed `AI_ROUTE_UNSUPPORTED`; modality-specific job helpers retain their own typed contracts.
- **`runRuntimeVoiceCatalog(...)`**: Active for owner-scoped `voice_asset_id` references. It does not expose preset discovery because the generated preset wire still requires retired model and connector fields that handwritten callers must omit.

## What Remains Reusable

- Generation request/result and artifact-summary types.
- `GenerationPanel`, `RuntimeGenerationPanel`, status lists, and toasts.
- Generic headless submit-state handling.
- Runtime job-status labels and mapping for already-owned job projections.
- Owner-scoped voice-asset reference listing.

App-specific artifact persistence, media decoding, and downstream domain writes remain app-owned.

## Modality Contracts

### Speech Transcription

SDK 0.14.0 and Kit 0.10.0 preserve an optional `transcription` payload in speech-transcribe jobs and `runRuntimeSpeechTranscribe` results:
- **Result structure**: Contains original text, model-reported language, ordered word/character times in seconds, and an explicit `transcribed` or `no-speech` status (`no-speech` is distinct from a failed inference). Top-level `text` remains available for plain-text consumers.
- **Timestamps**: Pass `timestamps: true` only with an aligned transcription resource; unsupported resources fail rather than synthesize timings.
- **Local recipes (up to 300 seconds per input)**:
  - **Qwen3 Transformers aligned recipe**: Requires both recognition and aligner assets in the selected Loadout. Timestamps start at input zero; the App owns chunk offsets, subtitle assembly, and export. Does not provide diarization or source separation. (See the SDK README for language and result bounds.)
  - **Faster Whisper recipe**: Uses a Whisper recognition model and a Silero voice activity detector. Returns actual word timestamps with no diarization or prompt support. Uses the exact same typed result and App-owned chunk offsets—no alternate SDK call is needed.
- **Configuration**: Select the active transcription Loadout in Nimi's model configuration. App AIConfig declares `local: {}` without naming or selecting a specific local resource.

### Source Separation

- **Submission**: Call `ai.scenarioJobs.submit` on the Host-bound Local App client with an `audio-separate` spec and its own `audio.separate` AIConfig intent.
- **Artifacts**: Completed Jobs return `audioSeparation.vocalsArtifactId` and `backgroundArtifactId`, both identifying owned audio artifacts on the same timeline. A failed or canceled Job never produces a successful pair.
- **Custody & chunking**: Adopt large WAVs via `storage.assets.adoptArtifact` and read them with `storage.assets.read`. See the SDK README for the initial Driver's input limits and App chunking responsibilities.

### Embeddings

- **Execution**: `runRuntimeAIConsumeCapability` accepts batch `inputs` and an optional positive integer `dimensions` for `text.embed`. A protected App submits the same fields through `client.ai.scenario.execute({ type: 'text-embed', inputs, dimensions })`.
- **Dimensions**: Omit `dimensions` to keep the selected implementation's native default. Runtime allows shortening only for supported exact targets and rejects the option for unsupported compositions.
- **Output**: The result summary retains actual width, `spaceId`, and at most eight sample values. Compare vectors only within the same `spaceId`. Missing usage is unspecified.

## Observing and Canceling Jobs

### Polling and Observation Semantics
- All Job runners and observers poll the original Job using `getIntervalMs` (default `1000` milliseconds, positive integer) even when an event subscription is healthy and silent.
- `Get` requests are serialized. `onObservation` receives every full `Get`, including any transient `observationIssue` (which does not alter the Job status).
- `runNimiRuntimeScenarioJob` and `observeNimiRuntimeScenarioJob` return the complete terminal response as `response`, including typed outer results.

### Cancellation Signals
- **Runner `signal`**: Requests an explicit user Cancel.
- **Runner `observationSignal`**: Stops observation (e.g., on view disposal or navigation) without canceling the Job.
- **Observer `signal` vs `cancelSignal`**: For `observeNimiRuntimeScenarioJob` and Kit `observeRuntime*` helpers, `signal` only detaches observation, whereas the optional `cancelSignal` explicitly requests Cancel.
- **Cancel resolution**: A rejected Cancel is reported as an observation error with the original Job ID and never fabricates a terminal state. A successful Cancel still requires a full terminal `Get`.
- **Call budgets**: Technical `callOptions` budgets remain independent of Job lifetime.

### Submission and Persistence
Save the business action before calling Submit and persist the returned Job ID. Reopen jobs by their original ID or submission lookup—missing or expired actions must never trigger a new Submit. Observers do not own App history or media custody; read or adopt results through their formal typed, artifact, or resource owners while retention permits.

## Verification

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
```
