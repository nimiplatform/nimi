# Authority Domains and Architectural Boundaries

Nimi divides its architecture into explicit Authority Domains. Every category of data, state, and compute has a single owning subsystem, preventing ambiguous ownership and cross-layer race conditions.

## Authority Domains Matrix

| Domain | Authoritative Scope | Explicit Non-Scope |
| --- | --- | --- |
| **Platform Protocol** | Cross-world protocol primitives, system safety invariants, wire contracts | Cloud database internals, local inference execution, app business logic |
| **Realm Server** | Global identities, Character templates, World definitions and planned state/history contracts, social graph, creator economy contracts | Local compute scheduling, local model weights, desktop UI state |
| **Local Runtime** | Local model inference, cloud connector custody, LocalAgent instantiation, turn continuity, memory mediation, protected session and channel access | Server-side world lore arbitration, product UI rendering |
| **Cognition** | Per-agent long-term memory, semantic embeddings, memory consolidation | Network transport framing, frontend rendering, hardware driver execution |
| **SDK** | Public type-safe client interfaces, argument validation, structured error mapping | Backend storage engines, local inference internals, private transports |
| **Kit** | Shared cross-platform UI components, interaction patterns, layout presets | Underlying state arbitration, app-private business data |
| **Nimi Home / Desktop** | User entry portal hosted by Desktop, window management, local hardware and model setup | Arbitrating Realm truth or bypassing Runtime access controls |
| **Avatar Application** | Live2D and 3D VRM graphics pipelines, skeletal animation, real-time lip sync | Agent long-term memory, model routing, conversation continuity |
| **Applications (App)** | App-specific features, workflows, and private app data | Platform-wide credentials, raw provider API secrets |

## Cross-Domain Data Flows

| Direction | Coordination Mechanism |
| --- | --- |
| **Realm → Runtime** | Realm issues certified Character Sources; Runtime instantiates and runs LocalAgents |
| **Realm → Runtime** | Realm supplies World context to ground LocalAgent dialogue |
| **Runtime → SDK** | Runtime streams normalized generation output and structured events to the SDK |
| **SDK → App** | Apps invoke explicitly admitted SDK operations over protected host sessions |
| **Runtime → Avatar** | Runtime streams presentation events; Avatar drives character visuals on the local GPU |
| **Nimi Home → App** | Home (hosted in Desktop) launches apps within protected host sessions verified by Runtime |

## Related Documentation

- [Technical Glossary](/reference/glossary)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
