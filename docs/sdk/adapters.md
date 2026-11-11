<!-- nimi-docs: {"authority":[],"sources":["sdks/typescript/adapters/vercel-ai/package.json","sdks/typescript/adapters/vercel-ai/index.ts",".nimi/spec/sdks/feature-clients.authority.yaml"]} -->

# Framework Adapters

Adapters bridge third-party framework interfaces with Nimi AI client operations. Runtime handles model routing and execution, while the application manages tool callbacks, presentation, and its own business state.

## Choose the Adapter and Dependencies

Published `@nimiplatform/sdk-adapter-vercel-ai@0.6.2` declares SDK `^0.22.2`, AI SDK `^7.0.0` and `@ai-sdk/provider` `^4.0.0`, and returns a `LanguageModelV4`. See [Environment Setup](/start/install) for complete artifact selection and source-only entry restrictions. Historical adapter `0.1.0` targets AI SDK 6 and is not the version used here.

After installing the selected combination, reuse the native App's current host client:

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
