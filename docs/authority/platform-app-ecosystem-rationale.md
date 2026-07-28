# Platform App Ecosystem

Realm and Runtime have separate ownership. Realm owns
`PersonaCharacter`, `WorldCharacter`, Character Source, and World Source.
Runtime materializes an independent `LocalAgent` only from a Realm source and
owns that LocalAgent's identity, execution, conversation continuity,
operational Memory, Knowledge, and lifecycle.

The Runtime Agent Service name does not introduce a separate `Agent` product
entity. Nimi Home, Zhiyu, Avatar, and authorized third-party local apps consume
isolated LocalAgent projections; their renderer state, transcript views, and
caches are not Runtime truth.

LocalAgent access is derived again for each operation from the current account,
current app session, `localAgentId`, requested operation, and current lifecycle.
Callers cannot submit reusable account, app, grant, relationship, or binding
proof. Account changes, app-session termination, and Runtime lifecycle changes
invalidate affected access.

## App Lifecycle Posture

The current third-party product path is explicit local development. Public
distribution, ordinary install/update/repair, Registry and Marketplace
onboarding, and ecosystem economy are deferred. Future catalog, trust,
descriptor, or signing metadata cannot by itself activate an app or grant
Runtime authority.

Windows is the current platform priority. macOS follows as an independent
native security outcome and is not a Windows-readiness prerequisite. Linux
product support remains deferred.

## Scaffold And SDK Custody

A scaffolded app reaches Realm-owned data through Runtime-mediated public
surfaces and does not receive a Realm JWT or provider credential. A direct SDK
consumer remains a distinct integration posture and uses the standard Realm
authentication path.

## Source Basis

- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
