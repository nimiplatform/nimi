# Nimi SDK

`@nimiplatform/sdk` is the unified developer interface for building apps on the Nimi platform.

## Installation

```bash
pnpm add @nimiplatform/sdk
```

## Package Structure

| Package | Purpose | Depends On |
|---------|---------|------------|
| `@nimiplatform/sdk` | Aggregated facade entry | realm, runtime, types |
| `@nimiplatform/sdk/realm` | Realm HTTP/WS client | types |
| `@nimiplatform/sdk/runtime` | Runtime gRPC client | types |
| `@nimiplatform/sdk/types` | Shared type definitions | — |
| `@nimiplatform/sdk/ai-provider` | Vercel AI SDK v6 provider | runtime, types |

## Quick Start

```ts
import { Realm, Runtime } from '@nimiplatform/sdk';

const realm = new Realm({
  baseUrl: 'https://api.nimi.xyz',
});

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});
```

- `Runtime` requires `appId` and `transport`.
- `Realm` requires `baseUrl`.
- Construction and call failures return structured `NimiError` values.

## Runtime + Realm Orchestration Recipes (A/B/C/D)

SDK keeps `Runtime` and `Realm` independent. Cross-system flow is composed explicitly in app code.

### Pattern A: Realm -> Runtime

```ts
const grant = await realm.raw.request<{ token: string; version: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: { appId, subjectUserId, scopes },
});

const out = await runtime.ai.text.generate({
  model: 'chat/default',
  input: 'hello',
  metadata: {
    realmGrantToken: grant.token,
    realmGrantVersion: grant.version,
  },
});
```

### Pattern B: Runtime -> Realm

```ts
const media = await runtime.media.video.generate({
  model: 'video/default',
  prompt: 'short teaser',
});

await realm.posts.create({
  content: 'new clip',
  attachments: media.artifacts.map((artifact) => ({
    uri: artifact.uri,
    mimeType: artifact.mimeType,
  })),
  traceId: media.trace.traceId,
});
```

### Pattern C: Dual Preflight

```ts
const [policy, health] = await Promise.all([
  realm.raw.request<{ allowed: boolean }>({
    method: 'POST',
    path: '/api/auth/policy/check',
    body: { appId, subjectUserId, action: 'ai.generate' },
  }),
  runtime.health(),
]);

if (!policy.allowed) throw new Error('AUTH_DENIED');
if (health.status !== 'healthy') throw new Error('RUNTIME_UNAVAILABLE');
```

### Pattern D: Independent Lifecycle + Explicit Bridge

```ts
await runtime.connect();
await runtime.ready();
await realm.connect();
await realm.ready();

const grant = await realm.raw.request<{ token: string; version: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: { appId, subjectUserId, scopes },
});

const out = await runtime.ai.text.generate({
  model: 'chat/default',
  input: 'hello',
  metadata: {
    realmGrantToken: grant.token,
    realmGrantVersion: grant.version,
  },
});

await realm.posts.create({
  content: out.text,
  traceId: out.trace.traceId,
});

await runtime.close();
await realm.close();
```

## Import Conventions

**Recommended:**

```ts
// Aggregated entry
import { Runtime, Realm } from '@nimiplatform/sdk';

// Sub-path imports (production, cleaner dependency boundaries)
import { ... } from '@nimiplatform/sdk/realm';
import { ... } from '@nimiplatform/sdk/runtime';
import { ... } from '@nimiplatform/sdk/types';
```

**Forbidden:**

```ts
// Never import internal paths
import { ... } from '@nimiplatform/sdk/internal/...';
import { ... } from '@nimiplatform/sdk/generated/...';
```

## Runtime APIs

### AI Inference

```ts
// Unary
const result = await runtime.ai.text.generate({
  model: 'chat/default',
  subjectUserId: 'usr_1',
  input: 'hello',
  route: 'local-runtime',
  fallback: 'deny',
  timeoutMs: 30000,
});

// Streaming
const streamResult = await runtime.ai.text.stream({
  model: 'chat/default',
  subjectUserId: 'usr_1',
  input: 'tell me a joke',
  route: 'token-api',
  fallback: 'deny',
  timeoutMs: 120000,
});

for await (const part of streamResult.stream) {
  if (part.type === 'delta') process.stdout.write(part.text);
}
```

Route policies: `local-runtime` | `token-api`. Fallback is `deny` by default.

Runtime transport profiles:

- `node-grpc`: trusted process direct runtime access.
- `tauri-ipc`: renderer -> tauri rust bridge -> runtime.

### Vercel AI SDK Integration

```ts
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { generateText, streamText, embed } from 'ai';

const nimi = createNimiAiProvider({
  runtime,
  appId: 'my_app',
  subjectUserId: 'usr_1',
});

// Text generation
const { text } = await generateText({
  model: nimi('chat/default'),
  prompt: 'What is Nimi?',
});

// Streaming
const { textStream } = streamText({
  model: nimi('chat/default'),
  prompt: 'Tell me a story.',
});

// Embedding
const { embedding } = await embed({
  model: nimi.embedding('default'),
  value: 'search query',
});
```

### Workflow DAG

For multi-model pipelines — don't chain `ai.generate` calls manually:

```ts
const task = await runtime.workflow.submit({
  appId: 'my_app',
  subjectUserId: 'usr_1',
  definition: workflowDef,
  idempotencyKey: crypto.randomUUID(),
});

const status = await runtime.workflow.get({ taskId: task.taskId });
await runtime.workflow.cancel({ taskId: task.taskId });

// Subscribe to progress events
const stream = runtime.workflow.subscribeEvents({ taskId: task.taskId });
```

### Model Management

```ts
const models = await runtime.model.list();
await runtime.model.pull({ modelId: 'llama3' });
```

### App Authorization

```ts
// Authorize an external principal
await runtime.appAuth.authorizeExternalPrincipal({
  domain: 'app-auth',
  appId: 'app_a',
  externalPrincipalId: 'ext_principal_1',
  externalPrincipalType: 'external-app',
  subjectUserId: 'usr_1',
  consentId: 'cons_1',
  consentVersion: '1.0',
  decisionAt: '2026-02-24T10:00:00Z',
  policyVersion: '1.0.0',
  policyMode: 'preset',
  preset: 'readOnly',
  scopes: ['app.app_a.chat.read'],
  resourceSelectors: { conversationIds: ['conv_1'] },
  ttlSeconds: 86400,
  idempotencyKey: crypto.randomUUID(),
  scopeCatalogVersion: '1.0.0',
});
```

Presets: `readOnly` | `full` | `delegate`

## Realm APIs

`Realm` keeps a stable high-frequency facade and still exposes full generated services:

- Facade: `auth/users/posts/worlds/notifications/media/search/transits`
- Generated services: `realm.services.*`

```ts
await realm.auth.passwordLogin({
  email: 'user@nimi.local',
  password: 'secret',
});

const me = await realm.users.me();

await realm.posts.create({
  content: 'hello realm',
});

// Full generated surface remains available
await realm.services.AuthService.passwordLogin({
  email: 'user@nimi.local',
  password: 'secret',
});

// Escape hatch for endpoints not wrapped by facade
const grant = await realm.raw.request<{ token: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: { appId: 'my_app' },
});
```

## Error Handling

All errors are structured:

```ts
type NimiError = {
  code: string;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: 'realm' | 'runtime' | 'sdk';
  details?: Record<string, unknown>;
};
```

See [Error Codes](../error-codes.md) for the complete dictionary.

## Version Strategy

- **strict-only** — only the current `0.x` release line is supported
- Cross-major or cross-minor version combinations are `Not supported`
- Breaking changes only via major version bump
- Experimental APIs live under `@nimiplatform/sdk/experimental/*` and expire after 2 minor versions
