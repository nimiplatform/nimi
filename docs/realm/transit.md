# Transit: Cross-World Protocol

Transit defines participant admission, identity continuity, and outcomes when moving between worlds. Realm owns these semantics. Under the platform contract, cross-world transitions route through OASIS: origin world → OASIS → destination world.

## Protocol Responsibilities

- Realm resolves participant identity along with the origin and destination worlds, then validates their admission requirements.
- OASIS serves as the contract's central transit and return hub; an App's private world cannot replace it.
- A destination world's local rules neither create a new global identity nor authorize an App to bypass Realm validation.
- Transition outcomes and failure reasons come from formal Realm results. A local route change or cached client state does not prove a successful transit.

## Current Home World Entry

In Home, the Explore and world-detail views let you browse public settings, scenes, relationships, and character records. From these views, you can follow worlds, inspect character sources, add partners, or open Conversations with existing partners.

Using these entry points does not submit a Transit request, route through OASIS when you click a section link, or replace Home's active world context. The protocol flow above does not correspond to an “Enter World” button in Home. For current browsing and discovery workflows, see [Discover Worlds and Character Sources](/desktop/explore-and-worlds).

## Related Documentation

- [OASIS](/platform/worlds/oasis)
- [Six Core Primitives](/reference/six-primitives)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
- [`apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx)
