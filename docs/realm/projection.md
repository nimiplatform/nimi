# Realm Consumer Projection

When a Nimi app reads Realm data, what it receives through the SDK is a typed
local view of that data. That view is not a second source of Realm truth, and
it is not a local copy of Realm's domain model.

Apps, Runtime, Desktop, and Web all read Realm through the SDK's typed
clients. Local state may cache or display what Realm returned, but it can
never become the truth itself.

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
