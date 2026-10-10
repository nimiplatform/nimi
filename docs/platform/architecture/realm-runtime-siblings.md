# Realm And Runtime As Siblings

Realm and Runtime are independent product authorities.

| Realm owns | Runtime owns |
| --- | --- |
| Character identity and Character Source | LocalAgent materialization and lifecycle |
| World Source and canonical World data | Local and Cloud AI consumption |
| Social, economy, World state, and World history | Conversation, Memory mediation |
| Realm access rules and cloud audit | AI implementation selection, budget, credentials, and App authorization |

## Interaction

Realm issues or projects the Character and World sources that Runtime is
authorized to consume. Runtime materializes a LocalAgent from a Character
Source and may use admitted World Source context during execution.

Cognition Memory does not become canonical Realm World state through Runtime mediation. Realm does not execute LocalAgent turns or choose Runtime implementations.
Any cross-domain mutation uses the owning domain's public contract.

SDK presents the bounded consumer surface. Nimi Home, Desktop, Avatar, and Apps
remain consumers; none can merge the two owners into a host-local truth.

Cognition owns Agent-private long-term Memory; Runtime mediates authorized delivery, recall, and management. Knowledge V1 has no active read, write, or public client path.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
