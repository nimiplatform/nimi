# Technical Glossary

This reference provides definitions and cross-subsystem terminology for Nimi platform concepts and boundaries.

## Identity, Agents, and Cognition

- **Character**: Authoritative character definition persisted in Realm, containing durable identity, unique identifiers, and canonical lore. Spans two specializations: PersonaCharacter (general companion) and WorldCharacter (world-specific NPC).
- **Character Source**: Certified character description issued by Realm, used by Runtime to instantiate LocalAgents.
- **World Source**: Realm-managed context describing environmental rules and lore for characters within a specific world.
- **LocalAgent**: Local execution entity instantiated by Runtime under a specific user session, managing inference, actions, and ephemeral context.
- **ConversationAnchor**: Unique durable conversation handle assigned by Runtime. Each LocalAgent holds a single conversation stream bound to this anchor.
- **Memory**: Private long-term memory managed by Cognition, retrieved and consolidated safely through Runtime mediation.
- **Knowledge**: A Cognition-owned domain with no active V1 ingestion, query, or public client path.

## Subsystems and Product Surfaces

- **SDK**: Standard type-safe interface bridging applications to Runtime and Realm via `@nimiplatform/sdk`.
- **Kit**: Shared cross-platform UI components and presets (via `@nimiplatform/kit`), providing out-of-the-box building blocks like chat feeds and settings panels.
- **Nimi Home**: User desktop command center and application portal, providing dashboard views, local model management, and supervised app hosting.
- **Avatar**: Standalone embodiment engine specializing in Live2D and 3D VRM graphics pipelines, consuming presentation stream events for lip-sync and expressive gestures.
- **Runtime**: Local background execution engine managing open-weights models, hardware acceleration drivers, cloud connectors, and protected execution channels.
- **Realm**: Server-side distributed state coordinator governing universal identities, social graphs, world state progression, and creator economic settlement.

## Architectural Principles and Operational Terms

- **State Projection**: Structured, read-only view emitted by an authoritative source to downstream consumers for UI rendering, with persistence held upstream.
- **Capability Intent**: Structured application request declaring required platform capabilities (e.g., text generation, transcription), resolved by Runtime into concrete models and execution routes.
- **Typed Unavailable**: Explicit structured failure response detailing why an optional capability cannot execute (e.g., missing drivers or ungranted permissions), enabling actionable user guidance.
- **Commit Envelope**: Standard structured payload used to mutate world states, encapsulating targeted entities, mutation scopes, effect classes, and provenance evidence.
- **Single Source of Truth**: The definitive authoritative subsystem responsible for maintaining and arbitrating specific domains of state.

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
