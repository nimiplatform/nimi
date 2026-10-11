# Realm Core Service and World Substrate

Realm is the server-side foundation of the Nimi federated network, providing persistent, authoritative services for all digital worlds. Universal account identity, social graphs, world state transitions, creator economics, and cross-world travel (Transit) are unified authoritatively within Realm as the Single Source of Truth.

Platform responsibilities are divided into clear operational tiers:
- **Runtime**: Local and cloud AI model inference, agent execution, and memory mediation;
- **Realm**: Shared world states, entity relationship graphs, and creator asset registries;
- **SDK**: Unified developer client bridging applications to Runtime and Realm;
- **Desktop & Web**: Responsive presentation surfaces delivering immersive user experiences.

## Chapter Guide

### Authoritative State and Data Models
- [Realm Architectural Boundaries](/realm/truth) — Division of authority between Nimi clients and Realm services;
- [State Projections](/realm/projection) — How consumer applications ingest read-only structured views via the SDK;
- [World State](/realm/world-state) — Current world snapshot storage and atomic commit envelopes;
- [World History](/realm/world-history) — Immutable, append-only chronological ledgers and audit replays.

### Core Domain Primitives
- [Chat & Communication](/realm/chat) — Cross-world realtime messaging, delivery semantics, and thread lifecycles;
- [Social & Economic Systems](/realm/social-and-economy) — Global friend graphs, follows, and value flows;
- [Assets and Bindings](/realm/asset-and-binding) — Attaching creator assets and digital items to world scenes;
- [Transit & Continuity](/realm/transit) — Navigating between worlds via the central OASIS hub.

### Creator Ecosystem and App Interconnect
- [Creator Economy](/realm/creator-economy) — Digital content publishing, royalty settlements, and rights management;
- [Creator Payouts](/realm/creator-payouts) — Transparent payout ledgers and disbursement auditing;
- [App Interconnect](/realm/app-interconnect) — Best practices for third-party apps integrating Realm state.

## Why Nimi Applications Depend on Realm

Digital worlds are not isolated islands. When users participate across desktop, web, or mobile devices, their identities, friend circles, and inventories travel with them seamlessly. Realm guarantees cross-platform consistency, eliminating fragmented local states.

## Related Documentation

- [Unified Glossary](/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
