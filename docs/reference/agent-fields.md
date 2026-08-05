# Character and LocalAgent Fields

Nimi uses separate identifiers and owners for persistent Character truth and
local AI execution.

| Field or concept | Owner | Meaning |
| --- | --- | --- |
| Character reference | Realm | Persistent identity and social/world reference |
| PersonaCharacter / WorldCharacter | Realm | Character forms owned by Realm |
| Character Source | Realm | Identity source Runtime may use for materialization |
| World Source | Realm | World context source; not sufficient to create LocalAgent identity |
| LocalAgent ID | Runtime | Owner-scoped local execution entity |
| LocalAgent owner | Runtime | Explicit owner relation; never inferred from an App cache |
| Conversation anchor | Runtime | One explicit LocalAgent Conversation |
| Operational Memory | Runtime | Authorized LocalAgent recall and retention |
| Operational Knowledge | Runtime | Authorized LocalAgent ingestion and retrieval |
| AI capability execution | Runtime | Capability-intent evaluation, implementation selection, quota, budget, and execution diagnostics |
| Presentation configuration | Runtime | Durable LocalAgent inputs for authorized projections |
| Transient presentation state | Runtime | Turn, state, activity, emotion, voice, and timing projection |
| Renderer state | Avatar or consuming App | Ephemeral rendering, playback, and interaction only |

## Access fields

Runtime derives account, App identity, authorization, target LocalAgent or
scope, and operation from the active session. A consumer may submit a
LocalAgent ID as a target, but the ID is not an authorization proof.

Realm JWTs, provider credentials, Runtime session proof, private authorization
evidence, raw source context, and account-wide LocalAgent inventory are not App
fields.

## Continuity

A LocalAgent ID does not identify a Conversation. Consumers keep the explicit
Conversation anchor returned by Runtime. Multiple Conversations may belong to
one LocalAgent, and multiple LocalAgents may be materialized from one Character
Source without sharing mutable operational state.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
