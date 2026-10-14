# Authority Model

Nimi separates persistent identity, runtime execution, product hosting, and visual rendering so that UI views and client bindings never become an unmanaged source of truth.

For field-level ownership details, see [Reference → Authority Domains](/reference/authority-domains).

## Core Owners & Subsystem Boundaries

| Subsystem Concern | Canonical Owner | Boundary Definition |
| --- | --- | --- |
| Account-level character identity | Realm `Character` | Owns persistent identity records, cross-world relationships, and character assets |
| On-device AI execution | Runtime `LocalAgent` | Instantiates Character definitions into running LocalAgents on the user's machine |
| Long-term memory storage | Cognition | Isolates long-term memory per agent (accessed via Runtime); `Knowledge V1` is inactive |
| Conversation flow & memory routing | Runtime | Mediates live sessions and memory recall/updates; apps consume services without owning state |
| World state and event history | Realm | Owns planned shared State/History contracts; current accepted operations read and edit world and character settings |
| Application authorization | Runtime Session | Derives access from the protected host session and app identity without generic persistent grants |
| Product composition | Nimi Home & hosts | Nimi Home (currently hosted by Desktop) orchestrates layouts and workflows without owning underlying state |
| Embodiment & visual rendering | Avatar | Renders expressions, motion, and meshes without driving AI reasoning |

`Character` and `LocalAgent` serve distinct roles:
- **Character** is the durable, cross-world identity maintained by Realm.
- **LocalAgent** is the running on-device instance managed by Runtime.

Applications work with both through the SDK, but client projections and binding objects never form a third identity authority.

## Application Access Constraints

Applications use Runtime capabilities through a protected host session and explicitly accepted SDK operations—without generic persistent app grants or first-launch permission prompts. Apps scaffolded from standard templates do not receive raw Realm JWTs or maintain private Runtime credentials. Realm data access flows through validated SDK operations (such as WorldCore for world editing), while model inference, conversation state, and memory routing stay inside Runtime.

Direct SDK integration and scaffolded standalone apps are developer integration paths, not end-user configuration modes. Kit provides reusable UI components for concrete product needs rather than speculative widget catalogs.

## Host Environments and Projections

Nimi Home is the entry point for the desktop experience and is currently hosted by Desktop. It brings together Runtime, Realm, SDK, Kit, and Avatar without overriding their ownership boundaries. Desktop shell state, Avatar scenes, and generated config files are downstream views of authoritative system data.

App distribution and world-binding mechanics have their own admission and readiness requirements; they do not redefine the local AI execution boundary.

## Optional External Actions

Delegated external actions are an optional extension. When enabled, they follow least-privilege scoping and fail-closed verification. General workflow engines, external MCP bridges, autonomous world evolution, public app registries, and commercial settlement are not prerequisites for core Runtime operation.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
