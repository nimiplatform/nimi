# Authority Domains and Architectural Boundaries

Nimi establishes explicit Authority Domains across its distributed architecture, designating a definitive owner for every category of data, state, and compute resource. Clean boundaries prevent ownership ambiguities and cross-subsystem race conditions.

## Authority Domains Matrix

| Domain | Authoritative Scope | Explicit Non-Scope |
| --- | --- | --- |
| **Platform Protocol** | Core cross-world primitives, system safety invariants, wire contracts | Cloud database details, local inference mechanics, app logic |
| **Realm Server** | Global identities, Character lore templates, World state and history, Social graph, Creator economics | Local hardware compute scheduling, local weights, desktop UI states |
| **Local Runtime** | Local model inference, cloud connector custody, LocalAgent instantiation, turn continuity, memory mediation, channel access controls | Server-side world lore arbitration, product UI presentation |
| **Cognition** | Agent-private long-term memory, semantic embeddings, cognitive consolidation | Network transport framing, frontend rendering, driver execution |
| **SDK** | Public type-safe interfaces, argument validation, structured error mapping | Backend storage implementations, local engine internals, raw transports |
| **Kit** | Shared cross-platform UI widgets, interactive patterns, and layout components | Underlying state arbitration, proprietary app business data |
| **Nimi Home / Desktop** | User command center, window management, local hardware and model configuration | Arbitrating Realm server truth or overriding local Runtime security |
| **Avatar Application** | Live2D and 3D VRM graphics pipelines, skeletal motion, real-time lip synchronization | Agent long-term memory banks, model routing, conversation continuity |
| **Applications (App)** | Unique application features, workflow logic, private application data | Universal platform credentials, direct provider API secrets |

## Cross-Domain Data Flows

| Direction | Coordination Mechanism |
| --- | --- |
| **Realm → Runtime** | Realm issues certified Character Sources; Runtime materializes and executes LocalAgents |
| **Realm → Runtime** | Realm provides verified World context to enrich local agent contextual dialogue |
| **Runtime → SDK** | Runtime delivers normalized generation streams and structured events to the SDK |
| **SDK → App** | Applications consume public capabilities, leveraging protected channel access and hardware acceleration |
| **Runtime → Avatar** | Runtime streams standardized presentation events; Avatar animates character visuals via local GPU |
| **Nimi Home → App** | Home launches applications within supervised Electron development hosts, verified by Runtime |

## Related Documentation

- [Technical Glossary](/reference/glossary)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
