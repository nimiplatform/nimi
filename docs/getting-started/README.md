# Getting Started

This guide gets `nimi-runtime` running and verifies a full request path in a few minutes.

## Prerequisites

- Go `1.24+`
- A terminal with access to this repository
- For SDK examples: Node.js `24+` and pnpm `10+`
- Optional: cloud provider endpoint (OpenAI-compatible via LiteLLM/adapters)

## 1. Start the Runtime

```bash
cd runtime
go run ./cmd/nimi serve
```

Default endpoints:

- gRPC: `127.0.0.1:46371`
- HTTP health: `127.0.0.1:46372`

You can also build and run as a single binary:

```bash
cd runtime
go build -o nimi ./cmd/nimi
./nimi serve
```

## 2. Check Runtime Health

In a new terminal:

```bash
cd runtime
go run ./cmd/nimi health --source grpc
go run ./cmd/nimi providers --source grpc
go run ./cmd/nimi audit events --page-size 10 --json
```

HTTP health endpoints:

```bash
curl http://127.0.0.1:46372/livez
curl http://127.0.0.1:46372/readyz
curl http://127.0.0.1:46372/v1/runtime/health
```

## 3. Make Your First AI Call

### Via CLI (Go)

```bash
cd runtime
go run ./cmd/nimi run local/qwen2.5 --prompt "hello runtime" --json
```

For streaming:

```bash
go run ./cmd/nimi chat local/qwen2.5 --prompt "write a short poem" --json
```

### Via SDK (TypeScript)

Install:

```bash
pnpm add @nimiplatform/sdk
```

Run a quick test:

```ts
import { createNimiClient } from '@nimiplatform/sdk';
import { FallbackPolicy, Modal, RoutePolicy } from '@nimiplatform/sdk/runtime';

const client = createNimiClient({
  appId: 'my_app',
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const result = await client.runtime!.ai.generate(
  {
    appId: 'my_app',
    subjectUserId: 'local-user',
    modelId: 'local/qwen2.5',
    modal: Modal.TEXT,
    input: [{ role: 'user', content: 'Hello from SDK!' }],
    routePolicy: RoutePolicy.LOCAL_RUNTIME,
    fallback: FallbackPolicy.DENY,
    timeoutMs: 30000,
  },
  {
    idempotencyKey: crypto.randomUUID(),
  },
);

console.log(JSON.stringify(result.output, null, 2));
```

### Via Vercel AI SDK

Install:

```bash
pnpm add @nimiplatform/sdk @nimiplatform/sdk/ai-provider ai
```

```ts
import { createNimiClient } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { generateText } from 'ai';

const client = createNimiClient({
  appId: 'my_app',
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
});

const nimi = createNimiAiProvider({
  runtime: client.runtime!,
  appId: 'my_app',
  subjectUserId: 'local-user',
  routePolicy: 'local-runtime',
  fallback: 'deny',
});

const { text } = await generateText({
  model: nimi.text('local/qwen2.5'),
  prompt: 'What is the Nimi platform?',
});

console.log(text);
```

## 4. Verify Core Control Planes (Optional)

Auth + App Auth:

```bash
cd runtime

go run ./cmd/nimi auth register-app \
  --app-id nimi.desktop \
  --app-instance-id desktop-dev \
  --app-mode full \
  --runtime-required \
  --realm-required \
  --world-relation none \
  --capability runtime.ai.generate \
  --capability runtime.model.list \
  --json

go run ./cmd/nimi auth register-external \
  --app-id nimi.desktop \
  --external-principal-id openclaw-agent \
  --external-type agent \
  --proof-type ed25519 \
  --json

go run ./cmd/nimi app-auth authorize \
  --domain app-auth \
  --app-id nimi.desktop \
  --external-principal-id openclaw-agent \
  --external-type agent \
  --subject-user-id local-user \
  --consent-id consent-001 \
  --consent-version v1 \
  --policy-version v1 \
  --policy-mode preset \
  --preset delegate \
  --scope runtime.ai.generate \
  --ttl-seconds 3600 \
  --scope-catalog-version sdk-v1 \
  --json
```

Knowledge + App messaging:

```bash
go run ./cmd/nimi knowledge build \
  --app-id nimi.desktop \
  --subject-user-id local-user \
  --index-id chat-index \
  --source-kind messages \
  --source-uri memory://chat/1 \
  --json

go run ./cmd/nimi app send \
  --from-app-id app.writer \
  --to-app-id app.reader \
  --subject-user-id local-user \
  --message-type note.created \
  --json
```

## 5. Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `NIMI_RUNTIME_GRPC_ADDR` | `127.0.0.1:46371` | gRPC listen address |
| `NIMI_RUNTIME_HTTP_ADDR` | `127.0.0.1:46372` | HTTP health/metrics listen |
| `NIMI_RUNTIME_SHUTDOWN_TIMEOUT` | `10s` | Graceful shutdown timeout |
| `NIMI_RUNTIME_LOCAL_AI_BASE_URL` | — | Local AI provider endpoint |
| `NIMI_RUNTIME_CLOUD_LITELLM_BASE_URL` | — | Cloud LiteLLM endpoint |
| `NIMI_RUNTIME_AI_HEALTH_INTERVAL` | `8s` | Provider health probe interval |
| `NIMI_RUNTIME_AI_HTTP_TIMEOUT` | `30s` | Provider probe timeout |
| `NIMI_RUNTIME_MODEL_REGISTRY_PATH` | `~/.nimi/runtime/model-registry.json` | Model registry persistence path |
| `NIMI_RUNTIME_ENABLE_WORKERS` | `false` | Enable worker subprocesses |

## Next

- [Code Examples](../examples/) for runnable SDK and CLI examples
- [SDK Reference](../sdk/) for full `@nimiplatform/sdk` API guide
- [Runtime Reference](../runtime/) for CLI command surface and behavior
- [Architecture](../architecture/) for system-level design
- [Error Codes](../error-codes.md) for structured error dictionary
