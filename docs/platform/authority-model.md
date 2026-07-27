# Authority Model

Nimi separates durable identity, runtime execution, product hosting,
and presentation so that no projection silently becomes its source of
truth.

For the field-level owner map, see
[Reference → Authority Domains](/reference/authority-domains).

## Core Owners

| Concern | Owner | Boundary |
| --- | --- | --- |
| Account-level AI identity | Realm `Character` | Realm owns durable identity and world relations |
| AI execution materialization | Runtime `LocalAgent` | Runtime materializes a Character for local execution |
| Conversation, Memory, Knowledge | Runtime | Apps consume these services; they do not take over their truth |
| World truth and history | Realm | Runtime and Apps use admitted Realm surfaces |
| App authorization | Runtime session | App access is derived from the active session and app identity |
| Product composition | Nimi Home and other hosts | The current host composes owners but is replaceable |
| Embodiment and rendering | Avatar | Avatar projects presentation; it does not become Character or LocalAgent authority |

`Character` and `LocalAgent` are related but not interchangeable.
A Character is the durable Realm identity. A LocalAgent is the
Runtime-owned executable materialization of that identity. An App may
hold a reference to either through an admitted API, but a projection
or binding object does not become a third identity owner.

## App Access

An App receives Runtime capability through the active session and its
own app identity. A scaffolded App does not receive a Realm JWT and
does not maintain independent Runtime proof. Realm access is mediated
through admitted SDK or host surfaces, while Runtime remains the owner
of execution, Conversation, Memory, and Knowledge.

Direct SDK use and a scaffolded App are integration paths, not
user-selectable product profiles. Kit provides reusable product
surfaces only when a real consumer needs them; it is not a speculative
catalog of platform completeness.

## Hosts And Projections

Nimi Home is the current first-party product host. It may compose
Runtime, Realm, SDK, Kit, and Avatar surfaces, but it does not replace
their authority. The same rule applies to Desktop shell state,
Avatar projections, simulator reports, and generated configuration:
they are consumers or projections of owner truth.

Existing public-distribution and App-world binding designs remain
isolated unless they directly conflict with this owner model. They are
not prerequisites for the current Windows product loop.

## Optional External Action

External delegated action is an optional capability boundary. If it is
enabled, authorization must remain scoped and fail closed, but
Workflow, MCP, World Evolution, public Registry, or Marketplace
delivery are not current Runtime prerequisites.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
