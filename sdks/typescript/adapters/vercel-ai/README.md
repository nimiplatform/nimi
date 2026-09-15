# Nimi adapter for Vercel AI SDK 6

Use this adapter to retain Vercel's model, streaming and caller-owned tool-loop
interfaces while Nimi owns execution configuration and protected access.
Adapter 0.2.0 uses SDK 0.14.0, Kit/native 0.10.0 and a matching Runtime.
SDK 0.12.0 / Kit 0.8.0 alone do not carry Local App images.

## Local App

Obtain the Host-bound `NimiLocalAppClient` through the standard Kit carrier,
then construct the model in the App's request scope:

```ts
import { convertToModelMessages, stepCountIs, streamText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';

const model = createNimiLocalAppVercelLanguageModel({ ai: client.ai });
const result = streamText({
  model,
  messages: await convertToModelMessages(uiMessages),
  tools: callerTools,
  stopWhen: stepCountIs(5),
  abortSignal,
});
return result.toUIMessageStreamResponse();
```

The App continues to own tool callbacks, user approval, diagram editing, file
processing, state and UI. The model adapter emits tool calls only after the
Nimi step has successful terminal evidence, so a failed or interrupted model
batch cannot trigger a Vercel tool callback. Text displayed before that terminal
state remains partial. Malformed output is not replaced with a success value.

User image files are uploaded through this same App client's artifact API.
HTTP(S) image URLs are passed to the Runtime input path. Base64 decoding in the
adapter is transport conversion, not image interpretation; inline binary and
data URIs never enter the protected text-turn request. Persist original files
or App storage references for history; transient Runtime artifact references
are not a durable replacement for the image. No cross-session upload cache is
created by this adapter.

## Conversation history and continuity

Preserve complete UI message `parts`, including text `providerMetadata` and tool
`callProviderMetadata`. The adapter uses versioned `providerMetadata.nimi` to
relay opaque continuity before/after the associated visible part. Its base64
payload is never display reasoning. `convertToModelMessages` restores it to
the canonical ordered Nimi transcript; do not flatten history into text or
discard provider metadata when serializing it.

Caller tool results retain their call IDs, tool names and JSON/text values.
Vercel may copy call metadata onto a tool result; that copy is not replayed as
a second continuity item. Invalid or unsupported metadata fails explicitly.

## Configuration and supported scope

Use Nimi AIConfig for execution configuration. The adapter does not select a
provider/model or expose a compatibility HTTP endpoint. Arbitrary provider
options and HTTP headers are rejected; the framework's transport user-agent is
not a Runtime generation parameter. Request controls must be supported by the
selected Nimi execution configuration. In particular, an App's provider-specific
default `maxOutputTokens` must not be unconditionally imposed on a Nimi model.

Function tools, caller-owned loops, structured response-format mapping and
image input are supported through their matching Nimi contracts. Provider-owned
tools/results/approval transcripts, media output and raw reasoning are rejected.
Only permitted reasoning summaries may be exposed as reasoning. Token usage
remains unknown when the backing Nimi client does not project it.

The manifest describes framework usability and explicit gaps. A successful
mapping test is not live-provider or installed-App acceptance. A generic
`NimiAiModel` can be wrapped with `createNimiVercelLanguageModel({ model })`;
ordinary Local Apps should use the Host-bound factory above.
