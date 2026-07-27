# Platform Governance

Nimi keeps durable identity, world truth, AI execution, presentation,
and App composition under separate owners. A product surface may
combine them, but it cannot silently take ownership of them.

## Owner Map

| Concern | Product owner |
| --- | --- |
| World identity, history, and durable Character identity | Realm |
| LocalAgent execution, Conversation, Memory, and Knowledge | Runtime |
| App-facing typed access | SDK |
| Current first-party home and product UI | Nimi Home / Desktop |
| Embodiment presentation | Avatar |
| Reusable consumer UI | Kit |
| Developer qualification surfaces | Simulator |

Character and LocalAgent form the clearest example. Realm owns the
durable Character. Runtime materializes that Character as a LocalAgent
for execution. A Desktop store, Avatar instance, or App binding may
refer to either identity, but it does not become a third owner.

## App Boundary

An App receives Runtime capability from its active session and app
identity. It does not receive Realm credentials or maintain its own
Runtime proof. Realm access uses the admitted SDK or host surface;
Conversation, Memory, and Knowledge remain Runtime services.

Nimi Home is the current first-party host. It composes these owners into
a product experience and can be replaced without moving their truth
into the host.

## Deferred Capabilities

General Workflow, MCP, World Evolution, Marketplace, public Registry,
Trust Tier, and commercial settlement are not prerequisites for the
current Local AI and Windows product loop. Existing future designs stay
isolated until their owner and activation boundary are decided.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
