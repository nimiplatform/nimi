# Framework Adapters

Adapters translate third-party framework calls into Nimi AI client operations. Runtime retains routing and execution; the App retains tool callbacks and its own UI or business state.

## Published and Source Development Packages

| Artifact | Version and pairing | Use in this guide |
| --- | --- | --- |
| Published npm Vercel adapter | 0.1.0; AI SDK 6, provider 3, SDK ^0.13.0 | Earlier public artifact, not interchangeable with the current source example |
| Current workspace Vercel adapter source | 0.5.0; AI SDK ^7.0.0, provider ^4.0.0, SDK ^0.21.0 | The example below uses this development combination via matching local archives or a development delivery bundle |
| OpenAI-compatible | Source only; not distributed as a public npm package | Internal testing and the explicitly supported compatibility subset |

The published 0.1.0 declarations are available in [npm artifact metadata](https://registry.npmjs.org/@nimiplatform%2fsdk-adapter-vercel-ai/0.1.0). A source manifest version does not establish publication of that version. Prepare the current App combination using [Development Environment Setup](/start/install).

## Vercel AI SDK 7 in the Current Source App

Prepare SDK 0.21.0, matching Kit/Runtime, and development archives for source adapter 0.5.0. Reuse the App's host-bound client:

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

The source adapter returns LanguageModelV4 and is not the AI SDK 6 pairing. Execution also requires the App's AIConfig, declarations, and valid current session. The adapter does not provide credentials, model readiness, or an authorization bypass.

## Other Entry Points

Use public AI runner, Runtime, and AI utility subpaths within their contracts. The retired `@nimiplatform/sdk/ai-provider` subpath does not forward to an adapter.

OpenAI-compatible supplies only the subset explicitly supported in source. There is no published package, and it cannot create a private Runtime connection or bypass capability validation.

## Source Basis

- [`sdks/typescript/adapters/vercel-ai/package.json`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/package.json)
- [`sdks/typescript/adapters/vercel-ai/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/index.ts)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
