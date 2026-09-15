# SDK migration notes

These package-local notes cover the App-facing changes relevant to the current
published baseline. They are not a complete reconstruction of older releases.

## 0.14.0 (development)

- Preserve multiline transcription text through Local App Job projections,
  including empty pending/no-speech content, without relaxing metadata or NUL
  validation.

- Raise annotation capacity to 512 KiB input, 65536 tokens and a 16 MiB result
  without splitting the caller's document. The matching Runtime also admits
  DeepSeek V4 JSON-object generation through the existing App text interface.

- Add the Local `text-annotate` Job and immutable `textAnnotation` result:
  batch source documents, Unicode scalar token offsets, POS/dependency labels,
  head indices and sentence spans. Requires the matching Runtime and Kit/native
  candidate; older 0.14.0 development tarballs do not contain this addition.

- Add the Local `audio-separate` Job and paired `audioSeparation` artifact
  identities. Large output uses the existing owned artifact adoption and App
  asset streams. The initial Runtime Driver is HTDemucs; read its documented
  duration/input limits before composing long media.

- Carry typed speech transcription through Local App jobs, Runtime scenario
  adapters and generation results. Preserve original text, detected language,
  actual alignment units and explicit no-speech results. See the package README
  for resource limits, supported controls and chunk offsets.
- Requires matching Runtime, Kit/native 0.10.0 and Rust shell crates 0.6.0.
  Custom carriers must preserve the optional `transcription` projection. Empty
  no-speech text is valid only with the explicit typed no-speech result; an
  empty inference response is not success. `transcriptionText` remains derived
  from the same result for existing text-only consumers.
- These are local development package versions. Publication is a separate step
  after consumer acceptance. Vercel adapter 0.2.0 updates its SDK peer to 0.14.0;
  its text model behavior is unchanged.

## 0.13.0

- Local App model turns accept ordered user text and image URL/artifact parts.
  Use `filePart` with HTTP(S) image URLs or upload local image bytes through
  `client.ai.artifacts.upload` and pass an `artifact-ref`. Inline data URLs,
  file paths, non-image media and media in assistant/system messages are not
  admitted by this binding. The narrow text-candidate API is unchanged.
- This widens the public Local App contract and requires Kit/native 0.9.0,
  Rust shell crates 0.5.0 and the matching Runtime. Custom carriers must retain
  optional user `parts`; older carriers cannot provide image support.
- The Vercel AI SDK 6 adapter uses the independent
  `@nimiplatform/sdk-adapter-vercel-ai` 0.1.0 package. Its Local App factory
  preserves tool loops and opaque continuity through framework message history.
- Include the public App integration guide and these migration notes in the
  npm package, so consumers can discover the supported surfaces without a
  Nimi source checkout.

## 0.12.0

- Add `createNimiLocalAppTextModel` from `@nimiplatform/sdk/ai` over the protected
  App text client. Requires Kit/native 0.8.0 and the matching Runtime contract.
- Support function tools, ordered output/ToolCall/ToolResult transcript, tool
  choice and structured response formats for this text-only Local App input.
- Preserve opaque reasoning continuity through stream events and later turns.
  Custom collectors must retain its order and bytes without exposing it as
  display reasoning; use the standard collector when no custom one is needed.
- `generateText` collects one cancellable stream. Neither it nor `streamText`
  executes App tools or owns a multi-step workflow. Update exhaustive event
  handling for complete tool calls, continuity and the required item indices.
- App AIConfig selects an eligible execution configuration. Unsupported input,
  interrupted streams and incomplete output remain explicit failures.

See the [0.12.0 source tag](https://github.com/nimiplatform/nimi/tree/sdk/v0.12.0)
and the installed declaration files for the exact versioned API.
