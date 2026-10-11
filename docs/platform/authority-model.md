# Authority Model

Nimi decouples durable identity, runtime execution, product hosting, and graphics rendering so that ephemeral UI projections or intermediate client bindings never become an unmanaged Single Source of Truth.

For the field-level owner mapping, see [Reference → Authority Domains](/reference/authority-domains).

## Core Owners & Subsystem Boundaries

| Subsystem Concern | Canonical Owner | Boundary Definition |
| --- | --- | --- |
| Account-level AI character identity | Realm `Character` | Realm owns durable identity records, cross-world relations, and character assets |
| Runtime AI execution | Runtime `LocalAgent` | Runtime instantiates Character definitions into executable LocalAgents on device |
| Long-term memory storage | Cognition | Long-term memory is managed per agent by Cognition; Knowledge V1 is inactive |
| Conversation flow & memory routing | Runtime | Runtime mediates active sessions and context; Apps consume services without owning state |
| World state and event history | Realm | Realm maintains canonical world history; Runtime and Apps consume authorized views |
| Application authorization | Runtime Session | Access permissions derive securely from the active session and application identity |
| Product composition | Nimi Home & hosts | The host orchestrates layouts and experiences, but does not own underlying state |
| Embodiment & visual rendering | Avatar | Avatar renders expressions, motions, and meshes without managing AI logic |

`Character` and `LocalAgent` represent distinct architectural concepts:
- **Character** is the durable, cross-world identity asset maintained by Realm.
- **LocalAgent** is the active executable instance materialized by Runtime for execution on a user's machine.

Applications interact with both entities via standard SDK interfaces, but client projections or binding objects never establish a third competing identity authority.

## Application Access Constraints

Applications access Runtime capabilities based on permissions validated against the active secure session and declared App identity. Applications scaffolded via standard templates do not receive direct Realm JWTs and do not maintain independent Runtime cryptographic proofs. Realm access is mediated through validated SDK interfaces, while AI inference, conversation state, and memory routing remain managed by Runtime.

Using the direct SDK and developing scaffolded standalone apps represent technical integration paths rather than user-selectable options. Kit provides high-fidelity, reusable UI components for concrete application needs, deliberately avoiding speculative catalogs of prebuilt widgets.

## Host Environments and Projections

Nimi Home is the primary first-party desktop host. It coordinates Runtime, Realm, SDK, Kit, and Avatar capabilities into a cohesive interface, but does not supersede their underlying authorities. Desktop shell state, Avatar visual scenes, and generated configuration files are downstream consumers and read-only views of authoritative system truth.

Forward-looking designs for public app distribution and world-binding mechanics remain isolated until required, and do not block the active local AI product loop.

## Optional External Actions

Delegated external actions constitute an optional capability extension. When enabled, actions must adhere to strict least-privilege scoping and fail-closed safety semantics. Complex workflows, external MCP bridges, autonomous world evolution, public app registries, or marketplace settlements are not prerequisites for the core Runtime lifecycle.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
