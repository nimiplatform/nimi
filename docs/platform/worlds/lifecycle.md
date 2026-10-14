# World Lifecycle Management

Worlds in Nimi evolve through explicit resource operations governed by Realm and mediated by Runtime. Rather than relying on monolithic release bundles, world authoring and maintenance revolve around canonical setting sources—`WorldCore`, `WorldCharacter`, and `PersonaCharacter`—alongside structured entities and relationships.

For field-level definitions and runtime state references, see [Reference → State Machines](/reference/state-machines) and [Reference → World Fields](/reference/world-fields).

## World Creation and Eligibility

Creating a new world in Realm is a privileged operation:

- **Explicit Administrator Grant**: An account must be explicitly granted world creation eligibility by a Realm administrator before it can create a world.
- **No Implicit Substitutes**: Declaring `realm.data` in an application manifest, holding an active subscription, or already owning other worlds does not grant creation eligibility.
- **Pre-Check vs. Authoritative Enforcement**: Applications can query creation eligibility through `client.realm.worldCore`, but reading eligibility is only a convenience pre-check—Realm always re-verifies eligibility authoritatively when a `create` request is submitted.

## Authoring and Resource Operations

World data is maintained across distinct resource types rather than published in a single cross-object transaction. Regular applications interact with world resources through the host bindings `client.realm.worldCore` and `client.realm.personaCharacter`, executing only fixed-type operations explicitly admitted by Runtime:

| Resource / Surface | Admitted Operations | Operational Notes |
| --- | --- | --- |
| **`WorldCore`** | `list`, `get`, `create`, `replace`, creation eligibility | Core world settings and metadata; `WorldCore` and `WorldCharacter` are updated independently |
| **`WorldCharacter`** | `list`, `get`, `create`, `replace` | Characters bound to a specific world |
| **`WorldEntity`** | `list`, `get`, `create` | Structured world entities |
| **`WorldRelationship`** | `list`, `get` | Read-only for applications; app-initiated relationship creation is not available |
| **`PersonaCharacter`** | Host-bound operations via `client.realm.personaCharacter` | Independent persona character definitions |

### `WorldCore` Structure and Visibility

A `WorldCore` DTO contains the following fields:

- `id`: Unique world identifier
- `schemaVersion`: Schema version of the core payload
- `contentRevision`: Revision counter for the world record
- `contentHash`: Hash of the current core content
- `origin`: Creation origin metadata
- `visibility`: Access scope (`private`, `unlisted`, `public`, or `system`)
- `lorebookDeclaration`: Associated lorebook declaration structure
- `core`: The structured world core definition
- `createdAt` / `updatedAt`: Record timestamps
- `creatorId`: Optional (nullable) creator account reference

### Optimistic Concurrency with `baseContentHash`

Updating an existing `WorldCore` or `WorldCharacter` via `replace` requires passing the `baseContentHash` from the version being edited. Realm verifies that `baseContentHash` matches the current `contentHash` before accepting the replacement, preventing concurrent edits from silently overwriting each other.

Saving or replacing a `WorldCore` record updates the stored resource and its `contentRevision` / `contentHash` in place; it does not trigger a separate catalog publication pipeline.

## Application Access and Runtime Mediation

Applications never connect to Realm with raw credentials or direct network sockets:

1. **Three-Layer Access Control**: Every Realm operation from an application requires an active protected host session, the `realm.data` permission declared in the app manifest, and Runtime admission. Realm independently enforces resource-level authorization on each call.
2. **Credential and Transport Isolation**: Runtime holds all Realm credentials and manages remote connections. Applications do not receive Bearer tokens, raw HTTP clients, or direct WebSocket connections.
3. **Scoped Realtime Channels**: Admitted realtime capabilities are limited to human-to-human DirectChat, typing indicators, inbox updates, and Presence. Generic world event broadcasts and notification streams are not exposed to applications.
4. **LocalAgent and Cognition Boundaries**: LocalAgent conversations run inside Runtime, and per-Agent long-term memory is managed by Cognition through Runtime mediation. Local application state and agent interactions are not automatically synchronized back to Realm.

## OASIS and Cross-World Context

OASIS is the system main world (`system` visibility). Its `WorldCore` and resident character profiles can be read through the standard `client.realm.worldCore` interfaces. For architectural concepts regarding cross-world navigation and roaming design, see [OASIS](/platform/worlds/oasis).

## Planned Shared State and History

World State and World History define models for durable shared state and admitted facts. They have no current public read/write APIs and are separate from the WorldCore and character records available for editing today.

The planned contracts require explicit submission and exact authorization. `REPLAY` cannot write shared state or history, and private story logs do not automatically become world history. See [State vs History](/platform/worlds/state-vs-history) for the full model.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
