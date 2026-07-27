# Adapters

SDK vNext keeps framework adapters outside the base `@nimiplatform/sdk`
package. Adapters are migration bridges and framework projections; they do not
own Runtime routing, Realm truth, or SDK core API semantics.

The old `@nimiplatform/sdk/ai-provider` subpath is removed. It must fail
closed instead of forwarding to a vNext adapter.

## Current Adapter Posture

| Adapter | Package / boundary | Role |
| --- | --- | --- |
| Vercel AI | `@nimiplatform/sdk-adapter-vercel-ai` | Maps Vercel Language Model calls onto Nimi AI/runtime semantics |
| OpenAI-compatible | SDK adapter source root under `sdks/typescript/adapters/openai-compatible` | Migration bridge for OpenAI-compatible chat completion shapes |
| MCP / Next / React / LangGraph / LlamaIndex / Mastra | Adapter source roots under `sdks/typescript/adapters/*` | Integration projections, not base SDK subpaths |

An adapter may depend on `@nimiplatform/sdk/ai`, `@nimiplatform/sdk/ai-runner`,
`@nimiplatform/sdk/runtime`, or feature modules. It may not reintroduce removed
base SDK subpaths.

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

## Reader Scenario: Vercel AI Migration

An app using Vercel AI should install the independent adapter package and keep
the base SDK dependency explicit:

```ts
import { createNimiVercelAiModel } from '@nimiplatform/sdk-adapter-vercel-ai';
import { createNimiClient } from '@nimiplatform/sdk';
```

The adapter maps Vercel call shapes onto Nimi's AI/runtime surface. Runtime
still owns routing and execution. The adapter owns only framework projection.

## Reader Scenario: OpenAI-Compatible Bridge

An app with OpenAI-compatible chat-completion call sites can migrate through
the OpenAI-compatible adapter boundary. That bridge preserves the compatibility
shape only where it is explicitly supported. Unsupported OpenAI-compatible
features return typed failures instead of falling through to raw Runtime or
provider-native bypasses.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`config/sdks-adapter-source-roots.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-adapter-source-roots.yaml)
- [`config/sdks-typescript-adapter-capability-ledger.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-adapter-capability-ledger.yaml)
