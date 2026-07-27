# App Interconnect

`app-interconnect-model.md` and `realm-interop-mapping.md` describe
how apps connect into Realm and how the realm primitive
interoperability mapping works. This page is the reader's view of
how an app crosses into Realm.

## How Apps Connect To Realm

| Path | Purpose |
| --- | --- |
| REST | Typed Realm reads / mutations under admitted contracts |
| WebSocket | Realtime delivery of canonical events |

Apps connect to Realm through admitted REST + WS surfaces; they
do not invent their own protocols. Authorization is bearer token
issued under admitted token issuance flow.

## App Modes And Realm Authority

A render-app reads Realm; an extension-app reads and writes Realm
within its admitted binding scope.

| Mode | Realm read | Realm write | Concurrent count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active per world |

A world's at-most-one-active-extension-app rule comes from this:
if two extension-apps could both write Realm canonical state for
the same world simultaneously, the canonical state would race.

## Interop Mapping

Realm interop mapping translates Realm concepts to / from external
open-spec anchors (cross-protocol mappings). It bridges:

| Bridge | Purpose |
| --- | --- |
| World state contract ↔ external state representations | When a Realm world's state needs to be visible externally |
| World history contract ↔ external history representations | Cross-platform history compatibility |
| Runtime memory ↔ Realm memory | Replication semantics |
| Runtime agent ↔ Realm agent | Identity bridging |
| Transit contract ↔ external transit shapes | Cross-protocol transit compatibility |

The interop mapping is the formal translation layer. It doesn't
mutate Realm; it projects Realm into shapes that other systems
can consume.

## Reader Scenario: An App Reads Then Acts

A render-app wants to display a world; later, the user upgrades
to an extension-app that mutates state.

1. **Render-app starts.** App reads Realm under render mode.
2. **User wants more.** User upgrades the relationship to
   extension-app mode.
3. **App-world binding.** The extension-app binds to the world
   (one active at a time).
4. **Mutation.** The extension-app submits typed commit
   envelopes for state mutations.
5. **Realm admits.** Each mutation passes admitted authorization
   matrix.
6. **Audit lineage.** Each mutation recorded.

The transition from render-only to extension-with-write requires
explicit binding. There is no silent privilege escalation.

## Reader Scenario: A Realtime Event Stream

An app wants to react to canonical events as they happen.

1. **Subscribe.** App opens a WebSocket subscription to Realm
   under admitted subscription surface.
2. **Realtime delivery.** Events arrive as they commit.
3. **App reacts.** Typed event handlers under admitted shapes.
4. **Connection lifecycle.** Reconnect, backpressure, etc. under
   admitted connection contract.

Realtime is admitted; apps do not invent their own polling
protocols when realtime is available.

## Reader Scenario: External System Bridges Realm

An external system wants to mirror Realm world history.

1. **Read via interop mapping.** External system reads Realm
   history under admitted interop mapping.
2. **Translate to external shape.** The mapping projects Realm
   concepts to external open-spec representations.
3. **External system consumes.** No mutation flowing back unless
   admitted.

The bridge is one-directional read by default. A bidirectional
bridge requires admitted bidirectional contract — not implicit.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Realm canonical truth | Realm kernel |
| App access to Realm | Admitted REST + WS surfaces |
| App-world binding | App authorization preset + binding contract |
| Realtime delivery | Admitted subscription surface |
| External system bridges | Realm interop mapping |
| Cross-protocol shape | Interop mapping bridge |

## Source Basis

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
