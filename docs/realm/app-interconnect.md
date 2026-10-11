# Application Interconnect and Realm Integration Patterns

Nimi applications operate as external clients connecting to Realm via standardized interfaces. Through the SDK, applications query authoritative world states, listen to realtime event notifications, and submit verified mutations.

## Communication Channels

| Channel | Core Purpose | Protocol Characteristics |
| --- | --- | --- |
| **REST APIs** | Standard read queries and structured transaction submissions | Validated strictly against registered OpenAPI request schemas |
| **WebSocket / SSE** | Realtime subscription and streaming of canonical events | Low-latency bi-directional or streaming updates across clients |

Applications typically use `client.realm` provided by the SDK. Session tokens are managed securely by Runtime, freeing application developers from handling low-level bearer tokens or implementing socket keepalive mechanisms manually.

## Application Operating Modes

Applications declare operational modes depending on whether they read or mutate world data:

| Operating Mode | Read Access | Write Access | Max Concurrent per World | Typical Use Cases |
| --- | --- | --- | --- | --- |
| **`render-app`** | Yes | No | Uncapped (Multiple concurrent) | Lore viewers, spectator cameras, dashboard overlays |
| **`extension-app`** | Yes | Yes | **Exactly 1 active per world** | Core world mechanics, game masters, storyline controllers |

> **Concurrency Invariant**: Restricting a world to at most one active `extension-app` prevents race conditions and divergent timeline mutations, guaranteeing deterministic state progression.

## Interoperability Mappings

When external game engines (such as Unity, Unreal Engine, or custom WebGL clients) consume Realm data, standardized bridges export read-only representations:
- **State Serialization**: Transforms Realm internal world states into standard JSON scene graphs.
- **Timeline Export**: Emits append-only chronological event logs for downstream analytics and story replay engines.

## Related Documentation

- [World State Commit Envelopes](/realm/world-state)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
