# Vision

Nimi is an open-world platform where persistent Characters and locally
executed AI can participate without collapsing identity, execution, and
presentation into one owner.

## Persistent identity, local execution

Realm owns the Character that participates across Worlds. Runtime materializes
an owner-scoped LocalAgent from a Realm-issued Character Source. This lets the
same Character source support local AI experiences while each LocalAgent keeps
independent operational state.

## User-controlled access

Apps express typed intent through the SDK. Runtime derives account, App
identity, authorization, and LocalAgent access from the active session. Apps do
not carry Realm JWTs, provider credentials, or Runtime proof.

## Interoperable projections

Conversation, Memory, Knowledge, voice, and presentation remain with Runtime
and cross into products only as authorized typed projections. Avatar and other
surfaces can create rich rendering without taking over LocalAgent truth.

## Incremental platform growth

The current product loop does not depend on general Workflow, MCP, World
Evolution, marketplace, public distribution, or commercial settlement.
Future capabilities can be added behind their own owners without redefining the
core Character–LocalAgent model.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
