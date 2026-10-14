# Platform Architecture Overview

Nimi is an installable, open-source, local-first personal AI system. In Nimi, you can meet AI characters, hold ongoing conversations, create multimodal content, follow evolving narratives, and explore digital worlds. Your experience starts on your own device, with local runtime state kept under your control while connecting to cloud models or shared services when needed.

Nimi Home is the primary user entry point, currently hosted by the Desktop app. It brings the user experience together and coordinates the underlying subsystems without taking over their domains:

- **Realm**: Maintains the ecosystem identity network, including characters, social relationships, world definitions, and authoritative world contracts.
- **Runtime**: The AI execution engine. Operates independently of Realm, instantiates Realm character definitions into executable LocalAgents on your machine, mediates access to per-agent long-term memory in Cognition, and schedules local models (Ollama, llama.cpp) as well as cloud AI providers.
- **SDK**: The single typed client interface through which Apps invoke explicitly admitted Runtime and Realm operations.
- **Avatar**: Renders characters on screen—2D/3D embodiment, gaze tracking, and emotional reactions—without managing underlying AI decisions.
- **Kit**: Shared UI primitives and feature surfaces used when apps need consistent styling and host integration.

These subsystems are deliberately decoupled. The system that defines who a character is does not own model execution or graphics rendering, allowing the same character to keep a continuous identity across interfaces and worlds.

## Character Identity and LocalAgent Execution

When you create or select a character, Realm issues a structured Character Source that defines its persona and traits. Runtime uses this definition to initialize and run a dedicated LocalAgent on your device. A LocalAgent can read world context shared by Realm, while canonical character identity and authoritative world state/history contracts remain within Realm's domain.

Apps access capabilities through the SDK over a protected host session and explicitly admitted operations, without generic persistent app grants or first-launch permission prompts. Apps never receive Realm account credentials, internal Runtime proofs, or AI provider API keys, and they cannot enumerate unpermitted account-wide agents.

For deeper architectural context, see [Character and LocalAgent](/platform/agents/) and [Realm and Runtime as Siblings](/platform/architecture/realm-runtime-siblings).

## The Six Protocol Primitives

The platform defines six core protocol primitives to structure operations across system and world boundaries, ensuring no component silently overrides another's authoritative state:

- **Timeflow**: Progression, temporal rhythms, and scheduling across worlds.
- **Social**: Relationship graphs and interaction semantics.
- **Economy**: Asset values, credential exchanges, and transaction records.
- **Transit**: Travel and context transitions between worlds.
- **Context**: Shared environmental framing and situational state.
- **Presence**: Spatial occupancy and admission boundaries.

See [Platform Protocol](/platform/protocol) and [Execution Protocol](/platform/execution-protocol).

## System Boundaries and Scope

The current core loop spans Realm, Runtime, SDK, Nimi Home, and independent Apps. Generalized workflow orchestration (Workflow), external protocol bridges (MCP), autonomous world evolution, public app marketplaces, and commercial settlement are not prerequisites for running the core system. Future capabilities will integrate within their own bounded domains.

> [!NOTE]
> The legacy Simulator has been archived and is no longer used for app development or verification. For current instructions, see [Create an App](/start/create-an-app).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
