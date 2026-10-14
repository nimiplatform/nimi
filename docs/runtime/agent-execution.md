# LocalAgent Runtime Lifecycle and Execution Architecture

Runtime manages LocalAgent initialization, execution scheduling, and state isolation. A LocalAgent is instantiated locally from a Realm-certified Character specification under an explicit owner, acting as the agent's controlled local execution entity.

## Execution Responsibilities

Runtime manages the following core domains:

- **Lifecycle and Owner Isolation**: Handles local instantiation, memory allocation, runtime context maintenance, and cross-tenant isolation for LocalAgents.
- **Conversation Continuity (ConversationAnchor)**: Preserves conversation anchors to guarantee multi-turn context continuity, recovery across restarts, and clean generation interruption.
- **Memory Mediation**: Operates as a protected broker for Cognition, safely mediating memory retrieval, recall, and persistence.
- **Capability Evaluation & Credential Custody**: Resolves application capability intents into local inference tasks or cloud calls according to configured Local or Cloud routes, while safeguarding API keys and credentials in protected storage.
- **Structured Output Validation**: Validates and normalizes generated tokens, interaction states, and audio streams before committing them to authoritative transcripts.
- **Typed Projections**: Delivers type-safe, structured state views to authorized consumers.

Applications submit high-level intents through the SDK. Runtime derives the caller identity and authorization scopes directly from the active session. Standard apps interact with agents using session-scoped `agentHandle` references rather than raw internal IDs.

## Consumer and Presentation Boundaries

Desktop, Nimi Home, and Avatar function as presentation layers, subscribing to and rendering authorized conversation, status, and multimodal projections:

- **Presentation Decoupling**: Frontend renderers consume normalized events without dealing with provider-specific wire protocols or underlying execution mechanics.
- **Embodiment Consumers**: Avatar reads admitted activity, emotion, semantic posture, and bounded voice timing. It owns the backend mapping and local playback/lipsync derived from the canonical final voice artifact; renderer mouth frames are not common Runtime inputs.

## Continuity and State Isolation

Each LocalAgent maintains a single authoritative Conversation managed by Runtime. Subsequent authorized sessions—even when invoked across different windows or applications—continue the same committed dialogue history.

Distinct LocalAgents instantiated from the same Character template remain strictly isolated in memory and state. For details on anchor mechanics and access policies, see [Conversation Anchor](/platform/agents/conversation-anchor) and [Participation Authority](/platform/agents/participation-authority).

## Source Basis

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
