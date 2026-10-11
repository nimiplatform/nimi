# System Architecture Overview

Nimi is organized around sibling architectural domains connected via typed projections.

```text
Realm Character Identity & Canonical World State
            │
            │ Character Source / World Source
            ▼
Runtime LocalAgent Instantiation & AI Execution
            │
            │ SDK Typed Capability Projection
            ▼
Nimi Home / Desktop Shell / Avatar Embodiment / Third-Party Apps
```

Realm and Runtime operate as decoupled siblings: Runtime never mutates into an internal subsystem of Realm, and Realm never executes local inference workloads. The SDK serves as a consumer interface contract rather than a third administrative authority.

Nimi Home hosts the active desktop application environment, composing public SDK operations and demand-driven Kit UI components. Scaffolded applications receive session-derived permissions rather than raw system credentials or internal Runtime tokens.

Avatar consumes structured presentation streams to render visual embodiment, maintaining local rendering state without usurping Runtime execution state or Realm identity assets.

## Architectural Invariants

- **Identity & World State Stay with Realm**: Character identity definitions and canonical world histories remain authoritatively stored in Realm.
- **Execution & Sessions Stay with Runtime**: LocalAgent lifecycle management, active conversations, AI model scheduling, and application authorization are owned by Runtime.
- **Memory Storage is Isolated in Cognition**: Agent-private long-term memory is managed by Cognition and accessed via Runtime mediation; Knowledge V1 is currently inactive.
- **Apps Own Interaction & Local State**: Applications consume public SDK operations, managing only their local presentation and product data.
- **Desktop Shell is a Decoupled Host**: The desktop client is a primary first-party host rather than an irreplaceable platform authority.
- **Security Governed by Declarative Outcomes**: Platform security is defined through invariant requirements; underlying OS isolation mechanisms remain internal implementation details unless exposed by formal contract.
- **Non-Blocking Architecture**: Forward-looking roadmap items never block the active local product lifecycle.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
