# Realm Core Service and World Substrate

Realm is the server-side service layer of Nimi, maintaining shared accounts, social graphs, human-to-human messaging, world and character settings (`WorldCore`, `WorldCharacter`, `PersonaCharacter`), and creator economy records.

Platform responsibilities are divided across four layers:
- **Runtime**: Executes local and cloud AI inference, manages `LocalAgent` conversations and mediates access to per-agent memory owned by Cognition, and mediates Realm credentials and remote realtime connections.
- **Realm**: Manages shared account identities, social relationships, human-to-human realtime channels (`DirectChat`, typing, inbox, and `Presence`), world and character data (`WorldCore`, `WorldCharacter`, `PersonaCharacter`, `WorldEntity`, and `WorldRelationship`), and creator economy services.
- **SDK**: Provides typed client bindings—such as `client.realm.worldCore` and `client.realm.personaCharacter`—that connect applications to Runtime-admitted capabilities.
- **Desktop & Web**: Desktop hosts Nimi Home and supervised Apps; Web provides the public website and browser account experience.

## Chapter Guide

### Authoritative State and Data Models
- [Realm Architectural Boundaries](/realm/truth) — Division of authority and access boundaries between Runtime, host sessions, and Realm services.
- [State Projections](/realm/projection) — How applications read structured views through admitted SDK surfaces.
- [World State](/realm/world-state) — Design reference for the planned persistent shared world state contract and commit envelope model.
- [World History](/realm/world-history) — Design reference for the planned append-only world history contract and correction records.

### Core Domain Primitives
- [Chat & Communication](/realm/chat) — Runtime-mediated human-to-human `DirectChat`, typing indicators, inbox, and `Presence`.
- [Social & Economic Systems](/realm/social-and-economy) — Shared social graphs, follows, and economic value flows.
- [Assets and Bindings](/realm/asset-and-binding) — Creator assets and resource associations.
- [Transit & Continuity](/realm/transit) — Protocol design for cross-world continuity centered on the OASIS system primary world.

### Creator Ecosystem and App Interconnect
- [Creator Economy](/realm/creator-economy) — Digital content monetization and revenue distribution.
- [Creator Payouts](/realm/creator-payouts) — Payout records and settlement workflows.
- [App Interconnect](/realm/app-interconnect) — Integrating Realm data through protected host sessions, `realm.data` manifest permissions, and Runtime admission.

## How Nimi Applications Work with Realm

Not all application data is automatically synced to Realm. Understanding what lives in Realm versus Runtime keeps application architecture clean:

- **Mediated Access & Security**: Applications never handle Realm Bearer tokens, raw HTTP clients, or direct sockets. Realm access requires an active protected host session, the `realm.data` declaration in the app manifest, Runtime admission, and Realm resource-level authorization.
- **World & Character Settings**: Ordinary applications use fixed typed bindings (`client.realm.worldCore` and `client.realm.personaCharacter`) for Runtime-admitted operations on `WorldCore`, `WorldCharacter`, `WorldEntity`, and `WorldRelationship`. Creating a new world additionally requires explicit account eligibility granted by a Realm administrator.
- **Scoped Realtime & Local Agent Memory**: Admitted realtime channels cover human-to-human `DirectChat`, typing, inbox, and `Presence`. Runtime handles `LocalAgent` conversations; Cognition owns per-agent long-term memory, accessed through Runtime. Meanwhile, `World State` and `World History` remain planned contracts without public read/write APIs; generic world event broadcasts are also unavailable.

## Related Documentation

- [Unified Glossary](/reference/glossary)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
