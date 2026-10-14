# Application Interconnect and Realm Integration Patterns

Nimi applications connect to Realm through Runtime-mediated host bindings rather than direct network calls. Runtime manages Realm credentials and remote connections on behalf of the host, exposing an explicitly admitted set of operations for world authoring and social presence while keeping local agent runtime data separate from shared Realm resources.

## Access Prerequisites and Runtime Mediation

Every application request to Realm must pass through three layers of control:

1. **Protected Host Session**: The application must run inside an active, authenticated host session.
2. **Manifest Declaration**: The application manifest must declare the required `realm.data` capability scope.
3. **Runtime Admission and Realm Authorization**: Runtime only forwards fixed-type operations that it explicitly admits, and Realm still validates resource-level authorization on every request.

For Realm access, Apps use the protected client rather than handling Realm Bearer tokens, direct HTTP requests, or socket lifecycles. Internal transport protocols or low-level SDK exports do not grant general applications direct access to un-admitted Realm endpoints.

## Admitted Realm Operations

Current world and character settings are defined through `WorldCore`, `WorldCharacter`, and `PersonaCharacter`. General applications access Realm through existing host bindings—specifically `client.realm.worldCore` and `client.realm.personaCharacter`—and can only invoke the fixed operations admitted by Runtime:

| Resource / Binding | Admitted Operations | Operational Rules |
| --- | --- | --- |
| **`WorldCore`** (`client.realm.worldCore`) | `list`, `get`, `create`, `replace`, creation eligibility | Creating a new world requires explicit world creation eligibility granted to the account by a Realm administrator; `realm.data` scopes, subscriptions, or existing world ownership do not substitute for this grant, and reading eligibility does not replace the authorization re-check performed during `create`. `replace` requires `baseContentHash` and updates the record in place—saving or modifying a record does not publish a catalog release. |
| **`WorldCharacter`** | `list`, `get`, `create`, `replace` | Operated independently from `WorldCore`; changes to world settings and characters are saved per resource rather than bundled into a single multi-object transaction. |
| **`WorldEntity`** | `list`, `get`, `create` | Supports listing, inspecting, and creating entities within authorized worlds. |
| **`WorldRelationship`** | `list`, `get` | Read-only for applications; `create` is not admitted on the application surface. |
| **`PersonaCharacter`** (`client.realm.personaCharacter`) | Host-bound access | Reads and interacts with persona character profiles through the `client.realm.personaCharacter` host binding. |

## Realtime Channels and State Boundaries

Not all application traffic or runtime state flows into Realm:

- **Admitted Realtime Channels**: Runtime maintains remote realtime connections for the host, but application-accessible realtime features are currently limited to human-to-human `DirectChat`, `typing`, `inbox`, and `Presence`. System `Notification` streams and general world event broadcasts are not admitted.
- **Local Agent and Cognition Data**: `LocalAgent` conversations are handled by Runtime, and `Cognition` manages per-agent long-term memory through Runtime mediation. Application runtime data does not automatically synchronize to Realm.
- **Planned Shared State Contracts**: Realm `WorldState` and `WorldHistory` are planned independent contracts (design reference only). There are currently no approved controllers, tracked OpenAPI read/write operations, or realtime state/history subscriptions available to applications.

## Related Documentation

- [World State and History (Design Reference)](/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
