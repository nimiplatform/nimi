# AI Config Surface

The SDK AIConfig surface is the typed boundary for owner-scoped AI capability intent. An App records which capability contract it needs, required features, portable defaults, and a Local or Cloud execution-plane intent. Runtime owns machine configuration and implementation selection.

AIConfig is a complete current value for exactly one owner. Updates replace the whole capability list; the contract carries no revision history, execution binding, readiness, or health state.

## Current Public Pieces

| Piece | Public path | What it does |
| --- | --- | --- |
| App AIConfig on the App client | `client.aiConfig` on the host-bound `NimiLocalAppClient` | Reads the App's own AIConfig and effective selections, lists safe options, and overwrites it against a revision |
| AIConfig settings UI | `ModelConfigAIConfigSurface` from `@nimiplatform/kit/features/model-config` | The settings surface generated Apps render over `client.aiConfig` |
| AIConfig types | `@nimiplatform/sdk` or `@nimiplatform/sdk/ai` | Exposes `NimiCapabilityAIConfig`, `NimiCapabilityAIConfigIntent`, and the snapshot and overwrite result types |
| Owner-scoped AIConfig clients | `createNimiAppAIConfigClient` from `@nimiplatform/sdk/ai` | For a host that already holds a protected Runtime transport; not an App path |
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

1. Reuse the App's host-bound client; Runtime fixes the App owner from the protected session.
2. Read the current whole-object config and its revision with `client.aiConfig.get()`.
3. When the owner changes intent, overwrite the complete capability list with that revision, keeping the capabilities that do not change.
4. On a `conflict` result, show the newer config and let the owner decide again.
5. Submit AI work through `client.ai` using content and supported parameters only.

```ts
import type { NimiLocalAppClient, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk';

export async function useLocalTextGeneration(client: NimiLocalAppClient) {
  const current = await client.aiConfig.get();
  const textGeneration: NimiPortableAppAIConfigIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  const others = (current.config?.capabilities ?? [])
    .filter((capability) => capability.capabilityContract !== 'text.generate');
  return await client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [...others, textGeneration],
  });
}
```

The same function is compiled in [`examples/sdk/03-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/03-ai-config.ts). The App client sends no owner, account, or Loadout selector; a direct client with an App ID cannot read or write an App's AIConfig.

See [First AI Call](/sdk/first-ai-call) for the execution shape. AI requests do not resolve capability intent into a model, route, connector, target reference, or fallback policy.

## Fail-Closed Behavior

The SDK rejects malformed capability intents or a missing revision before sending, and rejects a malformed returned config. Runtime rejects missing intent, unauthorized Cloud use, unsupported capability requirements, and unavailable execution through typed errors at the owning operation.

Apps should preserve those errors. They must not substitute `auto`, hardcode a provider or model, build a local ranking, or bypass Runtime through App-owned REST.

## Runtime Ownership

Machine configuration, installed assets, Driver state, readiness, health, and execution diagnostics remain Runtime facts. Diagnostic output can explain a completed or failed call, but it does not grant the App request-side implementation control.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
