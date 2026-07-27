# Realm And Runtime As Siblings

Realm and Runtime are independent product authorities.

| Realm owns | Runtime owns |
| --- | --- |
| Character identity and Character Source | LocalAgent materialization and lifecycle |
| World Source and canonical World data | Local and Cloud AI consumption |
| Social, economy, World state, and World history | Conversation, operational Memory and Knowledge |
| Realm access rules and cloud audit | Local readiness, budget, credentials, and App authorization |

## Interaction

Realm issues or projects the Character and World sources that Runtime is
authorized to consume. Runtime materializes a LocalAgent from a Character
Source and may use admitted World Source context during execution.

Runtime does not write operational Memory or Knowledge back as canonical Realm
World state. Realm does not execute LocalAgent turns or decide Runtime routes.
Any cross-domain mutation uses the owning domain's public contract.

SDK presents the bounded consumer surface. Nimi Home, Desktop, Avatar, and Apps
remain consumers; none can merge the two owners into a host-local truth.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
