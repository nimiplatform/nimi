# Six Primitives

Reference table for the six fixed protocol primitives. Authoritative
contract: `.nimi/spec/platform/core-protocol.authority.yaml` and rule family `P-PROTO-*`.

## The Six

| Primitive | Rule | Carries |
| --- | --- | --- |
| Timeflow | `P-PROTO-100` | Progression, timing, temporal meaning |
| Social | `P-PROTO-101` | Relationships, social graph semantics |
| Economy | `P-PROTO-102` | Value, exchange, economic state |
| Transit | `P-PROTO-103` | Movement between worlds or contexts |
| Context | `P-PROTO-104` | Shared situational meaning |
| Presence | `P-PROTO-105` | Who or what is present, and under what conditions |

Each primitive is a contract surface. Worlds may define their own
internal rules; meaning that crosses worlds must fit one of these six
contracts.

## Authority

| Layer | Role |
| --- | --- |
| Platform protocol | Defines the primitives' shape and version policy |
| Realm | Owns the source of truth and semantic execution for the six primitives |
| Apps | Consume and observe; do not execute |

The `P-PROTO-003` rule pins primitive semantic execution and truth
source to Realm.

## Cross-Consistency

A world transition that involves multiple primitives must satisfy all
relevant primitive contracts simultaneously:

| Constraint | Why |
| --- | --- |
| A transit must satisfy Social + Economy + Context simultaneously | Transit moves a participant across worlds; social standing, economic standing, and contextual meaning must all align |
| Presence cannot bypass social admission | Being "present" in a world requires social admission first |
| Timeflow cannot break economy settlement windows | Time progression must respect economic settlement boundaries |

The six primitives are not independent enums. They are mutually
constraining.

## Versioning Posture

| Property | Value |
| --- | --- |
| Strategy | `strict-only` |
| Cross-minor handshakes | Forbidden |
| Backward compatibility shims | Forbidden |
| Failure mode | Fail-close on contract violation |

Clients must match. There is no graceful degradation pretending
compatibility while violating contracts.

## Authorization Presets

Apps interact with primitives under scoped authorization. The platform
admits three preset templates that all share the same token shape and
validation chain:

| Preset | Read | Write | Delegate |
| --- | --- | --- | --- |
| `readOnly` | yes | no | no |
| `full` | yes | yes | no |
| `delegate` | yes | yes | one level |

`delegate` allows up to one level of further delegation by default.

## App Modes

| Mode | Primitive read | Primitive write | Active count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active per world |

## Audit Events

Cross-primitive actions emit audit events recorded under the platform
audit dictionary
(`config/platform-audit-events.yaml`).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`config/platform-protocol-primitives.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-primitives.yaml)
- [`config/platform-protocol-error-codes.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-protocol-error-codes.yaml)
- [`config/platform-audit-events.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/platform-audit-events.yaml)
- [`docs/spec/realm-readme.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-readme.md)
- [`docs/spec/realm-external-anchor.md`](https://github.com/nimiplatform/nimi/blob/main/docs/spec/realm-external-anchor.md)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
