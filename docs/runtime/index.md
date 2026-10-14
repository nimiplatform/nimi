# Runtime

Runtime is the core local service responsible for translating authorized product intent into AI execution. Applications access Runtime through the public SDK surface without needing to manage low-level model dispatch; sensitive credentials and model connections remain securely held by Runtime.

## What Runtime Manages

Runtime is responsible for:

- **AI Execution & Scheduling**: Routing between local models and cloud providers, managing token budgets and quotas, and securely storing provider credentials;
- **LocalAgent Lifecycle**: Instantiating and managing local agent instances based on Realm-issued character specifications (Character Source);
- **Interaction & Presentation**: Maintaining conversation streams, memory mediation, internal state, voice playback, and UI event projections;
- **Local Processes & Audit**: Managing local worker processes, model loading, streaming transport, and audit logs;
- **Identity & Authorization**: Resolving application identity and permissions derived from the active desktop session;
- **Ecosystem Bridges**: Providing controlled communication bridges to Realm services and external tools.

These core responsibilities stay with Runtime regardless of whether the consumer is Nimi Home, Desktop, Avatar, or a third-party app.

## Ownership Boundaries

- **Realm**: Maintains persistent character identity, world context, and ecosystem social data. Runtime consumes this context without redefining canonical identity.
- **Cognition & Memory Boundaries**: Long-term memory is managed privately by Cognition on a per-agent basis; Runtime serves only as an authorized delivery and recall mediator. Knowledge V1 currently provides no active read, write, or public client path.
- **Applications & UI Surfaces**: Own their product UI, user interactions, and ephemeral state. Applications do not bypass Runtime to manage raw credentials or override permissions.
- **Progressive Capabilities**: External integrations and workflow tools are optional extensions; an unavailable extension will not disrupt core conversations or fundamental AI capabilities.

## Read paths

- [Integrations](/runtime/integrations)
- [Streaming](/runtime/streaming)
- [Multimodal](/runtime/multimodal)
- [Agent Execution](/runtime/agent-execution)
- [Memory And Knowledge](/runtime/memory-and-knowledge)
- [Connectors And Providers](/runtime/connectors-and-providers)
- [Local Models](/runtime/local-models)
- [Account And Session](/runtime/account-and-session)
- [Delegated Capability](/runtime/delegated-capability)
- [Local Audit](/runtime/audit-local)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
