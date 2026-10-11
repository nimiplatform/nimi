# Realm and Runtime as Siblings

Realm and Runtime operate as decoupled, peer architectural authorities.

| Subsystem Domain | Realm Governance | Runtime Governance |
| --- | --- | --- |
| **Identity & Lifecycle** | Character persistent identity & Character Source definitions | LocalAgent instantiation & on-device lifecycle |
| **World State & AI Compute** | World Source specifications & canonical world history | Local (Ollama/llama.cpp) & cloud AI model scheduling |
| **State & Sessions** | Social relationship graphs, economy, and persistent world state | Active conversations, session state, and memory mediation |
| **Security & Policy** | Realm access policies and multi-device cloud audit trails | Inference driver selection, token budgets, API keys, and app authorization |

## Inter-Domain Coordination

Realm issues or projects Character Source and World Source structures that Runtime is authorized to consume. Runtime instantiates a LocalAgent from the Character Source and incorporates authorized World Source context during execution.

The architectural boundary strictly prevents cross-domain contamination:
- Transient memory or reasoning outputs produced by Runtime are never written back into canonical Realm world state without explicit validation.
- Realm does not execute LocalAgent conversation turns or mandate Runtime inference drivers.
- Any mutation crossing domains must invoke the owning domain's public contract.

The SDK presents a bounded consumer surface. Nimi Home, Desktop shell, Avatar rendering, and independent Apps are consumers; no host environment can merge these two distinct authorities into a private local state.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
