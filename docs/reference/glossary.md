# Technical Glossary

This glossary defines core concepts, subsystem roles, and architectural terms used across the Nimi platform.

## Identity, Agents, and Cognition

- **Character**: The authoritative character definition stored in Realm, including durable identity, unique identifiers, and canonical lore. Characters take two forms: PersonaCharacter (general companion) and WorldCharacter (world-specific character).
- **Character Source**: A certified character specification issued by Realm that Runtime uses to instantiate a LocalAgent.
- **World Source**: Realm-managed context that defines environmental rules and lore for characters in a given world.
- **LocalAgent**: A local execution instance created by Runtime under a user session to handle inference, actions, and working context.
- **ConversationAnchor**: A durable handle assigned by Runtime. Each LocalAgent maintains a single continuous conversation stream bound to this anchor.
- **Memory**: Agent-specific long-term memory owned by Cognition and accessed or consolidated exclusively through Runtime.
- **Knowledge**: A Cognition-owned domain that currently has no active V1 ingestion, query, or public client path.

## Subsystems and Product Surfaces

- **SDK**: The type-safe client interface (`@nimiplatform/sdk`) that connects applications to admitted Runtime and Realm operations.
- **Kit**: Shared cross-platform UI components and presets (`@nimiplatform/kit`), including ready-made building blocks such as chat feeds and settings panels.
- **Nimi Home**: The user entry portal—currently hosted by Desktop—for managing local models, viewing system status, and launching apps in protected host sessions.
- **Avatar**: A dedicated rendering engine for Live2D and 3D VRM pipelines that consumes Runtime presentation events for lip-sync and expressive motion.
- **Runtime**: The local background engine that manages local models, hardware drivers, cloud connectors, per-agent memory mediation, and protected execution channels.
- **Realm**: The server-side service governing global identities, social graphs, world definitions and state contracts, and creator economy rules.

## Architectural Principles and Operational Terms

- **State Projection**: A structured, read-only view emitted by an authoritative subsystem for downstream UI rendering while persistence stays upstream.
- **Capability Intent**: A structured request from an app declaring the capability it needs (such as text generation or transcription), which Runtime resolves into a concrete model and execution route.
- **Typed Unavailable**: A structured failure response explaining why a capability cannot run right now (for example, missing drivers, unconfigured models, or an unadmitted session operation) so the app can guide the user.
- **Commit Envelope**: The planned structured payload specification for shared world state mutations, capturing target entities, mutation scopes, effect classes, and provenance evidence.
- **Single Source of Truth**: The sole subsystem authorized to own, persist, and arbitrate a given domain of state.

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
