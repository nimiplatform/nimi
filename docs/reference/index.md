# Reference Manual

The Reference Manual serves as the central directory of technical specifications, field schemas, state machines, and system invariants across the Nimi platform. Use these pages to quickly verify interface definitions, parameter names, and architectural boundaries.

## Reference Catalog

| Reference Document | Key Topics & Coverage |
| --- | --- |
| [Glossary](/reference/glossary) | Core platform terminology and cross-system concept definitions |
| [World Fields](/reference/world-fields) | World entity data schemas, state definitions, and metadata |
| [Agent Fields](/reference/agent-fields) | Identity schema and mapping from Character assets to LocalAgent execution |
| [Six Primitives](/reference/six-primitives) | Cross-world foundation protocol specifications and schemas |
| [State Machines](/reference/state-machines) | Core state machines including daemon health, sessions, and task lifecycles |
| [Authority Domains](/reference/authority-domains) | Single Source of Truth assignments across Realm, Runtime, SDK, and App layers |
| [Error Ownership](/reference/error-ownership) | Standard error prefixes, propagation chains, and handling layers |
| [Compatibility Posture](/reference/compatibility-posture) | Semantic versioning, cross-layer dependency contracts, and upgrade strategies |
| [Architectural Invariants](/reference/forbidden-claims) | Core design constraints, anti-patterns, and verified best practices |

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
