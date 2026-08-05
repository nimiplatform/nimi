# Architecture

Nimi uses sibling owner domains connected by typed projections.

```text
Realm Character and World truth
            |
            | Character Source / World Source
            v
Runtime LocalAgent and AI execution
            |
            | SDK typed capability projection
            v
Nimi Home / Desktop / Avatar / Third-party Apps
```

Realm and Runtime are independent. Runtime does not become a Realm subsystem,
and Realm does not become the local AI executor. SDK is a consumer boundary,
not a third authority over either domain.

Nimi Home hosts the current local App flow and composes public SDK and
demand-driven Kit surfaces. A scaffolded App receives session-derived access,
not protected credentials or Runtime proof.

Avatar consumes typed Runtime presentation input and keeps renderer-local
state. Simulator qualifies selected App modules for development; neither
surface becomes a platform owner.

## Architecture rules

- Character identity and World truth stay with Realm.
- LocalAgent, Conversation, Memory, Knowledge, AI implementation selection, and
  App authorization stay with Runtime.
- Apps use public SDK operations and own only their product behavior and data.
- Desktop is a current host, not an irreplaceable cross-platform authority.
- Platform security is expressed as required outcomes; OS mechanisms remain
  owner implementation details unless a public contract requires them.
- Deferred capabilities do not block the current product loop.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
