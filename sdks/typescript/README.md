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

SDK 0.13.0's Local App binding supports function tools, tool choice,
structured `responseFormat` and user image parts with Kit/native 0.9.0 and a
matching Runtime. HTTP(S) image file parts and owned image `artifact-ref` parts
preserve their order with text. Upload local image bytes through
`client.ai.artifacts.upload`; do not put file paths or data URLs in model
requests. SDK 0.12.0 / Kit 0.8.0 retain their text-only binding. Other media
methods have separate contracts, and each selected execution configuration
must support the requested modality and controls.

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

For Vercel AI SDK 6 Apps, `@nimiplatform/sdk-adapter-vercel-ai` 0.1.0 provides
`createNimiLocalAppVercelLanguageModel({ ai: client.ai })` for `streamText` and
the existing UI/tool-loop protocol. Read its package README before mapping
images or conversation history; preserve text/tool provider metadata for opaque
continuity. It uses SDK 0.13.0 and the matched Kit/native carrier above.

Source and issue reporting: [nimiplatform/nimi](https://github.com/nimiplatform/nimi).
Include the selected SDK, Kit, App Tools and Runtime versions, the actual App
operation, expected/observed behavior, and a bounded reproduction.

Licensed under [Apache-2.0](LICENSE).
