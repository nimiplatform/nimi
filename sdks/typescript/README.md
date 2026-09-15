# @nimiplatform/sdk

Public TypeScript clients and contracts for Nimi Apps and integrations.
The package includes runnable JavaScript and TypeScript declarations under
`dist/`; use the public exports instead of importing Runtime internals.

## Developing a Nimi App

Start with the lifecycle guide included in `@nimiplatform/app-tools`.
`nimi-app --help` prints its location before initialization. Select the matched
SDK/Kit versions from that package's `nimiScaffoldVersions` and retain the
project lockfile. See [migration notes](CHANGELOG.md) before upgrading.

An installed or development App consumes a `NimiLocalAppClient` from
`@nimiplatform/sdk/app`, bound to the standard Kit shell in its supervised Host.
Kit's Electron main/preload and renderer guides describe that construction.
App-owned Node business work can use the same Host's `bridge.services`.
The App does not supply Nimi credentials, account identity, a Runtime endpoint,
or a provider/model override to these protected calls.

```ts
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';

export async function answer(
  client: NimiLocalAppClient,
  question: string,
  signal: AbortSignal,
) {
  return createNimiLocalAppTextModel(client.ai).generateText({
    messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
    signal,
  });
}
```

The model executes one step. The App owns tool handlers and subsequent steps,
preserves ordered `outputItems` as `turnItems`, appends matching tool results,
and forwards cancellation. Preserve opaque `reasoning-continuity` bytes and
order without decoding or displaying them. Only complete successful output
can be treated as a finished result; partial JSON is not a validated object.

SDK 0.14.0's Local App binding supports function tools, tool choice,
structured `responseFormat` and user image parts with Kit/native 0.10.0 and a
matching Runtime. HTTP(S) image file parts and owned image `artifact-ref` parts
preserve their order with text. Upload local image bytes through
`client.ai.artifacts.upload`; do not put file paths or data URLs in model
requests. SDK 0.12.0 / Kit 0.8.0 retain their text-only binding. Other media
methods have separate contracts, and each selected execution configuration
must support the requested modality and controls.

## Local App speech support boundaries

SDK 0.14.0 with Kit/native 0.10.0 and the matching Runtime carries a typed
`job.transcription` on completed `speech-transcribe` jobs. It contains `status`
(`transcribed` or `no-speech`), original `text`, model-reported `language` and
ordered `words` with `text`, `startSeconds` and `endSeconds`. Plain transcription
resources can leave language and words empty. Aligned results also leave
`language` empty when recognition did not report it; real words and timestamps
can still be present. Requesting `timestamps: true`
requires a resource with actual alignment support; unsupported requests fail.
The request's `language` is an input hint, not a detected-language result.
For the local Qwen3 aligned recipe, an explicit supported input language can
guide the aligner when recognition returns text without a language label.
That hint is never copied into the result's `language`. Without a reported
language or an explicit supported hint, alignment fails; an unsupported
reported language is not overridden by the hint. Apps can use their selected
source language for downstream processing while retaining missing detection
as unknown.

```ts
const { job } = await client.ai.scenarioJobs.get(jobId);
if (job.status === 'completed' && job.scenarioType === 'speech-transcribe') {
  const transcript = job.transcription;
  if (transcript?.status === 'transcribed') {
    for (const word of transcript.words) {
      console.log(word.text, word.startSeconds, word.endSeconds);
    }
  }
}
```

`transcriptionText` remains the same original text for text-only consumers.
Use the typed result rather than decoding artifact JSON. `no-speech` has empty
text, language and words; it is distinct from invalid input and inference
failure. The complete result is limited to 1 MiB and 16,384 alignment units.

The local Qwen3 Transformers aligned recipe captures both the recognition
model and its forced aligner in the selected Loadout. It accepts at most 300
seconds per request and supports zh/en/yue/fr/de/it/ja/ko/pt/ru/es. Times are
actual model alignment relative to the submitted audio's zero point, with
pauses retained. The current aligner has 80 ms resolution. Units can be CJK
characters; they are not guaranteed to be linguistic words. Text retains
punctuation. For longer media, the App splits input and adds each source chunk
offset exactly once; Runtime does not own App chunking or subtitle assembly.
This route does not provide diarization, speaker counts, or a standalone
alignment operation for caller-supplied transcripts.

The local Faster Whisper recipe instead captures a CTranslate2 Whisper model
and a Silero ONNX voice activity detector. It also accepts up to 300 seconds
and returns real word times on the original input timeline; it does not offer
diarization or prompts. A caller-specified language is a hint, not detected
language, so that result field stays empty when the request fixes the language.
The recognizer receives the full audio: VAD alone cannot discard weak or
synthetic speech. No-speech requires both no recognized segments and no speech
detected by the captured VAD. Empty recognition after detected speech fails.
Neither recipe guarantees error-free subtitles; retain source timing and use
the App's proofreading workflow when recognition or alignment is inaccurate.

Select the intended Loadout for `audio.transcribe` in Nimi's model configuration first.
The App's AIConfig Local intent is the route marker `local: {}` and carries no
Loadout reference; the machine's current selection is captured at new Job
admission. `listOptions({ kind: 'local-loadouts', capabilityContract:
'audio.transcribe' })` exposes that current selection, not every saved Loadout.

Local `audio-separate` jobs consume `mimeType` and the same bytes/HTTPS URI
`audioSource` shape as transcription. Choose the Demucs separation Loadout for
`audio.separate` in Nimi, then declare that capability's `local: {}` App intent.
The initial Driver accepts at most 300 seconds and 32 MiB per input. Split longer
sources in the App while retaining their offsets and complete timeline.

A completed Job's `audioSeparation` names `vocalsArtifactId` and
`backgroundArtifactId`. Both refer to that Job's audio artifacts and preserve
the input zero point, duration and pauses; background is the model's summed
non-vocal sources. Read sample rate and channel count from the artifact records.
The current Driver produces float WAV audio, which can exceed inline limits.
Receive it with `client.storage.assets.adoptArtifact({ artifactId, relativePath })`,
then use `client.storage.assets.read({ relativePath })` for streamed bytes.
Treat the pair as complete in the App only after both outputs have been received.
Do not infer roles from filenames, replace background with the input mix, or
count a canceled/failed Job as a partial success.

Check required inputs and outputs before migrating a workflow. A missing
configuration, an implementation defect in an existing contract, and a required
new capability are different integration outcomes. Report the expected result
and actual supported interface rather than silently dropping a core feature.

## Persisting results and resuming jobs

Runtime Job storage is bounded execution state, not the App's project database.
The current Runtime retains terminal Jobs for up to 30 minutes and applies a
count limit. Save complete validated results in App-managed storage while the
Job is available; adopt output artifacts when the project needs to retain them.
Persisting only a Job ID does not preserve its result or artifact bytes.

When resuming a project, reuse complete App-owned results. If a step has only
an old Job ID, and the normal public Job read explicitly returns `not-found`,
record that reference as unavailable. An explicit continue/retry action may
then submit that unfinished step again from its original input and save the new
ID. Do not poll a missing Job indefinitely, mark it completed, or rerun already
completed project steps. Permission, session and transport errors are different
failures and must not trigger the missing-Job recovery path.

## Structured text

`createNimiLocalAppTextModel(client.ai)` binds text generation to an installed
App's protected session. Its name does not restrict execution to a local model:
the App's committed AI configuration chooses Local or Cloud.

Request JSON with `responseFormat: { type: 'json-object' }` and consume it only
after `generateText` completes. A configured route is not proof that every text
behavior is available; unsupported behavior fails before dispatch, and malformed
model output remains a failure. Do not extract a plausible JSON fragment or
change providers automatically to turn that failure into success.

The matching development Runtime adds JSON-object behavior for DeepSeek
`deepseek-v4-flash` and `deepseek-v4-pro`, including streamed completion and usage.
This behavior disables thinking and supports neither tools, requested reasoning,
JSON Schema, `topK` nor `seed`. The App still uses the same model interface and
AI configuration; it never calls DeepSeek directly.

## Language analysis

Use the `text.annotate` AI configuration capability and submit an asynchronous
`text-annotate` Job through the existing scenario Job API:

```ts
const { job } = await client.ai.scenarioJobs.submit({
  type: 'text-annotate',
  language: 'en',
  texts: ['A sentence to analyze.'],
});
// Subscribe or get this Job through the same scenarioJobs service.
// Read job.textAnnotation only after status === 'completed'.
```

`texts` is an ordered batch of
1–64 strings, including empty strings, totaling at most 512 KiB of UTF-8.
The completed Job's `textAnnotation.documents` preserves that batch order and
the exact original text and whitespace. Each document contains:

- `text`, `language` and an ordered `tokens` array.
- Each token's `text`, `start`, `end`, `headIndex`, `partOfSpeech`, `dependency`
  and `isPunctuation`.
- `sentences`, each with `startToken` and exclusive `endToken`.

Token `start`/`end` count **Unicode scalar values**, not UTF-8 bytes or JavaScript
UTF-16 code units. Python can slice its original string directly; JavaScript can
use `Array.from(document.text).slice(start, end).join('')`. Token array positions
are their indices, heads are document-local, and a span's original text extends
from its first token's start to its last token's end. Sentence spans partition
the token array. Empty documents have no tokens or sentences.

The initial local spaCy implementation uses the original md 3.8.0 pipelines for
en/de/es/fr/it/ru/zh/ja. The active Nimi model configuration must contain the
pipeline for the requested language. `language` validates that choice; it does
not override machine selection. Model installation and dependency preparation
belong to Nimi, and inference never downloads a model in the App. A batch is
bounded to 65536 tokens and a 16 MiB normalized result; oversized or failed analysis
returns failure rather than partial annotations. Keep subtitle splitting rules,
translation, time matching, project state and repeated analysis in the App.
These annotations contain no audio timestamps or generated replacement text.

This addition requires a matching development Runtime, SDK, Kit and native
package set. Keep using the documented local tarball workflow during iteration;
package publication is not a development prerequisite.

## Public entry points

| Import | Purpose |
| --- | --- |
| `@nimiplatform/sdk/app` | Host-bound App client, standard shell contracts and typed App operations. |
| `@nimiplatform/sdk/ai` | Model interfaces and the Local App text model binding. |
| `@nimiplatform/sdk/contracts` | Shared messages, content parts, tool and ordered result values. |
| `@nimiplatform/sdk/ai-runner` | External-host execution helpers; they do not move App workflow state into Runtime. |
| `@nimiplatform/sdk/runtime` | Public Runtime clients for their explicitly supported consumer contexts. This is not a Local App authorization bypass. |
| `@nimiplatform/sdk/realm` | Public Realm clients for their supported contexts; App Realm operations use the App client. |

The installed package's `exports` and `.d.ts` files define the exact callable
surface. Framework adapters are separate packages; do not infer that an
adapter is publicly available from a source-workspace directory.

For Vercel AI SDK 6 Apps, `@nimiplatform/sdk-adapter-vercel-ai` 0.2.0 provides
`createNimiLocalAppVercelLanguageModel({ ai: client.ai })` for `streamText` and
the existing UI/tool-loop protocol. Read its package README before mapping
images or conversation history; preserve text/tool provider metadata for opaque
continuity. It uses SDK 0.14.0 and the matched Kit/native carrier above.

Source and issue reporting: [nimiplatform/nimi](https://github.com/nimiplatform/nimi).
Include the selected SDK, Kit, App Tools and Runtime versions, the actual App
operation, expected/observed behavior, and a bounded reproduction.

Licensed under [Apache-2.0](LICENSE).
