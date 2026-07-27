# Platform

Nimi connects persistent open-world identity with local AI execution while
keeping their owners independent.

- Realm owns Character, social, World, economy, and canonical World truth.
- Runtime owns LocalAgent materialization, AI execution, Conversation,
  operational Memory and Knowledge, voice, readiness, and App authorization.
- SDK is the public typed access boundary for Apps.
- Kit provides shared UI and host composition only when a concrete product
  consumer needs it.
- Nimi Home is the current product home and Desktop host surface; it does not
  replace Realm or Runtime authority.
- Avatar owns embodiment rendering and shell-local interaction, not LocalAgent
  or AI execution truth.

## Character and LocalAgent

A user creates or selects a Realm Character. Realm issues the Character Source
that Runtime uses to materialize an owner-scoped LocalAgent. The LocalAgent may
consume admitted World Source context without becoming the owner of Realm
identity or World truth.

Apps interact with LocalAgent capabilities through the SDK. Runtime derives
identity and authorization from the active session; Apps do not receive Realm
JWTs, Runtime proof, provider credentials, or account-wide LocalAgent inventory.

See [Character And LocalAgent](/platform/agents/) and
[Realm And Runtime As Siblings](/platform/architecture/realm-runtime-siblings).

## Six protocol primitives

The six protocol primitives describe interoperable product operations without
transferring owner truth:

- State
- Event
- Intent
- Action
- Audit
- Permission

See [Protocol](/platform/protocol) and
[Execution Protocol](/platform/execution-protocol).

## Current boundary

General Workflow, MCP, World Evolution, marketplace, registry, trust-tier,
public distribution, and commercial settlement are not prerequisites for the
current Realm–Runtime–SDK–Home–App loop. Existing future distribution design
remains isolated unless it conflicts with a current owner boundary.

Simulator is a development and qualification tool for selected App modules. It
is not a current product platform or a replacement product host.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
