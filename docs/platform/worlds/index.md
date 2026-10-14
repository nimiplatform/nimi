# Worlds Architecture Overview

Worlds (`World`) are the core creative domains and narrative environments of the Nimi platform.

## What is a World

In Nimi, a World is a persistent environment defined by its core lore, characters, entities, and relationships. Rather than treating every interaction as an isolated session, a world provides durable context where characters reside and stories unfold.

Participants—both human users and AI agents—are not isolated constructs trapped inside a single application: accounts and persona characters carry consistent identities across the platform, while long-term agent memories are managed per agent by Cognition through Runtime.

A world is **not**:
- **A Chat Room**: Dialogue is one way to interact inside a world; the world provides the lore, characters, and structural context around that dialogue.
- **A Transient Session**: Individual play or story sessions come and go, while the world's core settings and character definitions persist in Realm.
- **A Single Level**: Levels are scripted encounters; a world defines reusable settings, characters, entities, and relationships across sessions.
- **An Application**: Applications project user interfaces and local experiences; a world is the underlying domain record stored in Realm.

## Architectural Layers of a World

A world in Realm separates currently available authoring records from planned shared state and history contracts. See [State vs History](/platform/worlds/state-vs-history) for the detailed design reference.

| Layer | Architectural Role | Current Status |
| --- | --- | --- |
| **World Authoring & Settings** | Authoritative world settings and rosters defined through `WorldCore`, `WorldCharacter`, `PersonaCharacter`, `WorldEntity`, and `WorldRelationship` | **Current interface** through Runtime-admitted host bindings |
| **World State** | Persistent shared world state across sessions (`WORLD` / `ENTITY` / `RELATION` scopes), excluding app runtime variables, prompt context, or render state | **Planned contract** (design reference only; no active controller or tracked OpenAPI read/write endpoints) |
| **World History** | Append-only record of admitted occurred facts, where corrections append replacement or invalidation records rather than hard deletes | **Planned contract** (design reference only; no active controller or tracked OpenAPI read/write endpoints) |

Keeping these layers distinct prevents applications from mixing authoring definitions, private session variables, and shared history.

## Adjacent Realm and Runtime Capabilities

Worlds work alongside other platform capabilities mediated by Runtime and Realm:

| Capability | Architectural Responsibility |
| --- | --- |
| **Direct Chat & Presence** | Runtime-admitted realtime channels for human-to-human DirectChat, typing indicators, inbox updates, and Presence |
| **LocalAgent & Cognition** | LocalAgent dialogue execution in Runtime and per-agent long-term memory managed by Cognition through Runtime |
| **Social & Economy** | Platform account relationships, permissions, and settlement rails managed by Realm |
| **OASIS & Transit** | The `OASIS` system main world and the spatial transit protocol design (see [OASIS](/platform/worlds/oasis)) |

Apps access Realm through a protected host session, manifest `realm.data` declaration, and Runtime admission. Runtime holds Realm credentials and remote realtime connections; apps do not handle raw Bearer tokens, direct HTTP requests, or raw sockets, and generic world event broadcasting or notification streams are not open to apps.

## Section Contents

- [State vs History](/platform/worlds/state-vs-history): Design reference for planned `WorldState` and `WorldHistory` contracts, commit envelopes, and `effectClass` rules.
- [OASIS](/platform/worlds/oasis): The system main world (`OASIS`) and the transit protocol design.
- [Lifecycle](/platform/worlds/lifecycle): World creation eligibility, independent `WorldCore` and `WorldCharacter` authoring, `baseContentHash` updates, and visibility settings.

For schema-level field definitions, see [Reference → World Fields](/reference/world-fields).

## Scenario: Interacting with a World

When a user opens an application that loads a world:

- **Consistent Identity**: The user operates under their protected host session, and persona definitions (`PersonaCharacter`) can be accessed through the host-bound Realm client.
- **Controlled Data Access**: The app reads `WorldCore`, `WorldCharacter`, `WorldEntity`, and `WorldRelationship` records through Runtime-admitted operations, with Realm enforcing resource authorization.
- **Private Agent Memory**: Conversations with a `LocalAgent` are handled by Runtime, and long-term agent memories are stored per agent by Cognition via Runtime. App session data and private story logs do not automatically sync to Realm or become public world history.
- **System Main World (`OASIS`)**: `OASIS` serves as the system main world whose `WorldCore` and character profiles are accessible through standard interfaces. For the cross-world transit protocol design, see [OASIS](/platform/worlds/oasis).

## Scenario: Authoring and Updating a World

With world creation eligibility, a creator can save the setting first, then build out its characters and entities. Existing records are updated through their own operations; when concurrent edits conflict, read the latest version before deciding how to merge them.

Realm administrators grant creation eligibility, and saving a record does not itself publish it to a catalog. See [World Lifecycle](/platform/worlds/lifecycle) for operations and version conditions, and [World Fields](/reference/world-fields) for the data reference.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
