# Overtone — SDK Integration Map

## SDK Entry Points

```typescript
import { Runtime } from '@nimiplatform/sdk/runtime';
import { Realm } from '@nimiplatform/sdk/realm';
```

## Integration Rules

1. The renderer talks to runtime and realm through SDK facades.
2. Rust should not re-implement business-level API adapters.
3. When a feature depends on provider-specific music semantics, keep it behind runtime `extensions`, not a hardcoded UI-to-provider contract.

## Runtime Text Surfaces

### Song brief generation

```typescript
const output = await runtime.ai.text.stream({
  model: selectedTextModel,
  input: userPrompt,
  system: conceptSystemPrompt,
  temperature: 0.9,
  maxTokens: 1024,
});

for await (const part of output.stream) {
  if (part.type === 'delta') appendConceptDelta(part.text);
}
```

### Lyrics generation

```typescript
const output = await runtime.ai.text.stream({
  model: selectedTextModel,
  input: lyricsPrompt,
  temperature: 0.85,
  maxTokens: 768,
});
```

## Readiness Check Baseline

The app should separate runtime liveness, scenario availability, connector presence, and model availability.

```typescript
await runtime.ready({ timeoutMs: 5_000 });

const scenarioProfiles = await runtime.ai.listScenarioProfiles({});
const supportsMusic = scenarioProfiles.profiles.some(
  (profile) => profile.scenarioType === 'MUSIC_GENERATE',
);

const connectors = await runtime.connector.listConnectors({
  pageSize: 50,
});

const musicConnectors = connectors.connectors.filter(
  (connector) =>
    connector.capabilities?.includes('music.generate'),
);

const connectorModels = musicConnectors.length > 0
  ? await runtime.connector.listConnectorModels({
      connectorId: musicConnectors[0].connectorId,
      pageSize: 50,
    })
  : null;

const canGenerateMusic =
  supportsMusic &&
  musicConnectors.length > 0 &&
  (connectorModels?.models?.length ?? 0) > 0;
```

Recommended readiness breakdown:

- runtime: `runtime.ready()`
- scenario support: `runtime.ai.listScenarioProfiles(...)`
- connector inventory: `runtime.connector.listConnectors(...)`
- model availability for chosen connector: `runtime.connector.listConnectorModels(...)`
- realm auth/session: first required realm business call

## Runtime Music Surface

### Stable app-facing call

`runtime.media.music.generate(...)` already exists in the SDK as the app-facing convenience for `MUSIC_GENERATE`. Under the hood it projects to async job submission and artifact retrieval.

```typescript
const output = await runtime.media.music.generate({
  model: selectedMusicModel,
  prompt: songPrompt,
  lyrics: fullLyricsText,
  style: styleTags.join(', '),
  title: projectTitle,
  durationSeconds: 120,
  instrumental: false,
  connectorId: selectedConnectorId,
});

setCompletedTake({
  job: output.job,
  artifact: output.artifacts[0],
  trace: output.trace,
});
```

### Explicit job subscription

Use job APIs when the UI wants fine-grained progress or cancellation.

```typescript
const job = await runtime.media.jobs.submit({
  modal: 'music',
  input: {
    model: selectedMusicModel,
    prompt: songPrompt,
    lyrics: fullLyricsText,
    title: projectTitle,
  },
});

const events = await runtime.media.jobs.subscribe(job.jobId);
for await (const event of events) {
  updateJobState(event);
}

const { artifacts } = await runtime.media.jobs.getArtifacts(job.jobId);
```

### Experimental music iteration payloads

The stable music input surface does not yet expose first-class fields for `extend`, `remix`, `style reference`, or `reference audio`. For the demo, these should be modeled as app-owned extension builders:

```typescript
const output = await runtime.media.music.generate({
  model: selectedMusicModel,
  prompt: songPrompt,
  title: projectTitle,
  extensions: buildMusicIterationExtensions({
    mode: 'extend',
    sourceTakeId,
    referenceAudioUri,
    startSeconds: 24,
  }),
});
```

Rules for `buildMusicIterationExtensions(...)`:

- Serialize only to `nimi.scenario.music_generate.request`.
- Keep the Overtone UI model stable even if provider-specific extension keys change.
- Do not leak raw provider terminology into the user-facing form.

Current code-level constraint:

- The SDK and runtime accept `extensions` for music generation.
- The runtime music backend currently forwards those extensions as raw JSON without a music-specific reference-audio mapping layer.
- Treat `extend/remix/reference audio` as a gated feature until the target provider path is verified.

## Runtime Optional Media Surfaces

### Cover art

```typescript
const output = await runtime.media.image.generate({
  model: selectedImageModel,
  prompt: coverPrompt,
  aspectRatio: '1:1',
  n: 4,
});
```

### Guide vocals

```typescript
const output = await runtime.media.tts.synthesize({
  model: selectedTtsModel,
  text: selectedLyricsSection,
  voice: selectedVoiceId,
  language: 'en',
  timingMode: 'word',
});
```

### Voice assets

```typescript
const assets = await runtime.ai.listVoiceAssets({ subjectUserId });
```

Voice cloning and design remain experimental from the Overtone app perspective. They should not be required for the main music flow.

## Realm Publish Surface

```typescript
const audioMediaUrl = await realm.media.upload({
  file: audioBlob,
  type: 'audio',
  filename: `${projectTitle}.mp3`,
});

const post = await realm.posts.create({
  title: projectTitle,
  content: publishDescription,
  media: [{ url: audioMediaUrl, type: 'audio' }],
  tags,
});
```

If cover art is selected, upload it separately and append it to the post media array.

## Error Handling Baseline

| ReasonCode | App response |
|-----------|--------------|
| `AI_PROVIDER_UNAVAILABLE` | show retry path and model fallback |
| `AI_PROVIDER_AUTH_FAILED` | send user to connector setup |
| `AI_MEDIA_SPEC_INVALID` | show inline validation error |
| `AI_MEDIA_OPTION_UNSUPPORTED` | disable unsupported controls for that model |
| `AI_RATE_LIMITED` | show cooldown or retry timer |
| `AI_CONTENT_FILTERED` | surface content warning without implying success |
| `AI_JOB_TIMEOUT` | keep the take in failed state and offer retry |

## Connector Expectations

| Capability | Required for P0 | Example providers |
|-----------|------------------|-------------------|
| Text generation | Yes | OpenAI, DeepSeek, Anthropic |
| Music generation | Yes | Suno, Udio-style connector path if available upstream |
| Image generation | No | OpenAI, Stability, Flux-compatible paths |
| TTS | No | ElevenLabs, DashScope, OpenAI |
| Voice clone/design | No | ElevenLabs-style custom voice paths |

The app should treat connector detection as a first-class readiness flow, not as an error discovered only after the first failed generation.
