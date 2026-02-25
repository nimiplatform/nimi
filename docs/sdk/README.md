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
| `@nimiplatform/ai-provider` | Vercel AI SDK v6 provider | runtime, types |

## Quick Start

```ts
import { createNimiClient } from '@nimiplatform/sdk';

const client = createNimiClient({
  appId: 'my_app',
  realm: { baseUrl: 'https://api.nimi.xyz' },     // optional
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  }, // optional
});
```

- `appId` is required.
- `realm` and `runtime` — at least one must be provided.
- Initialization failure returns a structured `NimiError`, never a raw string.

## Import Conventions

**Recommended:**

```ts
// Aggregated entry (quick start)
import { createNimiClient } from '@nimiplatform/sdk';

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
const result = await client.runtime.ai.generate({
  appId: 'my_app',
  subjectUserId: 'usr_1',
  modelId: 'chat/default',
  modal: 'text',
  input: [{ role: 'user', content: 'hello' }],
  routePolicy: 'local-runtime',
  timeoutMs: 30000,
  idempotencyKey: crypto.randomUUID(),
});

// Streaming
const stream = client.runtime.ai.streamGenerate({
  appId: 'my_app',
  subjectUserId: 'usr_1',
  modelId: 'chat/default',
  modal: 'text',
  input: [{ role: 'user', content: 'tell me a joke' }],
  routePolicy: 'token-api',
  fallback: 'deny',
  timeoutMs: 120000,
  idempotencyKey: crypto.randomUUID(),
});
```

Route policies: `local-runtime` | `token-api`. Fallback is `deny` by default.

Runtime transport profiles:

- `node-grpc`: trusted process direct runtime access.
- `tauri-ipc`: renderer -> tauri rust bridge -> runtime.

### Vercel AI SDK Integration

```ts
import { createNimiAiProvider } from '@nimiplatform/ai-provider';
import { generateText, streamText, embed } from 'ai';

const nimi = createNimiAiProvider({
  runtime: client.runtime,
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
const task = await client.runtime.workflow.submit({
  appId: 'my_app',
  subjectUserId: 'usr_1',
  definition: workflowDef,
  idempotencyKey: crypto.randomUUID(),
});

const status = await client.runtime.workflow.get({ taskId: task.taskId });
await client.runtime.workflow.cancel({ taskId: task.taskId });

// Subscribe to progress events
const stream = client.runtime.workflow.subscribeEvents({ taskId: task.taskId });
```

### Model Management

```ts
const models = await client.runtime.model.list();
await client.runtime.model.pull({ modelId: 'llama3' });
```

### App Authorization

```ts
// Authorize an external principal
await client.runtime.appAuth.authorizeExternalPrincipal({
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

Realm APIs are generated from OpenAPI spec:

```ts
// Authentication
await client.realm.auth.login({ ... });

// Social
const friends = await client.realm.social.getFriends({ userId });

// Economy
await client.realm.economy.sendGift({ ... });

// Real-time events
client.realm.realtime.on('message', (event) => { ... });
```

## Error Handling

All errors are structured:

```ts
type NimiError = {
  reasonCode: string;
  actionHint: string;
  traceId: string;
  retryable: boolean;
  source: 'realm' | 'runtime' | 'sdk';
};
```

See [Error Codes](../error-codes.md) for the complete dictionary.

## Version Strategy

- **strict-only** — only the current `0.x` release line is supported
- Cross-major or cross-minor version combinations are `Not supported`
- Breaking changes only via major version bump
- Experimental APIs live under `@nimiplatform/sdk/experimental/*` and expire after 2 minor versions
