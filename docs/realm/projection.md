# Realm Consumer Projection

Realm projection in this repository means the shape Nimi consumers receive
through the SDK Realm boundary. It is not a second source of Realm truth and it
is not a local Realm domain model.

Apps, Runtime, Desktop, and Web should consume Realm through SDK-owned typed
clients. Local state can cache or present Realm output, but it must not become
canonical Realm truth.

## Consumer Rules

| Concern | Boundary |
| --- | --- |
| Generated API input | Comes from the configured external Realm OpenAPI source |
| SDK facade | May wrap generated operations with typed fail-closed behavior |
| Runtime/Desktop projection | May present Realm output, but cannot synthesize Realm success |
| App wrappers | May adapt SDK output for product UI, but cannot redefine Realm semantics |

When Realm API drift appears, regenerate the SDK core from the configured Realm
input and update consumer contracts/tests. Do not patch drift by copying Realm
spec text into this repository or by freezing handwritten DTOs.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
