# Platform Architecture Overview

Nimi is building a user-controlled AI foundation designed to span mobile, Web, PC, and future embedded devices and smart homes. Today, its installable personal AI product and App ecosystem center execution on a PC Runtime, with Desktop, Web, and Android consuming local or cloud AI through their supported carriers. Focused tools, creation, companions, and worlds are experiences built on that foundation.

Nimi Home is the primary user entry point, currently hosted by the Desktop app. It brings the user experience together and coordinates the underlying subsystems without taking over their domains:

- **Realm**: Maintains the ecosystem identity network, including characters, social relationships, world definitions, and authoritative world contracts.
- **Runtime**: The AI execution engine. Operates independently of Realm, instantiates Realm character definitions into executable LocalAgents on your machine, mediates access to per-agent long-term memory in Cognition, and schedules local models (Ollama, llama.cpp) as well as cloud AI providers.
- **SDK**: The single typed client interface through which Apps invoke explicitly admitted Runtime and Realm operations.
- **Avatar**: Renders characters on screen—2D/3D embodiment, gaze tracking, and emotional reactions—without managing underlying AI decisions.
- **Kit**: Shared UI primitives and feature surfaces used when apps need consistent styling and host integration.

These subsystems are deliberately decoupled. The system that defines who a character is does not own model execution or graphics rendering, allowing the same character to keep a continuous identity across interfaces and worlds.

## Character Identity and LocalAgent Execution

When you create or select a character, Realm issues a structured Character Source that defines its persona and traits. Runtime uses this definition to initialize and run a dedicated LocalAgent on your device. A LocalAgent can read world context shared by Realm, while canonical character identity and authoritative world state/history contracts remain within Realm's domain.

Apps access capabilities through the SDK over a verified local Host session or an admitted remote peer, with Runtime checking the current identity and permitted operations on each call. Remote sources also need the user’s first-use confirmation in Home; that confirmation does not grant unrestricted App access. Apps never receive Realm account credentials, internal Runtime proofs, or AI provider API keys, and they cannot enumerate unpermitted account-wide agents.

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

Use Desktop-supervised Electron for App development and verification. See [Create an App](/start/create-an-app).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
