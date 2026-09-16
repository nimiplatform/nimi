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

DashScope's `qwen-audio-3.0-asr-flash-streaming` and admitted
`fun-asr-realtime` models also execute finite `speech-transcribe` Jobs. The
matching Runtime accepts mono PCM WAV up to 300 seconds and 32 MiB, waits for
the provider's successful terminal event, and publishes its final text and
actual word times. Partial hypotheses are not completed results. Detected
language remains empty because this protocol does not report it; empty output
is an error, not an inferred `no-speech`. Prompt, response-format and diarization
controls are unsupported. The provider's WebSocket transport does not turn
these Jobs into public realtime sessions. Longer audio remains App chunking.

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
Receive it through `client.storage.assets.adoptArtifact`. Use the returned
record's `relativePath` for reads, previews and removal: Runtime normalizes the
filename extension to the actual artifact media type, so the requested path is
not necessarily the stored path. For example, requesting `transfers/result`
for a WAV artifact returns `transfers/result.wav`.

```ts
const adopted = await client.storage.assets.adoptArtifact({ artifactId, relativePath });
const received = await client.storage.assets.read({ relativePath: adopted.relativePath });
```

Consume `received.body` fully before committing the App's result. If the asset
was a temporary transfer, remove `adopted.relativePath` only after reception.
Treat the pair as complete in the App only after both outputs have been received.
Do not infer roles from filenames, replace background with the input mix, or
count a canceled/failed Job as a partial success.

Check required inputs and outputs before migrating a workflow. A missing
configuration, an implementation defect in an existing contract, and a required
new capability are different integration outcomes. Report the expected result
and actual supported interface rather than silently dropping a core feature.

### Interactive dictation with finite transcription jobs

An App that already implements windowed dictation can submit its bounded audio
windows as `speech-transcribe` Jobs. Capture, silence detection, window offsets,
draft display, utterance commits and document storage remain App-owned. Show
only actual recognized text as a draft; a later window may revise it. Serialize
or bound pending work so a slower recognizer cannot create an unbounded queue.
Pause capture without inventing a transcript, drain the final window on an
explicit stop, and cancel in-flight Jobs on discard. Ignore late results from a
discarded capture generation and retain already committed utterances without
appending them again in the final document.

This composition does not make a finite recognizer a native streaming Driver.
Verify its actual latency and pause/stop/cancel behavior in the App. The separate
`client.ai.realtime` interface implements `realtime.interact`; its presence does
not establish a local, transcription-only route. Do not silently substitute a
Cloud conversation model for local dictation.

### Creating and reusing voices

SDK 0.15.0 and Kit/native 0.11.0 expose optional `referenceAudioInput` on
AIConfig effective Local resources and Cloud targets, also present in their
options. Read it from the selected `voice.create` resource. It contains
`supportsBytes`, `supportsUri`, `textMode` (`unsupported`, `optional`, or
`required`) and `mimeTypes`. Missing metadata means unknown or inapplicable;
an empty MIME list means formats are not enumerated. Neither means arbitrary
input support. Runtime still validates the actual request at admission.

When `textMode` is `unsupported`, pass `text: ''` in the SDK's reference-audio
spec and keep any transcript in App storage. When optional, send the actual
reference transcript if available; when required, request one before creating
the voice. Do not select these behaviors by provider/model name. Local Qwen3
reference workflows accept both public URI and bytes with optional text; the
Runtime captures a URI into private bytes and empty text uses the model's
reference-only mode. Choosing URI input never uploads an existing local file.

Submit `voice-create` through `client.ai.scenarioJobs` with exactly one
`creationSource`: `reference-audio` (audio bytes or HTTPS URI, MIME type and
optional reference transcript in `text`) or `text-description` (instruction and
preview text). Read the completed Job with `get(jobId)` to obtain `asset` and
`voiceReference`. For synthesis, pass the returned asset identity as
`voiceRef: { type: 'voice-asset', id: asset.voiceAssetId }` in a
`speech-synthesize` Job. Creation success is not proof that playable audio was
generated; the local Qwen3 creation paths return a voice handle and
requires a synthesis Job to produce the preview audio.

Both operations use their own committed capability configuration. The selected
`voice.create` implementation must support `input.audio` or `input.text` for the
requested source. Separate local Qwen3 clone and design recipes require their
respective Loadouts; synthesis also needs a compatible selected Loadout. A source
field does not switch a model or route. Expose unmet configuration to the user instead
of retrying through a different engine. Existing engine-specific seed, sampling
or guidance controls must not be silently mapped to unrelated public fields.

For DashScope Qwen-Audio 3.0 voices, select the same current TTS model for
`voice.create` and `audio.synthesize`. Both Plus and Flash use the provider's
voice-enrollment and SpeechSynthesizer protocols. Reference-audio creation
requires a publicly reachable HTTP(S) URI; inline bytes and a local file path
are not supported by this provider workflow. Nimi does not publish an App's
private audio to obtain a URL. Preserve the user's reference URI explicitly,
or select a configuration that accepts bytes. A cloned voice's target model
must match later synthesis. The current provider accepts 16-bit WAV, MP3 or
M4A, at least 16 kHz, at most 60 seconds and 10 MB; it recommends 10–20 seconds
with at least five seconds of continuous clear speech. Stereo uses the first
channel. The reference transcript is unsupported for this workflow; retain it
as business metadata rather than submitting it as a model prompt. Check the
[provider's reference requirements](https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide)
when preparing a new sample. Voice design accepts an English or Chinese
description of at most 500 characters and a preview of 15–200 characters in
the same supported language. Synthesis supports additional languages,
including Spanish; that does not expand the design preview's language range.
The App keeps voice metadata and audition/export files in its business storage.

The current local Qwen3 synthesis Driver accepts WAV output and no timing mode
beyond `none`. It rejects supplied `speed`, `pitch`, `volume`, `sampleRateHz` and
`voiceRenderHints`, including explicit neutral values such as `speed: 1`. Omit
those fields. When the product's playback speed or delivery format is a
deterministic media-editing operation, preserve it in the App after generation
(for example, FFmpeg tempo conversion), using the actual decoded audio format.
That post-processing is distinct from a model's acoustic generation control.

Qwen3 Base reference-voice synthesis does not provide per-utterance style or
emotion instructions. The CustomVoice preset path maps `emotion` to its own
natural-language instruction; this does not establish support for Base voice
assets. A `voice-create` design instruction describes the voice being created,
not a later utterance's prosody. Other engines' inline expression tokens, such
as OmniVoice's `[laughter]` or `[question-en]`, have no defined Qwen3 mapping.
Keep unsupported model-specific controls explicit instead of silently mapping
them to another field or assuming literal text will produce the intended effect.

For a library that mixes cloned and designed voices, select the explicit
**Qwen3 design and reference voice library** recipe for `voice.create`. Bind its
Base and VoiceDesign models independently, and select that same Base ModelAsset
for `audio.synthesize`. The library admits both source features in one captured
configuration. A `text-description` Job requires nonempty `previewText`, runs
VoiceDesign to create real reference audio, then returns a Base-compatible voice
asset containing that reference. Reference-audio creation uses the supplied
audio. Both kinds of asset subsequently synthesize with Base, so a story or
batch can mix them without changing the machine selection. Wait for creation to
complete before requesting audition audio; design creation now includes model
execution and follows the ordinary Job timeout and cancellation lifecycle.

Keep business voice names, descriptions, original reference audio and transcript,
and saved previews in App storage. A Runtime VoiceAsset is not the App's voice
library record or a permanent audio backup. Save the `voiceAssetId` actually
used for an approved take and reuse it to synthesize with that same voice;
there is no requirement to clone every audition again. Runtime revalidates its
owner, status and target compatibility. An expired or incompatible asset fails
explicitly rather than causing hidden recreation, upload or route switching.
This retains the voice identity, not identical audio or prosody on every take.

If the user instead chooses actual sample audio as a new reference, or edits,
denoises or replaces the reference, invalidate the previous reference/asset
association and use `reference-audio` creation for that new input. A cached
source VoiceAsset does not represent edited output audio. Preserve the actual
chosen audio and transcript in either workflow, distinguish the two actions in
the product, and apply normal resource eligibility and configuration checks.

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

The matching development Runtime admits DeepSeek `deepseek-flash` (currently
served by V4.1 Flash), `deepseek-v4-flash` and `deepseek-v4-pro`. These provider
API names are not immutable weight-version pins. Record the exact configured
target and test date when comparing results; prefer the current `deepseek-flash`
name for new Flash selections.

The exact adapters support JSON-object output or native function-tool calls,
including streamed completion, complete tool arguments and tool-result turns.
These are separate admitted combinations: do not combine tools and JSON output.
Thinking is disabled; requested reasoning, JSON Schema, media input, `topK` and
`seed` are not admitted by this slice. The App still uses the same model interface
and AI configuration; it never calls DeepSeek directly or executes a model's
tool request inside Runtime.

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
