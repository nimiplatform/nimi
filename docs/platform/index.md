# Platform

Nimi is an installable, open-source, local-first personal AI product. Inside
Nimi you meet characters, hold conversations, make creations, follow stories,
and visit worlds — experiences that start on your own machine and stay yours.

Nimi Home is the entry point, hosted by Desktop today. It fronts the
experience without replacing anything behind it. A few parts work together:

- Realm keeps ecosystem identity: your characters, friendships, and worlds,
  plus the shared facts inside them.
- Runtime is the AI engine. It brings characters to life locally as
  LocalAgents and runs local and cloud models from multiple providers.
- SDK is the single typed interface Apps use to talk to Runtime and Realm.
- Avatar renders a character on screen — how it looks, moves, and reacts — but
  does not run the AI behind it.
- Kit holds shared UI pieces, used when a product surface needs them.

These parts stay separate on purpose. The part that knows who your character
is never has to be the part that runs the AI or draws it — which is how the
same character stays itself everywhere.

## Character and LocalAgent

You create or pick a character in Realm. Realm issues a Character Source — the
description Runtime uses to bring that character to life as a LocalAgent
scoped to you. The LocalAgent can draw on world context Realm has shared, but
it never takes over the character's identity or the world's facts; those stay
with Realm.

Apps use LocalAgent capabilities through the SDK. Runtime works out identity
and authorization from the active session, so Apps never receive Realm
credentials, Runtime-internal proofs, provider keys, or an account-wide list
of LocalAgents.

See [Character And LocalAgent](/platform/agents/) and
[Realm And Runtime As Siblings](/platform/architecture/realm-runtime-siblings).

## Six protocol primitives

Six protocol primitives describe the operations products can exchange across
these boundaries, without any part taking over another part's facts:

- State
- Event
- Intent
- Action
- Audit
- Permission

See [Protocol](/platform/protocol) and
[Execution Protocol](/platform/execution-protocol).

## Current boundary

The product loop today is Realm, Runtime, SDK, Nimi Home, and Apps. General
Workflow, MCP, World Evolution, marketplace, registry, trust tiers, public
distribution, and commercial settlement are not prerequisites for that loop.
Designs for future distribution stay separate unless they would conflict with
these boundaries.

Simulator is a development and qualification tool for selected App modules. It
is not a current product platform, and it does not replace a product host.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
