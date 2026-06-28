# First AI Call

This page shows the shortest public SDK path for a third-party app to call
Runtime-backed text generation without crossing Runtime internals. There are
two separate checks:

1. Runtime can answer a prompt from the CLI.
2. The app can dispatch through SDK with a live AIConfig `targetRef`.

Do not skip the second check. Current Runtime-backed SDK calls fail closed
before scenario dispatch when `targetRef` is missing.

## Prerequisites

- `nimi start` is running.
- The SDK can reach Runtime at `NIMI_RUNTIME_GRPC_ENDPOINT`, or the default
  `127.0.0.1:46371`.
- The app has a signed-in Runtime account subject for routes that require user
  identity.
- The app has an AIConfig binding for the capability it wants to run. For text
  generation, the binding capability is usually `text.generate`.

Runtime endpoint variables are layer-specific:

| Variable | Read by | Purpose |
| --- | --- | --- |
| `NIMI_RUNTIME_GRPC_ENDPOINT` | The explicit sample below | App-side override when you pass `runtime.transport.endpoint` yourself |
| `NIMI_RUNTIME_ENDPOINT` | SDK Runtime client default in Node.js | App-side default when `createNimiClient` omits `runtime.transport` |
| `NIMI_RUNTIME_GRPC_ADDR` | Runtime daemon config | Daemon listen address |

Confirm Runtime readiness first:

```bash
nimi start
nimi run "What is Nimi?"
```

If that command fails, fix Runtime configuration before debugging app code.

## The Required Binding

Runtime-backed SDK dispatch needs a live `NimiAIConfigTargetRef`.

| Target kind | Required fields | Where it comes from |
| --- | --- | --- |
| `local-runtime` | `version: 'v2'` and exactly one of `profileBindingId` or `readinessRef` | Runtime local model readiness, Kit Model Config, or app AIConfig service |
| `cloud-connector` | `connectorId`, `remoteModelCatalogId`, `providerModelId` | Runtime provider connector inventory or applied AI profile |

`profile-slice` is not a live Runtime target. Materialize/apply the profile
before dispatch.

## Dispatch From AIConfig

This is the SDK-side shape an app should use after its shell or model-config
surface has loaded the app's `NimiAIConfig`.

```ts
import {
  createNimiClient,
  resolveNimiAIConfigRuntimeBinding,
  textPart,
  type NimiAIConfig,
} from '@nimiplatform/sdk';

export async function generateWithAppAIConfig(input: {
  aiConfig: NimiAIConfig;
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

  const resolved = resolveNimiAIConfigRuntimeBinding({
    config: input.aiConfig,
    capabilityId: 'text.generate',
    bindingCapabilityId: 'text.generate',
  });
  if (resolved.ok === false) {
    throw new Error(resolved.message);
  }

  const binding = resolved.binding;
  const model = client.ai.createRuntimeModel({
    model: {
      modelId: binding.model,
      ...(binding.connectorId ? { providerId: binding.connectorId } : {}),
    },
    routePolicy: binding.routePolicy,
    connectorId: binding.connectorId,
    subjectUserId: input.runtimeSubjectUserId,
    timeoutMs: 120_000,
    targetRef: binding.targetRef,
    metadata: binding.metadata,
  });

  return await model.generateText({
    model: model.model,
    messages: [{
      role: 'user',
      content: [textPart(input.prompt)],
    }],
  });
}
```

The failure branch also includes a typed `reason` field. Use `message` for a
human-readable error, and use `reason` when the app needs to branch on
`target-ref-missing`, `binding-capability-missing`, or another fail-closed
state.

The app is responsible for loading `aiConfig` from its app-owned AIConfig
service. In generated Nimi App scaffolds and `apps/tester/`, the Kit
model-config surface owns the UI flow that lets a developer choose or apply a
Runtime model binding.

## Direct TargetRef Calls

Direct calls are valid only when the app already received a live target ref
from Runtime inventory, model-config, or an applied AI profile:

```ts
const model = client.ai.createRuntimeModel({
  model: { modelId: binding.model },
  routePolicy: binding.routePolicy,
  subjectUserId: runtimeSubjectUserId,
  targetRef: binding.targetRef,
});
```

Do not invent the target ref in product code. The target ref is the proof that
Runtime can route to the selected local model or cloud connector.

## What The App Should Not Do

- Do not import from `runtime/internal/**`.
- Do not call provider SDKs directly as a Nimi Runtime substitute.
- Do not hardcode provider or model defaults outside the user or Runtime
  configuration surface.
- Do not call `createRuntimeModel` without a live `targetRef`.
- Do not treat CLI success as proof that the app has an AIConfig binding.

## Common Fail-Closed States

| Symptom | Meaning | Fix |
| --- | --- | --- |
| `SDK_CLIENT_APP_ID_REQUIRED` or `provide_runtime_ai_app_id` | The client or operation did not provide app identity. | Pass `appId` to `createNimiClient` or to `createRuntimeModel`. |
| `resolve_runtime_target_ref_before_invocation` | SDK dispatch did not receive a live target ref. | Resolve the app AIConfig binding before `createRuntimeModel` dispatch. |
| `profile-slice-unmaterialized` | AIConfig still points to a profile slice, not a live Runtime target. | Apply/materialize the profile through the app's model-config flow. |
| Runtime connection error | The daemon is not reachable at the configured gRPC endpoint. | Start Runtime and verify the endpoint passed to `runtime.transport.endpoint`; if you omit transport, verify `NIMI_RUNTIME_ENDPOINT`. |
| Local route has no ready model | Runtime cannot resolve the selected local runtime target. | Install or select a local text model, then verify with `nimi run`. |
| Cloud route has no provider | Runtime does not have the requested provider connector configured. | Configure the provider in Runtime before using a cloud connector target. |

## Verification

For repository development, keep the relevant SDK and scaffold checks green:

```bash
pnpm --filter @nimiplatform/sdk test
pnpm --filter @nimiplatform/app-tools test
pnpm --filter @nimiplatform/tester test
```

For an app repository, verify in this order:

```bash
nimi run "What is Nimi?"
pnpm run validate
pnpm run doctor
```

Then run one app-owned generation path that loads AIConfig and dispatches with
`targetRef`.

## Source Basis

- [`sdks/typescript/core/ai/runtime-model.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-model.ts)
- [`sdks/typescript/core/ai/runtime-target-ref.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/runtime-target-ref.ts)
- [`sdks/typescript/core/ai/config-runtime-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config-runtime-binding.ts)
- [`sdks/typescript/runtime/index.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/index.ts)
- [`runtime/internal/config/load.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/config/load.go)
- [`runtime/internal/config/types.go`](https://github.com/nimiplatform/nimi/blob/main/runtime/internal/config/types.go)
- [`apps/tester/src/tester/tester-runtime-invokers-core.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-runtime-invokers-core.ts)
- [`apps/tester/test/tester-contract/runtime-invokers.mjs`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/test/tester-contract/runtime-invokers.mjs)
