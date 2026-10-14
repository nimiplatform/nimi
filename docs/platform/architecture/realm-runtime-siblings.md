# Realm and Runtime as Siblings

Realm and Runtime operate as independent, peer authorities.

| Subsystem Domain | Realm Governance | Runtime Governance |
| --- | --- | --- |
| **Identity & Lifecycle** | Persistent Character identity & Character Source definitions | LocalAgent instantiation & on-device lifecycle |
| **World & AI Compute** | World Source specifications & planned World State/History contracts | Local (Ollama/llama.cpp) & cloud AI model scheduling |
| **State & Sessions** | Social relationship graphs, economy, and world settings | Active conversations, session state, and Cognition memory mediation |
| **Security & Policy** | Realm access policies and cloud audit trails | Inference driver selection, token budgets, API keys, and session-scoped app access |

## Inter-Domain Coordination

Realm issues Character Source and World Source definitions. Runtime consumes those authorized definitions to instantiate a LocalAgent on the user's device and bring in allowed world context during execution.

Strict boundaries prevent cross-domain contamination:
- Transient memory or reasoning outputs from Runtime are never written back to Realm without explicit validation.
- Realm does not run LocalAgent conversation turns or dictate Runtime inference drivers.
- Any state change across domains must go through the owning domain's public contract.

The SDK exposes a bounded surface for consumers. Nimi Home (hosted by Desktop), Avatar, and apps consume these projections without merging Realm and Runtime into a private local authority.

> [!NOTE]
> Long-term memory is isolated per agent in Cognition and mediated by Runtime. `Knowledge V1` currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
