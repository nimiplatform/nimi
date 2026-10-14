# System Architecture Overview

Nimi is structured around peer architectural domains connected through typed projections.

```text
Realm Character Identity & World Definitions
            │
            │ Character Source / World Source
            ▼
Runtime LocalAgent Instantiation & AI Execution
            │
            │ SDK Typed Capability Projection
            ▼
Nimi Home (Desktop) / Avatar Embodiment / Third-Party Apps
```

Realm and Runtime operate as decoupled peers: Runtime is not an internal subsystem of Realm, and Realm never runs local inference workloads. The SDK is a typed consumer contract rather than a separate authority.

Nimi Home—currently hosted by Desktop—serves as the entry point for the local application environment, combining accepted SDK operations with on-demand Kit UI components. Applications work through protected host sessions and receive only session-derived capabilities, never raw system credentials or internal Runtime tokens.

Avatar consumes structured presentation streams from Runtime to drive visual embodiment, managing its own rendering state without taking over Runtime execution state or Realm identity assets.

## Architectural Invariants

- **Identity & World Definitions Stay with Realm**: Realm owns persistent character identities, world settings, and the planned shared World State/History contracts.
- **Execution & Sessions Stay with Runtime**: Runtime owns LocalAgent lifecycle management, active conversations, AI model scheduling, and session-scoped app authorization.
- **Memory Storage Is Isolated in Cognition**: Agent-private long-term memory is stored by Cognition and mediated by Runtime; `Knowledge V1` currently has no public interface.
- **Apps Own Interaction & Local State**: Applications call public SDK operations and manage only their own UI and product data.
- **Desktop Is a Decoupled Host**: Desktop currently hosts Nimi Home as a first-party shell, not an irreplaceable platform authority.
- **Security Is Defined by Invariant Outcomes**: Platform security is governed by declarative boundary rules; OS-specific isolation mechanisms remain internal implementation details unless exposed by contract.
- **Non-Blocking Evolution**: Forward-looking roadmap items never block the active local product loop.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
