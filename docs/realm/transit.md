# Transit: Cross-World Protocol

Transit defines participant admission, identity continuity, and outcomes when moving between worlds. Realm owns these semantics. The platform contract routes cross-world transitions through OASIS: origin world → OASIS → destination world.

## Protocol Responsibilities

- Realm resolves participant identity and the origin and destination worlds, then validates their admission requirements.
- OASIS is the contract's central transit and return point; an App's private world cannot replace it.
- A destination world's local rules do not create a new global identity or authorize an App to bypass Realm validation.
- Transition outcomes and failures come from formal Realm results. A local route change or cache does not prove successful transit.

## Current Home World Entry

Home's Explore and world-detail surfaces browse public settings, scenes, relationships, and character records. Their actions follow worlds, inspect character sources, add partners, or open existing partners' Conversations. This entry does not submit Transit, travel through OASIS when a section link is clicked, or replace Home's active world context.

For the current discovery task, follow [Discover Worlds and Character Sources](/desktop/explore-and-worlds). The protocol flow is not an instruction to click an available Home “Enter World” button.

## Related Documentation

- [OASIS](/platform/worlds/oasis)
- [Six Core Primitives](/reference/six-primitives)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/world/world-detail.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail.tsx)
- [`apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx)
