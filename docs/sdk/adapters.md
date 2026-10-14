# Framework Adapters

Adapters bridge third-party framework interfaces with Nimi AI client operations. Runtime handles model routing and execution, while the application manages tool callbacks, presentation, and its own business state.

## Published Packages vs. Source Development Packages

| Artifact | Version and pairing | Role in this guide |
| --- | --- | --- |
| Published npm Vercel adapter | 0.1.0; AI SDK 6, provider 3, SDK ^0.13.0 | Earlier public artifact; not interchangeable with the current source workspace example |
| Current workspace Vercel adapter source | 0.5.0; AI SDK ^7.0.0, provider ^4.0.0, SDK ^0.21.0 | Used in the example below, loaded via matching local archives or a development delivery bundle |
| OpenAI-compatible adapter | Source only; not distributed as a public npm package | Intended for internal testing and explicitly supported compatibility subsets |

The published 0.1.0 declarations are documented in the [npm artifact metadata](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.1.0). A version specified in a source manifest does not establish that the package has been published to npm. To set up the current application environment, follow [Development Environment Setup](/start/install).

## Using Vercel AI SDK 7 in the Current Source App

Ensure you have SDK 0.21.0, matching Kit and Runtime builds, and local development archives for source adapter 0.5.0. Reuse the host-bound client from your shell:

```ts
import { stepCountIs, streamText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

const model = createNimiLocalAppVercelLanguageModel({
  ai: getNimiLocalAppClient().ai,
});

const result = streamText({
  model,
  prompt: 'Summarize this note in three sentences.',
  stopWhen: stepCountIs(5),
});
```

This source adapter implementation returns a `LanguageModelV4` instance and does not pair with AI SDK 6. Execution also requires the application's configured `AIConfig`, valid capability declarations, and an active desktop session. The adapter itself does not supply credentials, verify model readiness, or bypass platform authorization rules.

## Other Entry Points

Consume public AI runner, Runtime, and AI utility subpaths according to their documented contracts. The retired `@nimiplatform/sdk/ai-provider` subpath has been removed and does not route to framework adapters.

The OpenAI-compatible adapter supports only the narrow API subset explicitly implemented in source. Because it is not published as a standalone package, it cannot be used to establish direct connections to private Runtime instances or bypass platform capability checks.

## Source Basis

- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`sdks/typescript/adapters/vercel-ai/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/index.ts)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
