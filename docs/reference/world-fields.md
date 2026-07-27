# World Fields

Reference for the World concept: what a world is at the field and
contract level.

## What A World Is

| Property | Description |
| --- | --- |
| Identity | A unique world id; sortable; non-recyclable |
| Authoring | Created by an admitted world creator |
| Persistence | Long-lived; world state survives session boundaries; world history is append-only |
| Composability | Interoperable with other worlds via the six platform primitives |
| Authority | Realm owns canonical world truth, world state, and world history |

A world is not a level, a chat room, a campaign, or an app session. A
world keeps evolving even when no participants are present.

## Three Related Realm Concepts

| Concept | What it answers | Owner contract |
| --- | --- | --- |
| Truth | What is canonically true in this world, regardless of when it was written | `realm/kernel/truth-contract.md` (`R-TRUTH-*`) |
| World State | What the world looks like right now | `realm/kernel/world-state-contract.md` (`R-WSTATE-*`) |
| World History | How the world reached its current state | `realm/kernel/world-history-contract.md` (`R-WHIST-*`) |

These three are not interchangeable. A surface that conflates them
silently loses information.

## Adjacent Realm Surfaces Owned As World Truth

| Surface | Contract | Rule prefix |
| --- | --- | --- |
| Chat | `realm/kernel/chat-contract.md` | `R-CHAT-*` |
| Social | `realm/kernel/social-contract.md` | `R-SOC-*` |
| Economy | `realm/kernel/economy-contract.md` | `R-ECON-*` |
| Asset | `realm/kernel/asset-contract.md` | `R-ASSET-*` |
| Transit | `realm/kernel/transit-contract.md` | `R-TRANSIT-*` |
| Binding | `realm/kernel/binding-contract.md` | `R-BIND-*` |
| Resource | `realm/kernel/resource-contract.md` | `R-RSRC-*` |
| Bundle | `realm/kernel/bundle-contract.md` | `R-BNDL-*` |

## OASIS

| Property | Value |
| --- | --- |
| Status | The unique system main world; formally part of canonical truth |
| Ownership | Cannot be owned by any creator |
| Replaceability | Cannot be replaced by an app convention |
| Role | Default return point and sole transit hub between worlds |

## App-World Binding

A world can bind to at most one active extension-app at a time. Other
apps may consume world data in render-only mode.

| State | Meaning |
| --- | --- |
| `(new)` | World exists but no app is bound |
| `active` | One extension-app is bound and writing |
| `suspended` | Binding is paused; rebinding requires explicit re-admission |
| `revoked` | Binding is removed; world becomes available for new binding |

Re-binding requires revoking first; binding is not silently transferred.

## App Modes

| Mode | Read | Write | Concurrent count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active |

## Six-Primitive Cross-Consistency

A world transition that involves multiple primitives must satisfy all
relevant primitive contracts simultaneously:

- A transit must satisfy Social + Economy + Context simultaneously.
- Presence can't bypass social admission.
- Timeflow cannot break economy settlement windows.

The six primitives are not independent enums; they are mutually
constraining.

## Source Basis

- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
