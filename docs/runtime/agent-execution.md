# LocalAgent Runtime Lifecycle and Execution Architecture

Runtime manages LocalAgent initialization, execution, and state isolation. A LocalAgent is instantiated locally from a Realm-certified Character Source under an explicit owner, acting as the local execution entity for the agent.

## Execution Responsibilities

Runtime manages the following core domains:

- **Lifecycle and Owner Isolation**: Handles local instantiation, memory allocation, runtime context, and tenant isolation for LocalAgents;
- **Conversation Continuity (ConversationAnchor)**: Preserves anchors to guarantee multi-turn context continuity, recovery across restarts, and clean generation interruption;
- **Memory Mediation**: Operates as a protected broker for Cognition, safely arbitrating memory storage, indexing, and recall;
- **Capability Evaluation & Credential Custody**: Resolves application capability intents into local inference tasks or cloud calls while safeguarding API credentials in protected memory;
- **Structured Output Validation**: Validates generated tokens, safety classifications, and audio streams before committing them to authoritative transcripts;
- **Typed Projections**: Delivers type-safe, structured state views to authorized consumers.

Applications submit high-level intents through the SDK. Runtime derives the caller identity and authorization scopes directly from the active session. Standard apps use session-scoped `agentHandle` references rather than raw internal IDs.

## Consumer and Presentation Boundaries

Desktop, Nimi Home, and Avatar function as presentation layers, rendering authorized conversation, status, and multimodal projections:

- **Presentation Decoupling**: Frontend renderers consume normalized events without dealing with provider-specific wire protocols or execution mechanics.
- **Embodiment Consumers**: Avatar reads admitted activity, emotion, semantic posture, and bounded voice timing. It owns the backend mapping and local playback/lipsync derived from the canonical final voice artifact; renderer mouth frames are not common Runtime inputs.

## Continuity and State Isolation

Each LocalAgent maintains a single authoritative Conversation managed by Runtime. Subsequent authorized sessions—even when originating from different applications—continue the same committed dialogue history.

Distinct LocalAgents instantiated from the same base Character remain strictly isolated in memory and state. For details on anchor mechanics and access policies, see [Conversation Anchor](/platform/agents/conversation-anchor) and [Participation Authority](/platform/agents/participation-authority).

## Source Basis

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
