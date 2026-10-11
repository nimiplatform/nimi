# AI Config Surface

The SDK AIConfig surface establishes a strongly-typed contract for managing application-scoped AI capability preferences. An application declares its required capability contracts, required features (such as multimodal or tool calling), scenario defaults, and explicit routing preferences between Local and Cloud execution. Physical hardware resolution and model instantiation are governed independently by Runtime, which strictly enforces confirmed configurations during execution.

AIConfig maintains an authoritative snapshot for an owner. Updates atomically overwrite the complete capability list against a revision token; the data contract avoids transient execution states, temporary readiness, or driver health statuses.

## Public Surfaces & Modules

| Component | Export Path | Role & Functionality |
| --- | --- | --- |
| App AIConfig on Host Client | `client.aiConfig` on `NimiLocalAppClient` | Reads app-level configuration, queries validated target options, and performs revision-controlled updates |
| AIConfig Settings UI | `ModelConfigAIConfigSurface` from `@nimiplatform/kit/features/model-config` | Ready-to-use visual configuration panel rendered on top of `client.aiConfig` |
| Core Type Definitions | `@nimiplatform/sdk` or `@nimiplatform/sdk/ai` | Exports `NimiCapabilityAIConfig`, `NimiCapabilityAIConfigIntent`, snapshot models, and overwrite result types |
| Owner-scoped AIConfig Client | `createNimiAppAIConfigClient` from `@nimiplatform/sdk/ai` | Used by system hosts maintaining protected transports; standard apps do not need this |
| Agent Center Configuration Section | `@nimiplatform/kit/features/agent-center` | Displays local or cloud capability preferences within the Agent Center UI |

## Capability Intent Structure

Each entry in the capability list consists of:

| Field | Description |
| --- | --- |
| `capabilityContract` | Target capability contract identifier, e.g. `text.generate` |
| `requiredFeatures` | Feature flags that the runtime model implementation must support (e.g. streaming, structured output) |
| `defaults` | Portable scenario defaults (temperature, max tokens), distinct from hardware settings |
| Route intent (`route`) | Explicit execution plane: local (`local`) or cloud (`cloud`) |

- **Local intent**: Contains a lightweight route marker `local: {}` without coupling to specific local file paths or model IDs.
- **Cloud intent**: Specifies `connectorRef`, `implementation`, and `providerModelTarget` selected from Runtime's validated options. These represent persistent configuration choices rather than per-request overrides.

When dispatching AI tasks, Runtime binds directly to the active Local Loadout or configured Cloud parameters without dynamic model swapping. All LocalAgents within an account share a common Agent AIConfig; individual agents do not own separate configurations.

## Application Integration Workflow

1. **Reuse the host-bound client**: Use the scaffolded client instance; Runtime automatically derives app ownership from the Desktop Shell session.
2. **Fetch active configuration**: Call `client.aiConfig.get()` to retrieve the current snapshot along with its `revision`.
3. **Persist updated intent**: When the user modifies settings, supply the `expectedRevision` and overwrite the capability list, preserving unaffected items.
4. **Inspect overwrite outcome**: Check `result.outcome === 'conflict'` rather than catching an exception; if a concurrency conflict occurs, reload the latest configuration and revision for user confirmation.
5. **Dispatch AI tasks**: Submit inference workloads via `client.ai` with prompt content and standard parameters.

```ts
import type { NimiLocalAppClient, NimiPortableAppAIConfigIntent } from '@nimiplatform/sdk';

export async function useLocalTextGeneration(client: NimiLocalAppClient) {
  // 1. Fetch current config and revision
  const current = await client.aiConfig.get();

  // 2. Construct capability intent
  const textGeneration: NimiPortableAppAIConfigIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };

  // 3. Preserve unmodified capabilities
  const others = (current.config?.capabilities ?? [])
    .filter((capability) => capability.capabilityContract !== 'text.generate');

  // 4. Overwrite atomically with revision validation
  return await client.aiConfig.overwrite({
    expectedRevision: current.revision,
    capabilities: [...others, textGeneration],
  });
}
```

Reference code is verified in [`examples/sdk/03-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/03-ai-config.ts). App clients do not hardcode model paths or private accounts; direct clients lacking host session tokens cannot read or modify protected app configurations.

For execution patterns, see [First AI Call](/sdk/first-ai-call).

## Fail-Closed Enforcement

The SDK enforces pre-flight validation on capability intents and revision tokens, rejecting malformed payloads before transmission. Runtime evaluates boundary constraints, returning typed errors if an intent is missing, cloud usage is unauthorized, required features are unsupported, or local hardware is unavailable.

Applications must surface these standard errors transparently:
- Do not inject speculative fallbacks (such as synthetic `auto` routing);
- Do not hardcode specific commercial provider IDs or private model names;
- Do not establish side-channel HTTP/REST requests to bypass Runtime dispatch.

## Separation of Concerns: App vs. Runtime

Host hardware configuration, local model weights, GPU driver readiness, and low-level diagnostic logs are managed strictly by Runtime. Diagnostic traces assist developers in troubleshooting, but do not permit applications to bypass platform scheduling at request time.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`sdks/typescript/core/ai/capability-configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/ai/capability-configuration.ts)
- [`sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core-generated/runtime-protobuf/runtime/v1/capability_configuration.ts)
- [`kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/agent-center/src/components/AgentCenterAIConfigSection.tsx)
