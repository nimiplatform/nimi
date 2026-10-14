# Nimi SDK Family

The `sdks/` directory contains the official SDK implementations for the Nimi platform. The primary, full-featured implementation is the TypeScript SDK in `sdks/typescript`, distributed as `@nimiplatform/sdk`.

## Language Ecosystem

- **TypeScript (`sdks/typescript`)**: The primary full implementation covering Runtime, Realm, local apps, AI models, Agent participation, feature modules, adapters (e.g. Vercel AI SDK), and testing suites.
- **Python, Go, Rust (`sdks/{python,go,rust}`)**: Generated typed Runtime and Realm core clients that maintain wire-protocol compatibility.
- **Code Generation (`sdks/generators`)**: Automated generator tools that produce typed definitions from gRPC protobuf and OpenAPI schemas. Do not edit generated files manually.
- **Adapters**: Framework adapters distributed as dedicated packages with independent release lifecycles (see the [Vercel AI SDK adapter](typescript/adapters/vercel-ai/README.md)).

### Code Generation & Conformance

```bash
# Run code generation
node sdks/generators/generate.mjs

# Verify generated code parity
node sdks/generators/generate.mjs --check

# Run multi-language conformance suite
node sdks/conformance/run.mjs --language all --profile typed-core
```

> [!NOTE]
> Realm OpenAPI generation reads `config/realm-openapi-source.json` from the repository root, or respects the `NIMI_REALM_OPENAPI_PATH` environment variable. Generation fails closed if the canonical OpenAPI schema is missing.

---

## Local App Text Tools & Structured Outputs

The `createNimiLocalAppTextModel` utility (from `@nimiplatform/sdk/ai`) connects the standard `NimiAiModel` interface to an app's protected AI client. It supports model tool calls, ordered assistant and tool outputs, tool selection, and schema-constrained responses. The app's committed AIConfig selects the execution backend, keeping provider and model specifics out of app requests.

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
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
    }],
    toolChoice: 'required',
    signal,
  });
}
```

### Stream & Tool Execution Rules

- **Execution Flow**: After each step, callers execute tool handlers, append matching `tool-result` items, preserve `outputItems` within `turnItems`, and request the next turn.
- **Reasoning Continuity**: Opaque `reasoning-continuity` items required by specific adapters must retain their exact order and byte payloads without client decoding.
- **Payload Limits**: Requests are bounded by 128 messages, 64 function tools, and a 1 MiB total payload size. Stream payloads use 64 KiB chunk bounds, and outputs are limited to 256 KiB.
- **Cancellation & Failure**: Streams can be aborted via `AbortSignal`. Missing terminal events, schema violations, or interrupted streams fail closed rather than synthesizing fallback responses.

---

## Locate Objects in an Image (`vision.locate`)

Apps with `runtime.consume` permission can locate objects in images using `vision.locate` via the host-bound `NimiLocalAppClient`. On the local machine, the owner installs the model, selects a Locate Loadout in Desktop, and configures the app's `vision.locate` intent as Local:

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
    bytes: new Uint8Array(await image.arrayBuffer()),
    mimeType,
  });
  signal?.throwIfAborted();
  const result = await runNimiRuntimeScenarioJob({
    ai: createNimiLocalAppRuntimeScenarioJobClient(client.ai),
    request: {
      head: { appId, subjectUserId: '', timeoutMs: 0 },
      scenarioType: ScenarioType.VISION_LOCATE,
      executionMode: ExecutionMode.ASYNC_JOB,
      spec: {
        spec: {
          oneofKind: 'visionLocate',
          visionLocate: {
            imageArtifactId: uploaded.artifactId,
            query,
            geometry: geometry === 'box' ? VisionLocateGeometry.BOX : VisionLocateGeometry.POINT,
          },
        },
      },
      requestId: '',
      idempotencyKey: '',
      labels: {},
      extensions: [],
    },
    signal,
  });
  if (!result.visionLocate) throw new Error('Locate result is missing.');
  return result.visionLocate;
}
```

### Operational Constraints

- **Input Constraints**: Accepts one static image (PNG, JPEG, WebP, GIF) up to 32 MiB and 64 million decoded pixels, paired with a UTF-8 query up to 8 KiB.
- **Normalized Coordinates**: Returned bounding boxes or point coordinates are normalized (0.0 to 1.0) relative to the full image dimensions (accounting for EXIF orientation).
- **Timeouts**: The protected App Job bridge requires `head.timeoutMs: 0` and rejects caller-selected business deadlines. To stop a job early, trigger cancellation and observe the Job's actual terminal state.

---

## Runtime LocalAgent Boundaries

LocalAgents instantiated from Realm character sources follow a strictly verified workflow:
1. **Materialization**: Callers pass a `CharacterSourceRefV3` and request ID to Runtime's `MaterializeRealmSource`. Runtime handles Realm grants, Packet v3 validation, key checks, and atomic snapshot commits.
2. **Strict Projections**: Source and turn-context inspection returns typed `NimiRuntimeAgentSourceContextStatus` and `NimiRuntimeAgentTurnContextSummary` projections, while other authorized Agent operations return their own bounded results. Sensitive internal states—such as raw prompts, private memory internals, and provider payloads—remain strictly hidden.
3. **Turn Invariants**: A managed Conversation turn accepts only admitted user input (including images when supported by the selected capability). Callers cannot inject system prompts, context overrides, or arbitrary tool attachments into managed LocalAgent turns.

---

## Work in Progress & Source-Only Capabilities

The following capabilities exist in source contracts but are not yet part of public stable releases:

- **World Creator Operations (`NimiLocalAppClient.realm.worldCore`)**: Covers world and character management (`create`, `replace`, `listEntities`, `createEntity`, `listRelationships`, `getRelationship`). Requires `realm.data` permission and the account's applicable creator or maintenance eligibility; call `getCreationEligibility()` before offering world creation in your UI.
- **Video Reference Audio**: Text-to-Video models (e.g. Wan 2.7) accepting optional reference audio URLs (WAV/MP3, 2–30s, up to 15 MB). Source-level contract support does not imply published package or live provider availability.
