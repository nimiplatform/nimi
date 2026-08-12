# AI Config Surface

The SDK AIConfig surface is the typed boundary for owner-scoped AI capability intent. An App records which capability contract it needs, required features, portable defaults, and a Local or Cloud execution-plane intent. Runtime owns machine configuration and implementation selection.

AIConfig is a complete current value for exactly one owner. Updates replace the whole capability list; the contract carries no revision history, execution binding, readiness, or health state.

## Current Public Pieces

| Piece | Public path | What it does |
| --- | --- | --- |
| AIConfig types | `@nimiplatform/sdk` or `@nimiplatform/sdk/ai` | Exposes `NimiCapabilityAIConfig` and `NimiCapabilityAIConfigIntent` |
| App owner helper | `@nimiplatform/sdk/ai` | Creates the explicit App owner assertion from an App ID |
| App AIConfig client | `@nimiplatform/sdk/ai` | Reads or overwrites the complete Runtime-owned App AIConfig |
| Agent Center AIConfig section | `@nimiplatform/kit/features/agent-center` | Presents owner-scoped Local or Cloud capability intent |

## Capability Intent

Each capability entry contains:

| Field | Meaning |
| --- | --- |
| `capabilityContract` | The requested capability contract, such as `text.generate` |
| `requiredFeatures` | Features the selected Runtime implementation must support |
| `defaults` | Portable scenario defaults, not machine or provider configuration |
| Local or Cloud intent | The consumer's intended execution plane |

Local intent contains no implementation identity, machine selection, asset, binding, Driver state, readiness, or health. Apps also omit optional generated wire fields that would attempt to select a Cloud implementation or provider-model target.

## App Integration Flow

1. Create a Nimi client with the exact App ID.
2. Create the typed App AIConfig client over `client.runtime`.
3. Read the current whole-object config.
4. Overwrite the complete capability list when the owner changes intent.
5. Submit AI work through the normal SDK feature surface using identity, content, and supported parameters.

```ts
import {
  createNimiAppAIConfigClient,
  createNimiClient,
} from '@nimiplatform/sdk';

const client = createNimiClient({ appId: 'example.sdk.hello' });
const aiConfig = createNimiAppAIConfigClient({
  appId: 'example.sdk.hello',
  runtime: client.runtime,
});

await aiConfig.overwrite([{
  capabilityContract: 'text.generate',
  requiredFeatures: [],
  route: {
    oneofKind: 'local',
    local: {},
  },
}]);
```

The owner in the request is a consistency assertion. Runtime still derives authenticated account and App identity from transport context.

See [First AI Call](/sdk/first-ai-call) for the execution shape. AI requests do not resolve capability intent into a model, route, connector, target reference, or fallback policy.

## Fail-Closed Behavior

The SDK rejects malformed App IDs, owner mismatches, missing returned config, and non-array overwrite input. Runtime rejects missing intent, unauthorized Cloud use, unsupported capability requirements, and unavailable execution through typed errors at the owning operation.

Apps should preserve those errors. They must not substitute `auto`, hardcode a provider or model, build a local ranking, or bypass Runtime through App-owned REST.

## Runtime Ownership

Machine configuration, installed assets, Driver state, readiness, health, and execution diagnostics remain Runtime facts. Diagnostic output can explain a completed or failed call, but it does not grant the App request-side implementation control.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core/ai/config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/config.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
- [`apps/tester/src/tester/tester-run-target.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/tester/src/tester/tester-run-target.ts)
