# World Schema and Core Fields Reference

This reference defines the active data structures for world settings and characters in Nimi, the Runtime operations currently available to applications, and the design reference for planned shared state and history contracts.

## World Data Overview: Active vs. Planned Contracts

World data in Realm is separated into active authoring models and planned runtime state contracts:

| Domain | Status | Scope and Responsibility |
| --- | --- | --- |
| **World & Character Settings (`WorldCore`, `WorldCharacter`, `PersonaCharacter`)** | **Active** | Foundational world definitions, lore declarations, character profiles, entities (`WorldEntity`), and relationships (`WorldRelationship`). |
| **World State (`WorldState`)** | **Planned (Design Reference)** | Persistent shared state across a world. Not yet exposed via approved controller endpoints or tracked OpenAPI read/write operations. |
| **World History (`WorldHistory`)** | **Planned (Design Reference)** | Append-only log of admitted historical facts. Not yet exposed via approved controller endpoints or tracked OpenAPI read/write operations. |

## `WorldCore` DTO Fields

The `WorldCore` object represents a world's foundational configuration and metadata:

| Field | Type / Values | Description |
| --- | --- | --- |
| `id` | `string` | Unique, immutable identifier for the world. |
| `schemaVersion` | `string` | Schema version of the `WorldCore` payload. |
| `contentRevision` | `number` | Revision counter tracking updates to the world record. |
| `contentHash` | `string` | Hash of the current content, used for optimistic concurrency control (`baseContentHash`) when replacing records. |
| `origin` | `RealmCoreOriginDto` | Source origin classification of the world record. |
| `visibility` | `'private' \| 'unlisted' \| 'public' \| 'system'` | Access and discovery tier for the world. |
| `lorebookDeclaration` | `WorldLorebookDeclarationV1Dto \| null` | Structured lorebook metadata associated with the world. |
| `core` | `WorldCoreValueDto` | Core world setting payload. |
| `createdAt` | `string` | Creation timestamp. |
| `updatedAt` | `string` | Last modification timestamp. |
| `creatorId` | `string \| null` (optional) | Nullable account identifier of the creator. |

## Application Access and Supported Operations

Applications do not hold raw Realm Bearer tokens or open direct HTTP or socket connections to Realm. All Realm access is mediated by the Runtime and requires:

1. An active, protected host session.
2. The `realm.data` permission declared in the application manifest.
3. Runtime admission, followed by Realm resource-level authorization.

Through the existing host bindings (`client.realm.worldCore` and `client.realm.personaCharacter`), applications can invoke only the fixed typed operations admitted by the Runtime:

| Resource | Supported App Operations | Notes |
| --- | --- | --- |
| `WorldCore` | `list`, `get`, `create`, `replace`, creation eligibility check | Updating a record via `replace` requires `baseContentHash`. Saving or replacing a record updates that resource directly rather than publishing a multi-object release bundle. |
| `WorldCharacter` | `list`, `get`, `create`, `replace` | Managed as independent resources separate from `WorldCore` updates. |
| `WorldEntity` | `list`, `get`, `create` | Fixed typed entity operations. |
| `WorldRelationship` | `list`, `get` | Read-only for applications; app-side relationship creation is not supported. |

> **World Creation Eligibility**: Creating a new world (`WorldCore.create`) requires an explicit grant from a Realm administrator on the user account. Declaring `realm.data`, holding a subscription, or owning other worlds does not grant creation rights. Checking creation eligibility is informational and does not replace the authoritative permission check performed at creation time.

> **Realtime & Local Agent Boundaries**: Runtime manages all remote realtime connections. Currently admitted realtime channels for applications are limited to person-to-person DirectChat, typing indicators, inbox updates, and Presence; notifications and generic world event broadcasts are not admitted. LocalAgent conversations are handled by the Runtime, with per-agent long-term memory managed by Cognition through Runtime mediation.

## Planned Contracts: World State and World History (Design Reference)

`WorldState` and `WorldHistory` are planned independent contracts. They do not currently provide callable controller endpoints, tracked OpenAPI operations, or application-level state/history subscriptions. The following specifications serve as an architectural design reference.

### Scope of Shared State

- **`WorldState`** is reserved strictly for persistent shared state. It excludes application story runtime variables, prompt context, rendering state, cursors, and ephemeral session data.
- **`WorldHistory`** records only admitted occurred facts. Corrections are handled by appending replacement or invalidation records rather than performing silent hard deletes. Private story logs do not automatically become world history.

### Planned Commit Envelope

Proposed state and history submissions use a structured commit envelope:

| Field | Specification |
| --- | --- |
| `worldId` | Target world identifier. |
| `appId` | Submitting application identifier. |
| `sessionId` | Active session identifier. |
| `scope` | `'WORLD' \| 'ENTITY' \| 'RELATION'` (`ENTITY` and `RELATION` scopes require specific schemas and do not accept arbitrary generic JSON). |
| `effectClass` | `'NONE' \| 'STATE_ONLY' \| 'STATE_AND_HISTORY'` (must be specified explicitly; no default is assumed). |
| `schemaId` | Target schema identifier. |
| `schemaVersion` | Target schema version. |
| `actorRefs` | References to the actors involved in the submission. |
| `reason` | Declared reason for the state or history transition. |
| `evidenceRefs` | Supporting evidence references for the transition. |

### Mutation Modes

- **`REPLAY`**: Strictly prohibited from committing shared `WorldState` or appending to `WorldHistory`, with no exceptions.
- **`CANON_MUTATION`**: Requires matching an explicit authorization matrix across application, schema, `effectClass`, and `scope`.

## The OASIS System World

- **System World**: OASIS is Nimi's primary system world (`visibility: 'system'`).
- **Accessible Core Data**: Applications can read OASIS `WorldCore` data and character profiles through the standard formal interfaces.
- **Transit and Roaming**: Architectural designs for cross-world transit are covered in the OASIS and Transit protocol documentation; applications should not assume automatic cross-world teleportation or automatic network enrollment upon saving a world record.

## Related Documentation

- [World State Architecture](/realm/world-state)

## Source Basis

- [`config/realm-openapi/api-nimi.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/realm-openapi/api-nimi.yaml)

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
