# First AI Call

A Runtime-backed AI request carries app identity, subject identity, scenario content, and supported generation parameters. Runtime reads the App's saved capability intent and chooses the implementation when execution starts.

## Prerequisites

- `nimi start` is running.
- The SDK can reach Runtime at `NIMI_RUNTIME_GRPC_ENDPOINT`, or the default `127.0.0.1:46371`.
- The exact App owner has a `text.generate` AIConfig capability intent.
- Calls that need account identity have a Runtime subject user ID.

Runtime endpoint variables are layer-specific:

| Variable | Read by | Purpose |
| --- | --- | --- |
| `NIMI_RUNTIME_GRPC_ENDPOINT` | The explicit sample below | App-side override when the app supplies `runtime.transport.endpoint` |
| `NIMI_RUNTIME_ENDPOINT` | SDK Runtime client default in Node.js | App-side default when `createNimiClient` omits `runtime.transport` |
| `NIMI_RUNTIME_GRPC_ADDR` | Runtime daemon config | Daemon listen address |

Use the CLI to check the Runtime installation and public health projection:

```bash
nimi start
nimi health --json
```

## Dispatch Text Generation

```ts
import { createNimiClient, textPart } from '@nimiplatform/sdk';

export async function generateText(input: {
  runtimeSubjectUserId: string;
  prompt: string;
}) {
  const client = createNimiClient({
    appId: 'example.sdk.hello',
    runtime: {
      transport: {
        type: 'node-grpc',
        endpoint: process.env.NIMI_RUNTIME_GRPC_ENDPOINT || '127.0.0.1:46371',
      },
    },
  });

  const textGeneration = client.ai.createRuntimeModel({
    subjectUserId: input.runtimeSubjectUserId,
    timeoutMs: 120_000,
  });

  return await textGeneration.generateText({
    messages: [{
      role: 'user',
      content: [textPart(input.prompt)],
    }],
  });
}
```

The App does not send a model, route, connector, target, fallback policy, or implementation binding. The returned `modelResolved` and route diagnostics, when present, are execution evidence from Runtime rather than inputs for the next request.

## Capability Intent

AIConfig records whether an App owner intends to use the Local or Cloud execution plane for a capability. The owning service saves that intent before the call. App Access remains a separate Runtime admission fact. The generation request does not resolve AIConfig into a machine target and does not carry AIConfig as request metadata.

The same call shape works for either intent. Runtime evaluates current configuration and availability at execution time, then fails closed if it cannot honor the request.

## App Responsibilities

- Use the exact App identity that owns the saved capability intent.
- Send subject identity only when the operation requires it.
- Keep provider credentials in Runtime-owned configuration.
- Handle typed errors from the actual generation call.
- Do not import from `runtime/internal/**` or call provider SDKs as a Runtime substitute.
- Do not add request-side model, route, connector, target, fallback, readiness, or health selection.

## Common Fail-Closed States

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `SDK_CLIENT_APP_ID_REQUIRED` or `provide_runtime_ai_app_id` | The client or operation has no App identity. | Pass `appId` to `createNimiClient` or `createRuntimeModel`. |
| `AI_CONFIG_NOT_FOUND` | Runtime has no AIConfig for the exact App owner. | Save capability intent for that App identity. |
| Capability-intent or App Access error | The App has no owner-selected `text.generate` intent or lacks the required App Access. | Configure the capability through the owning AIConfig surface, or correct the App Access declaration. |
| Runtime connection error | The daemon is not reachable at the configured endpoint. | Start Runtime and verify the endpoint supplied to the SDK. |
| Execution error after dispatch | Runtime could not select or run an admitted implementation. | Inspect the typed Runtime error and returned diagnostics; do not synthesize a client-side fallback. |

## Verification

For repository development:

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/examples check
pnpm --filter @nimiplatform/tester test
```

For an App repository, run `nimi doctor`, the App's validation commands, and one App-owned generation call with the exact configured App identity.

## Source Basis

- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`sdks/typescript/core/ai/config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config.ts)
- [`sdks/typescript/runtime/config-projections.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/config-projections.ts)
- [`sdks/typescript/root-client.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/root-client.ts)
- [`apps/tester/src/tester/tester-run-target.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-run-target.ts)
- [`apps/tester/src/tester/tester-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime.ts)
