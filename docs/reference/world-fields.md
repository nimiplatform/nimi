# World Schema and Core Fields Reference

This reference provides definitions and contract structures for the digital World concept within Nimi.

## Core Attributes of a Digital World

| Attribute | Specification |
| --- | --- |
| **World Identifier (`worldId`)** | Globally unique, immutable string with time-sortable properties |
| **Creator Ownership (`creatorId`)** | User or organization account holding governance and monetization rights |
| **Durable Continuity** | Exists independently of user presence, persisting across session boundaries |
| **Protocol Composability** | Operates over the six core primitives (Timeflow, Social, Economy, Transit, Context, Presence) |
| **Single Source of Truth** | Canonical rules, live state, and historical events are maintained authoritatively by Realm |

## Three Structural Pillars

| Pillar | Focus | Authoritative Governing Contract |
| --- | --- | --- |
| **Authoritative Truth (`Truth`)** | Authoritative world settings, rules, identities, and core objects (evolvable via authorized CorePatch or WorldRelease) | Realm Truth owner (`R-TRUTH-*`) |
| **World State** | Normalized snapshot of the world right now | Realm World State owner (`R-WSTATE-*`) |
| **World History** | Append-only event log showing how the world reached this state | Realm World History owner (`R-WHIST-*`) |

## The OASIS Hub World Invariant

- **System Hub**: OASIS is the primary network hub connecting all federated digital worlds.
- **Platform Public Utility**: Not owned by private creators; governed as a neutral platform commons.
- **Default Recovery Haven**: Acts as the safe fallback destination when target worlds are offline or unreachable.

## App-World Binding States

| Binding State | Definition |
| --- | --- |
| `(new)` | World created; zero active extension applications attached |
| `active` | One extension app verified and authorized with write privileges |
| `suspended` | Binding paused temporarily; mutations intercepted |
| `revoked` | Binding detached; world open for new applicant applications |

> **Concurrency Constraint**: A world permits at most one active `extension-app` to prevent race conditions in canonical state. Multiple read-only `render-apps` may attach concurrently without restriction.

## Related Documentation

- [World State Architecture](/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
