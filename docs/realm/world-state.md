# World State and Commit Envelope Model

In Nimi's world architecture, **World State** is a planned contract that represents the authoritative, persistent shared state of a world—answering the question: "What is the shared state of this world right now?"

> **Design Reference Only:** World State and World History are planned independent contracts. Realm does not currently expose active controllers, tracked OpenAPI read/write operations, or realtime world-event broadcasts for World State, and any underlying database models do not represent callable APIs. Today, applications interact with world and character settings through Runtime-admitted operations on `WorldCore`, `WorldCharacter`, `WorldEntity`, `WorldRelationship`, and `PersonaCharacter`.

For an architectural comparison between persistent shared State and append-only History, see [World State vs. History](/platform/worlds/state-vs-history).

## State Boundaries: What Belongs in World State

In the planned model, World State is reserved strictly for **persistent shared state** governed by Realm:

- **In Scope:** Durable, shared world state that applies across the world and is mutated through explicit schema and authorization rules.
- **Out of Scope:** Application story runtime variables, prompt context, rendering state, cursor positions, and other transient or client-local indicators. These remain local to the application or session and are never stored in World State.

## Planned Commit Envelope

In the planned contract, every proposed mutation to World State is submitted through a structured Commit Envelope:

| Field | Description |
| --- | --- |
| `worldId` | Target world identifier |
| `appId` | Calling application identifier |
| `sessionId` | Session identifier associated with the operation |
| `effectClass` | Declared mutation impact (`NONE`, `STATE_ONLY`, or `STATE_AND_HISTORY`) |
| `scope` | Target granularity (`WORLD`, `ENTITY`, or `RELATION`) |
| `schemaId` / `schemaVersion` | Schema identifier and version governing the state payload |
| `actorRefs` | References to the users or characters initiating the change |
| `reason` | Human-readable summary of the intent behind the change |
| `evidenceRefs` | References to supporting evidence for the mutation |

## Mutation Scopes and Effect Classes

### Scopes (`scope`)

- `WORLD`: Mutates world-level shared state.
- `ENTITY`: Mutates shared state for a specific entity.
- `RELATION`: Mutates shared state for a relationship between entities.

`ENTITY` and `RELATION` mutations do not accept arbitrary free-form JSON structures; all mutations must conform to explicit schema definitions (`schemaId` and `schemaVersion`).

### Effect Classes (`effectClass`)

The contract does not define a default `effectClass`; callers must declare one explicitly:

- `NONE`: Produces no shared state mutation and appends no history record.
- `STATE_ONLY`: Updates persistent shared World State without appending an entry to World History. This still applies only to durable shared state—not transient indicators, cursors, or rendering state.
- `STATE_AND_HISTORY`: Updates persistent shared World State and appends an accepted fact to [World History](/realm/world-history).

## Execution Modes and Authorization Rules

Shared state mutations are governed by strict session mode and authorization boundaries:

- **`REPLAY` Mode:** Strictly prohibits both shared World State commits and World History appends. There are no exceptions that allow a `REPLAY` session to write shared state.
- **`CANON_MUTATION` Mode:** Requires an exact authorization matrix match across the calling `appId`, `schemaId` / `schemaVersion`, `effectClass`, and `scope` before a state commit can be accepted.
- **History Integrity:** World History only records accepted facts of what occurred. Private story logs do not automatically become World History, and corrections are represented by appending superseding or invalidating records rather than silently deleting existing entries.

## Related Documentation

- [World History & Append-Only Log](/realm/world-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
