# Platform Architecture Overview

Nimi is an installable, open-source, local-first personal AI system. In Nimi, users meet AI characters, hold continuous conversations, create multimodal content, follow evolving narratives, and explore digital worlds. All experiences start on your personal device, with complete ownership over data and privacy.

Nimi Home serves as the primary user hub, hosted by the Desktop shell today. It fronts the user experience and coordinates the underlying subsystems without usurping their domains:

- **Realm**: Maintains the ecosystem identity network—characters, social relationships, worlds, and shared authoritative world state.
- **Runtime**: The AI execution engine. It instantiates Realm character identities into executable LocalAgents on your local machine and schedules local models (Ollama, llama.cpp) and cloud AI providers.
- **SDK**: The single typed, capability-scoped client interface for Apps to communicate with Runtime and Realm.
- **Avatar**: Renders characters on screen—visual presentation, 2D/3D embodiment, gaze tracking, and emotional reactions—without managing the underlying AI decisions.
- **Kit**: Shared, high-fidelity UI primitives applied when a product surface needs cohesive styling.

These subsystems are deliberately decoupled. The system that defines who a character is does not need to own model execution or graphics rendering. Consequently, the same character maintains continuous identity across interfaces and worlds.

## Character Identity and LocalAgent Execution

Users create or select a character in Realm. Realm issues a structured Character Source defining its persona and traits; Runtime uses this definition to initialize and run a dedicated LocalAgent on the user's machine. The LocalAgent draws upon contextual world state shared by Realm, but never overrides or alters the canonical character identity or world history—those remain authoritatively governed by Realm.

Applications access LocalAgent capabilities via the SDK. Runtime derives identity and permissions directly from the authenticated session. Apps never receive Realm account credentials, internal Runtime proofs, or AI provider API keys, nor can they enumerate unpermitted account-wide agents.

For deeper architectural context, see [Character and LocalAgent](/platform/agents/) and [Realm and Runtime as Siblings](/platform/architecture/realm-runtime-siblings).

## The Six Protocol Primitives

The platform defines six core protocol primitives to structure operations exchanged across system and world boundaries, ensuring no component overrides another's authoritative state:

- **Timeflow**: Progression, temporal rhythms, and scheduling across worlds.
- **Social**: Relationship graphs and interaction semantics.
- **Economy**: Asset values, credential exchanges, and transaction records.
- **Transit**: Travel and context transitions between worlds.
- **Context**: Shared environmental framing and situational state.
- **Presence**: Spatial occupancy and admission boundaries.

See [Platform Protocol](/platform/protocol) and [Execution Protocol](/platform/execution-protocol).

## System Boundaries and Scope

The current runtime loop encompasses Realm, Runtime, SDK, Nimi Home, and independent Apps. Generalized workflow orchestration (Workflow), external protocol bridges (MCP), autonomous world evolution, public app marketplaces, and commercial settlement are not prerequisites for running the core system. Future capabilities will integrate within their respective bounded domains.

> [!NOTE]
> The legacy Simulator has been archived and does not participate in app development or verification. For current development instructions, follow [Create an App](/start/create-an-app).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
