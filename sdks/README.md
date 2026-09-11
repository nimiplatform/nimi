# SDKS Core Family

`sdks/` is the active SDK family source. `sdks/typescript` is the active
TypeScript implementation of the public `@nimiplatform/sdk` package.

Retired pre-vNext TypeScript SDK source remains available only through Git
history. It is not an active package root and must not regain implementation or
authority ownership.

Current scope:

- TypeScript is the only full implementation target: Runtime, Realm, app, AI,
  agent, features, adapters, testing, and migration proofs.
- Python, Go, and Rust remain generated Runtime/Realm core only until the
  TypeScript implementation is stable.
- Generated files are produced through `sdks/generators`; do not hand-edit
  generated outputs.
- Adapter packages stay source-local/private until owner-approved public package
  names and compatibility promises are accepted.

Generation:

```bash
node sdks/generators/generate.mjs
node sdks/generators/generate.mjs --check
```

Realm OpenAPI resolution uses `config/realm-openapi-source.json`, with relative
paths resolved from the repo root. If that source is not present in a worktree,
set `NIMI_REALM_OPENAPI_PATH` to the canonical OpenAPI file before running the
generator. Realm typed-client generation fails closed when OpenAPI is
unavailable; spec tables are not REST schema fallback authority.

Conformance:

```bash
node sdks/conformance/run.mjs --language all --profile typed-core
```

The conformance runner validates generated manifest parity and generated
Runtime/Realm core behavior. TypeScript handwritten surfaces have their own
package tests and SDK matrix gates.

## Local App text tools

SDK 0.12.0 exposes `createNimiLocalAppTextModel` from `@nimiplatform/sdk/ai`.
It binds the common `NimiAiModel` interface to a protected App client's `ai`
surface. It supports function tools, ordered assistant output and tool results,
tool choice, and a structured `responseFormat`. The App's AIConfig selects a
compatible execution configuration; requests contain no provider or model
identity. Kit 0.8.0 and the matching Runtime contract are required.

```ts
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';

export function requestSearch(client: NimiLocalAppClient, signal: AbortSignal) {
  return createNimiLocalAppTextModel(client.ai).generateText({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Find sources about trees.' }] }],
    tools: [{
      name: 'search',
      description: 'Search for sources.',
      inputSchema: {
        type: 'object', properties: { query: { type: 'string' } },
        required: ['query'], additionalProperties: false,
      },
    }],
    toolChoice: 'required',
    signal,
  });
}
```

The result contains complete tool calls. The caller executes its fixed handlers
after a successful step, preserves `outputItems` in ordered `turnItems`, appends
the corresponding `tool-result` entries, and explicitly requests the next step.
`generateText` collects the same cancellable stream as `streamText`; neither
method owns a multi-step workflow. Missing terminal events, invalid tool calls
and interrupted streams fail without manufacturing a result.

Direct App callers can use `ai.scenario.execute({ type: 'text-generate', ... })`
or `ai.text.streamTurn(...)`. Custom Host carriers can reuse the public text
input/output validators and feature-client constructors from
`@nimiplatform/sdk/app`. Migrate exhaustive stream matches for `tool-call`,
`tool-calls` and the required delta `itemIndex`; the text-candidate input stays
narrow. Input is limited to 128 messages, 64 function tools and 1 MiB, with a
256 KiB output bound. Partial structured text is display-only until a successful
terminal result passes the caller's declared response schema.

## Locate objects in a local image

An App with `runtime.consume` can upload an image and run `vision.locate`
through its host-bound `NimiLocalAppClient`. The machine owner first installs
the model and dependencies, selects a compatible Locate Loadout in Desktop,
and configures the App's `vision.locate` intent as Local. The App does not
select a provider, model, implementation, or Worker endpoint in its request.

```ts
import {
  createNimiLocalAppRuntimeScenarioJobClient,
  type NimiLocalAppClient,
} from '@nimiplatform/sdk/app';
import { runNimiRuntimeScenarioJob } from '@nimiplatform/sdk/runtime';
import {
  ExecutionMode, ScenarioType, VisionLocateGeometry,
} from '@nimiplatform/sdk/runtime/generated';

export async function locateImage(
  client: NimiLocalAppClient,
  appId: string,
  image: File,
  query: string,
  geometry: 'box' | 'point' = 'box',
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const mimeType = image.type;
  if (mimeType !== 'image/png' && mimeType !== 'image/jpeg'
    && mimeType !== 'image/webp' && mimeType !== 'image/gif') {
    throw new Error('Choose a static PNG, JPEG, WebP, or GIF image.');
  }
  const uploaded = await client.ai.artifacts.upload({
    bytes: new Uint8Array(await image.arrayBuffer()), mimeType,
  });
  signal?.throwIfAborted();
  const result = await runNimiRuntimeScenarioJob({
    ai: createNimiLocalAppRuntimeScenarioJobClient(client.ai),
    request: {
      head: { appId, subjectUserId: '', timeoutMs: 0 },
      scenarioType: ScenarioType.VISION_LOCATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: { spec: { oneofKind: 'visionLocate', visionLocate: {
        imageArtifactId: uploaded.artifactId, query,
        geometry: geometry === 'box' ? VisionLocateGeometry.BOX : VisionLocateGeometry.POINT,
      } } },
      requestId: '', idempotencyKey: '', labels: {}, extensions: [],
    },
    signal,
  });
  if (!result.visionLocate) throw new Error('Locate result is missing.');
  return result.visionLocate;
}
```

The runner submits, observes Job events, and reads the typed terminal Get;
it does not query artifacts for Locate output. Aborting the supplied signal
requests Runtime cancellation. A failed Job remains an error, including its
typed Runtime restart information when present; the runner never resubmits it.

The result identifies the input artifact and its width and height after EXIF
orientation. Coordinates are normalized to that complete image, with origin
at the top left. Multiply x by width and y by height, then apply the same
display transform as the image. An empty `locations` array is a successful
explicit no-match result. Labels are optional; no confidence is synthesized.

Inputs are limited to one static PNG, JPEG, WebP, or GIF image (32 MiB,
64 * 1024 * 1024 decoded pixels) and an 8 KiB UTF-8 query. The Job deadline
defaults to 120 seconds, including queue wait and model loading. Set
`head.timeoutMs` from 1000 to 600000 to choose a different bounded wait.

## Runtime LocalAgent boundary

Realm-backed LocalAgents use one typed workflow: a consumer supplies only a
`CharacterSourceRefV3` and request id to Runtime `MaterializeRealmSource`.
Runtime privately owns the Realm grant lifecycle, Packet v3 acquisition,
current-key verification, and atomic immutable SnapshotV2 plus LocalAgent
commit. Public consumers cannot create a LocalAgent outside that materialization.

Public consumers receive only the strict SDK projections
`NimiRuntimeAgentSourceContextStatus` and
`NimiRuntimeAgentTurnContextSummary`. Unknown or partial schemas, enums,
coverage, lanes, budgets, truncation, hashes, or identity correlations fail
closed. These projections never carry raw source/world text, prompts, lane
content, transcript text, private memory, packet proof, provider payloads, or
tool arguments/results.

LocalAgent turns accept exactly one current-user text message. Callers cannot
submit a system prompt, world/context attachment, execution binding, media
payload, assistant/tool history, or additional message. Generic app AI prompt
support is a separate SDK surface and is unchanged.
