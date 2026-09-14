# SDK migration notes

These package-local notes cover the App-facing changes relevant to the current
published baseline. They are not a complete reconstruction of older releases.

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

See the [0.12.0 release](https://github.com/nimiplatform/nimi/releases/tag/sdk/v0.12.0)
and the installed declaration files for the exact versioned API.
