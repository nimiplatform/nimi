# Adapters

SDK framework adapters stay outside the base `@nimiplatform/sdk` package.
Adapters are framework projections; they do not own Runtime routing, Realm
truth, or SDK core API semantics.

The old `@nimiplatform/sdk/ai-provider` subpath is removed. It must fail
closed instead of forwarding to an adapter.

## Current Adapters

| Adapter | Distribution | Role |
| --- | --- | --- |
| Vercel AI SDK 6 | npm package `@nimiplatform/sdk-adapter-vercel-ai` | Maps Vercel language-model calls onto an App's host-bound AI client |
| OpenAI-compatible | Source only, under `sdks/typescript/adapters/openai-compatible`; not published as a package | Maps OpenAI-compatible chat-completion shapes onto Nimi AI semantics |

An adapter release declares the `@nimiplatform/sdk` versions it works with as
a peer dependency range. Before adding one, check that the release you install
covers the SDK version your App uses. `@nimiplatform/sdk-adapter-vercel-ai`
0.1.0 declares `@nimiplatform/sdk` `^0.13.0`, so it does not pair with SDK
0.14 or later.

An adapter may depend on `@nimiplatform/sdk/ai`, `@nimiplatform/sdk/ai-runner`,
`@nimiplatform/sdk/runtime`, or feature modules. It may not reintroduce removed
base SDK subpaths.

Additional framework or protocol adapters are added only for a concrete
consumer. A source directory or capability ledger row does not by itself make
an adapter a current public product surface.

## Boundary

| Concern | Owner |
| --- | --- |
| Runtime routing, provider readiness, audit | Runtime |
| SDK core AI request/response semantics | `@nimiplatform/sdk/ai` |
| AI runner orchestration semantics | `@nimiplatform/sdk/ai-runner` |
| Framework call-shape mapping | Adapter package |
| OpenAI-compatible request/response bridge | OpenAI-compatible adapter boundary |

Adapters fail closed on unsupported framework features. They must not fabricate
success, invent provider capability, or bypass Runtime readiness.

## Reader Scenario: Vercel AI SDK In A Nimi App

An App built on Vercel AI SDK 6 keeps Vercel's streaming and caller-owned tool
loop and hands the model its host-bound AI client:

```ts
import { stepCountIs, streamText } from 'ai';
import { createNimiLocalAppVercelLanguageModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

const model = createNimiLocalAppVercelLanguageModel({ ai: getNimiLocalAppClient().ai });
const result = streamText({
  model,
  prompt: 'Summarize this note in three points.',
  stopWhen: stepCountIs(5),
});
```

The adapter maps Vercel call shapes onto the App's AI client. Runtime still
owns routing and execution, and the App's AIConfig selects Local or Cloud.
The App keeps its tool callbacks and state. The adapter package README covers
image input and conversation history.

## Reader Scenario: OpenAI-Compatible Call Shapes

The OpenAI-compatible bridge exists as source in this repository and is not
published as a package, so an App cannot install it. Its design preserves the
compatibility shape only where it is explicitly supported; unsupported
OpenAI-compatible features return typed failures instead of falling through to
raw Runtime or provider-native bypasses.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`sdks/typescript/adapters/vercel-ai/README.md`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/adapters/vercel-ai/README.md)
