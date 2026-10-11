# Platform Governance & System Boundaries

Nimi establishes clear ownership boundaries across durable identity, world state, AI execution, visual presentation, and application composition. Product surfaces can compose these capabilities, but never assume authoritative ownership over the underlying systems.

## Subsystem Owner Mapping

| Architectural Concern | Canonical Owner | Boundary Definition |
| --- | --- | --- |
| World identity, event history, and durable Character assets | Realm | Realm maintains canonical character identities and cross-world social graphs |
| LocalAgent execution, conversation state, and memory routing | Runtime | Runtime instantiates character definitions into active LocalAgents on device |
| Long-term memory storage | Cognition | Memory is isolated per agent; Knowledge V1 is currently inactive |
| Typed public application interfaces | SDK | SDK enforces typed contracts, permission checks, and input validation |
| First-party product interface & desktop shell | Nimi Home / Desktop | Orchestrates presentation and workflows without owning core system truth |
| Character embodiment & rendering | Avatar | Manages 2D/3D avatars, animation, and gaze tracking without managing AI logic |
| Shared UI primitives | Kit | Reusable UI components ensuring visual design consistency |

The boundary between `Character` and `LocalAgent` illustrates this governance model:
- **Realm** owns the static, persistent Character definition.
- **Runtime** instantiates that definition into an active LocalAgent on the user's local device.

Desktop client caches, Avatar embodiment instances, and application-level bindings may reference both entities, but never become a competing third identity authority.

## Application Isolation Boundaries

Applications consume Runtime capabilities via the SDK based on the active session and declared application identity. Applications do not receive Realm master tokens and do not maintain private Runtime credentials. Access to Realm entities is mediated through validated SDK APIs, while conversation state and memory routing remain managed by Runtime.

Nimi Home is the primary first-party desktop host, orchestrating these subsystems into a unified experience. Changing or replacing the host shell does not compromise the underlying authoritative data.

## Incremental Evolution & Non-Blocking Scope

General workflow orchestration (Workflow), external MCP bridges, autonomous world evolution, public app marketplaces, and commercial settlement are not prerequisites for the active local personal AI product loop. Future architectures remain isolated until their ownership and activation boundaries are settled.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
