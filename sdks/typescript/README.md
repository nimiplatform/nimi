# @nimiplatform/sdk

The official TypeScript SDK for the Nimi Platform.

`@nimiplatform/sdk` provides strongly-typed clients, capability contracts, and runtime interfaces for building privacy-preserving, AI-native desktop applications. Through a unified capability-intent architecture, applications can seamlessly harness both on-device local models and cloud AI providers without managing API keys or low-level transport protocols.

---

## 1. Core Architecture & Mental Model

### The Host-Bound Client
Standard Nimi Apps run inside a desktop host supervised by Nimi Desktop (the current host of Nimi Home). Instead of requiring applications to manage secrets or connect directly to local ports, the host injects a secure IPC bridge.

```ts
import { createNimiClient, type NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiLocalAppStandardShellSurface } from '@nimiplatform/kit/shell/renderer/bridge';

// Scaffolded apps export this singleton from src/shell/auth/local-app-client.ts
const client: NimiLocalAppClient = createNimiClient({
  localApp: { standardShell: createNimiLocalAppStandardShellSurface() },
});
```

- **Host-managed credentials**: No API tokens, account IDs, or private network addresses are embedded in your frontend code.
- **Dynamic Routing**: The local Runtime resolves whether an action is fulfilled by a selected local model or a supported cloud provider based on user preference.
- **Fail-Closed Boundaries**: Direct standalone clients (`createNimiClient({ appId, runtime })`) are reserved for external server daemons or test scripts; Runtime strictly rejects app-scoped operations from unverified gRPC origins.

---

## 2. Quickstart: Text Generation

### Single-Turn Text Generation
The simplest way to generate text using the user's preferred model:

```ts
const { text } = await client.ai.text.generateCandidate({
  messages: [
    { role: 'user', text: 'Summarize the core tenets of local-first computing.' }
  ],
});
console.log(text);
```

### Multi-Step Tool Loops & Structured Output
For multi-turn tool calling, structured JSON output, or multimodal inputs, bind the local app text model:

```ts
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';

export async function answerWithTools(
  client: NimiLocalAppClient,
  question: string,
  signal: AbortSignal,
) {
  const model = createNimiLocalAppTextModel(client.ai);

  return await model.generateText({
    messages: [
      { role: 'user', content: [{ type: 'text', text: question }] }
    ],
    responseFormat: { type: 'json-object' },
    signal,
  });
}
```

- **Tool Execution & Turn History**: The application owns tool handlers and subsequent conversation turns. Preserve ordered `outputItems` as `turnItems` on the next tool step, along with matching tool results.
- **Reasoning Continuity**: Preserve native `reasoning-continuity` payloads byte-for-byte in their original order, including ordinary thinking turns before tools are introduced. Do not decode or display them. Some exact adapters carry plaintext native reasoning, so this carrier does not guarantee encryption or confidentiality from its holder.
- **Native default intensity**: Where Runtime explicitly advertises it, `effort: 'model-default'` keeps the requested `adaptive` or `required` activation while leaving intensity to the native implementation. Omitting the entire reasoning configuration instead keeps the implementation's complete default, which may leave thinking off.
- **Validation**: Treat a response as complete only after successful completion—check the finish reason and validate the returned JSON against your business schema.

---

## 3. Advanced Capabilities

### Audio Transcription (`audio.transcribe`)
Read completed speech-to-text results. Word timing is available only when the selected resource supports alignment:

```ts
const { job } = await client.ai.scenarioJobs.get(jobId);
if (job.status === 'completed' && job.scenarioType === 'speech-transcribe') {
  const transcript = job.transcription;
  if (transcript?.status === 'transcribed') {
    for (const word of transcript.words) {
      console.log(`${word.text} [${word.startSeconds}s - ${word.endSeconds}s]`);
    }
  }
}
```

- **Supported Engines**: Supports local Qwen3 aligned recipes (with 80ms resolution across CJK and European languages) and Faster Whisper with Silero VAD.
- **Resource Limits & Semantics**: Local Qwen3 aligned and Demucs routes accept bounded audio up to 300 seconds, though exact limits and available controls depend on the selected resource. Note that Qwen3 alignment units may be individual CJK characters rather than linguistic words, and a language hint is not a detected-language result.

For the local Qwen3 aligned recipe, supported language hints are `zh`, `en`, `yue`, `fr`, `de`, `it`, `ja`, `ko`, `pt`, `ru`, and `es`. Alignment uses the input audio timeline; keep pauses and add chunk offsets exactly once when assembling longer media. The complete transcription result is bounded to 1 MiB and 16,384 alignment units. An absent detected language remains unknown, even when a language hint was supplied.

### Audio Separation (`audio.separate`)
Separate vocals and accompaniment using local Demucs models:

```ts
// Submit separation job
const { job } = await client.ai.scenarioJobs.submit({
  type: 'audio-separate',
  mimeType: 'audio/wav',
  audioSource: { type: 'bytes', bytes: audioBuffer },
});

// Save job.jobId. Once observation reports completion, read the final result.
const { job: completed } = await client.ai.scenarioJobs.get(job.jobId);
if (completed.status === 'completed' && completed.audioSeparation) {
  const vocals = await client.storage.assets.adoptArtifact({
    artifactId: completed.audioSeparation.vocalsArtifactId,
    relativePath: 'audio/vocals.wav',
  });
  // Use vocals.relativePath: the stored extension may be normalized.
  console.log(vocals.relativePath);
}
```

When handling separation outputs:
- Adopt both separation outputs before presenting a complete pair.
- Read sample rate and channel count from the artifact records, and retain the source timeline when splitting longer audio.
- Treat failed or canceled Jobs as incomplete—never present them as a partial success.

### Custom Voice Creation & Synthesis (`voice.create` & `audio.synthesize`)
Clone a voice from reference audio or design a new persona via natural language:

```ts
// Create a voice persona from audio reference
const { job } = await client.ai.scenarioJobs.submit({
  type: 'voice-create',
  creationSource: 'reference-audio',
  referenceAudio: { type: 'bytes', bytes: sampleAudioBytes },
  referenceAudioMime: 'audio/wav',
  languageHints: [],
  preferredName: 'My voice',
  text: '', // Follow the selected resource’s referenceAudioInput.textMode.

});

// After observing completion, retrieve the voice asset separately from the Job.
const result = await client.ai.scenarioJobs.get(job.jobId);
if (result.job.status === 'completed' && result.asset?.status === 'active') {
  await client.ai.scenarioJobs.submit({
    type: 'speech-synthesize',
    text: 'Hello world, speaking in the newly created voice!',
    language: '', audioFormat: 'wav', emotion: '',
    voiceRef: { type: 'voice-asset', id: result.asset.voiceAssetId },
    timingMode: 'none', voiceRenderHints: null,
  });
}
```

Before building your form, inspect `referenceAudioInput` on the selected `voice.create` resource: it declares the supported input forms and whether reference text is required, optional, or unsupported (the example above passes empty text, so choose a resource that admits it). Also ensure that voice creation and synthesis use compatible selected resources—a created asset does not guarantee that every synthesis route can render it.

### Language Analysis (`text.annotate`)
Perform part-of-speech tagging, lemmatization, and syntactic dependency parsing:

```ts
const { job } = await client.ai.scenarioJobs.submit({
  type: 'text-annotate',
  language: 'en',
  texts: ['Nimi puts personal sovereignty at the center of modern computing.'],
});

// Completed job contains structured token annotations with exact Unicode scalar offsets
```

### Structured Text Decisions (`text.decide`)
Score probability distributions over state-dependent choices or boolean hypotheses:

```ts
const { output } = await client.ai.scenario.execute({
  type: 'text-decide',
  state: { json: { gameRound: 3, playerChips: 450 } },
  questions: [
    {
      id: 'next_action',
      instructions: { text: 'Choose the optimal next action.' },
      kind: 'choice',
      candidates: [{ id: 'raise' }, { id: 'call' }, { id: 'fold' }],
    },
    {
      id: 'opponent_bluffing',
      instructions: { text: 'Is the opponent likely bluffing?' },
      kind: 'boolean',
    },
  ],
}, { timeoutMs: 10_000 });
```

---

## 4. Public Subpaths & Modules

| Subpath | Description |
| :--- | :--- |
| `@nimiplatform/sdk` | Core entry point; exports `createNimiClient` |
| `@nimiplatform/sdk/app` | Host-bound app client types, shell contracts, and app operations |
| `@nimiplatform/sdk/ai` | AI model interfaces, text model bindings, and artifact utilities |
| `@nimiplatform/sdk/contracts` | Common message schemas, content parts, and tool definitions |
| `@nimiplatform/sdk/runtime` | Strongly-typed Runtime client for authorized external processes |
| `@nimiplatform/sdk/realm` | Standalone Realm client for user identities, worlds, and characters |
| `@nimiplatform/sdk/types` | Portable TypeScript types, schemas, and standardized error codes |
| `@nimiplatform/sdk-adapter-vercel-ai` | Separate adapter package for Vercel AI SDK 7 integration |

---

## 5. Protected Conversation Quotation and Source Reads

For LocalAgent chat, use `client.conversation.readMessage({ agentHandle, conversationAnchorId, messageId })` to prepare a quote or navigate to a canonical source in the current authorized Conversation. A readable stable text message returns `quoteText` and `quoteFormat`; other message kinds return both as `null`. The bounded `window` and its `readWatermark` are navigation data, not a replacement live snapshot.

Send the user’s own text or attachment parts with an optional `quote` containing only `sourceMessageId`, the returned format, and a half-open UTF-8 byte range. Runtime supplies the confirmed author, partial state and excerpt. A quote does not replace required input parts, permit cross-Conversation access, or alter regeneration inputs. Preserve the entire original request envelope when reconciling an uncertain submission. See the current migration notes for the matching source carrier requirement.

## 6. Async Job Observation & Cancellation

Long-running generation tasks (audio transcription, separation, voice cloning) are managed as asynchronous scenario jobs:

- **Polling & Events**: Observe jobs with `client.ai.scenarioJobs.get(jobId)` or stream progress via observers.
- **Cancellation**: Call `client.ai.scenarioJobs.cancel(jobId)` to cancel an asynchronous Job, or pass an `AbortSignal` to control supported synchronous calls and model steps. Always inspect the returned state—a cancellation request does not guarantee that a remote provider has stopped computing or billing.
- **Artifact Custody**: Execution artifacts are temporary. Adopt completed outputs with `client.storage.assets.adoptArtifact` and use its returned path. While recovery-enabled Jobs expose `recoveryExpiresAt`, retention windows vary—persist durable App assets for later reopening rather than assuming every Job shares the same retention period.

---

## Remote primary Runtime access

`prepareRuntimeClientLogin` and `completeRuntimeClientLogin` from `@nimiplatform/sdk/realm` establish an app-scoped identity through the official Nimi login page. The application owns its current authenticated user context and persistent user-to-Nimi association. Keep the PKCE transaction in that initiating user's session, pass the existing Nimi association when reconnecting, and call `session.end()` on sign-out, switch or unlink. A failed remote revocation is reported; the local session remains closed.

`connectRemoteRuntime(session)` from `@nimiplatform/sdk/runtime` discovers the one primary binding and coordinates a direct WebRTC connection. It starts no local Runtime and supports no relay. An ordinary App receives `aiConfig` and the existing `ai` clients; a qualified official manager receives the implemented `management` client. Runtime independently verifies source confirmation and each operation's permissions. `connection.close()` ends that connection without stopping the PC.

Browser WebRTC is built in. Native shells supply the exported `RuntimePeerFactory` and `RuntimeDataChannel` interfaces for their platform, preserving the same wire protocol and admission. Native source qualification is a separate required carrier, not a self-reported `client_type`. Raw typed media URLs are unavailable in the initial remote carrier; use inline content or App-owned artifact references. Failed live streams are not resumed automatically and an unanswered business request is never retried automatically.

The executable reference website lives at `examples/remote-runtime-web` in the repository. Its server uses the SDK only for identity and signaling; AI content travels browser-to-PC. Builds and transport tests do not establish a reachable network, an admitted source or successful AI inference.

## License

Licensed under [Apache-2.0](LICENSE).

## Remote ecosystem clients (current source build)

Use `@nimiplatform/sdk/realm/runtime-client` for `prepareRuntimeClientLogin` / `completeRuntimeClientLogin`, and `@nimiplatform/sdk/runtime/remote` for `connectRemoteRuntime`. They reuse the same SDK contracts while avoiding the broad native Host composition imports. A `RemoteRuntimeAppConnection` exposes the implemented ordinary-App operations; it is not a `NimiLocalAppClient` with simulated native proof. Platform peer adapters carry bytes only and cannot grant permissions.

Official login and a separately admitted source establish the current user's context. A client with its own account system must supply that verified user context and end the connection on user switch or unlink.

Ordinary connections provide AI, own AIConfig, managed storage, LocalAgent operations, admitted activity publishing/listing/subscription/read markers, and the fixed WorldCore creator and owner PersonaCharacter operations under realm.data. Realm resources still use the PC Runtime broker and Realm resource ownership; this is not a general Realm or account client. World creation retains Realm account authorization, and other unavailable carrier operations fail explicitly.

When either side is remote, activity open/onOpenRequest routes only to a live source handler and never starts a PC app or a closed webpage. Remote asset writes stream incrementally within Runtime-issued input credits, while file size and quotas remain with the existing asset owner. Match the SDK and Runtime for this pre-launch protocol change. No Relay, upload resumption, or automatic business resubmission is supplied.

Native Desktop still uses the verified Host-injected carrier described above. These additive remote subpaths require this source build until a matching SDK package is published. Shared protocol codecs remain in the bundle; narrow public entrypoints are not a claim of per-method codec splitting.
