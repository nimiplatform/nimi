# Platform Governance & System Boundaries

Nimi assigns persistent identity, world definitions, AI execution, visual rendering, and app composition to distinct owners. Product surfaces combine these capabilities into a cohesive experience, but never take over ownership of the underlying systems.

## Subsystem Owner Mapping

| Architectural Concern | Canonical Owner | Boundary Definition |
| --- | --- | --- |
| World definitions, planned history contracts, and Character assets | Realm | Maintains persistent character identities, world settings, and cross-world social graphs |
| LocalAgent execution, conversation state, and memory routing | Runtime | Instantiates character definitions into active LocalAgents on device and mediates memory access |
| Long-term memory storage | Cognition | Isolates long-term memory per agent; `Knowledge V1` currently has no public interface |
| Typed public application interfaces | SDK | Enforces typed contracts, session-scoped access checks, and input validation |
| First-party product entry & desktop host | Nimi Home / Desktop | Nimi Home (hosted by Desktop) orchestrates presentation and workflows without owning core system state |
| Character embodiment & rendering | Avatar | Manages 2D/3D models, animation, and gaze tracking without driving AI reasoning |
| Shared UI primitives | Kit | Provides reusable UI components for visual consistency without holding business state |

The split between `Character` and `LocalAgent` reflects this governance model:
- **Realm** owns the persistent Character definition.
- **Runtime** instantiates that definition into a running LocalAgent on the user's device.

Desktop caches, Avatar instances, and app-level bindings may reference both entities, but never become a competing identity authority.

## Application Isolation Boundaries

Applications access Runtime capabilities through the SDK using the active protected host session and declared app identity. They never receive Realm master tokens or maintain private Runtime credentials. Access to Realm data goes through accepted SDK operations, while conversation state and memory routing remain managed by Runtime.

Nimi Home is the first-party entry point (currently hosted by Desktop) that brings these modules together. Replacing or evolving the host shell does not alter the underlying authoritative data.

## Incremental Evolution & Non-Blocking Scope

General workflow orchestration (Workflow), external MCP bridges, autonomous world evolution, public app marketplaces, and commercial settlement are not prerequisites for the local personal AI loop. Forward-looking capabilities remain isolated until their ownership and activation boundaries are established.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
