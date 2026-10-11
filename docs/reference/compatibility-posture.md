# Compatibility Posture and Versioning Strategy

To maintain long-term stability and predictability across distributed systems, Nimi adheres to a clear compatibility matrix and semantic versioning release policies.

## Development Dependencies and Coordinated Matching

During application development, use verified package combinations (App Tools, SDK, Kit, and matching local Runtime builds):
- **Toolchain Cohesion**: Clean TypeScript compilation verifies frontend static contracts; runtime stability additionally depends on aligned native bindings and Runtime service versions.
- **Local Package Overrides**: In development or pre-release testing, map workspace dependencies to local archives via `pnpm-workspace.yaml` overrides to test against a unified release baseline.

## Immutability of Published Releases

- **Semantic Versioning (SemVer)**: Once packages are published to official registries or tagged in git releases, packages are strictly immutable.
- **Breaking Change Guidance**: In 0.x releases (the current lifecycle for SDK and Kit), breaking architectural evolutions increment the minor version number (e.g. 0.18 -> 0.19) accompanied by explicit migration notes, reserving 1.0.0 for formal platform readiness decisions. For 1.0+ releases, breaking changes increment the major version number following SemVer.
- **Independent Component Lifecycles**: SDK, Kit, App Tools, and desktop shells release on decoupled cadences while adhering to explicit dependency bounds.

## Fail-Closed Validation and Troubleshooting

- **Explicit Parameter Validation**: Malformed arguments, ungranted scopes, or unsupported options fail closed with structured, descriptive diagnostics.
- **Resilience Best Practices**: Transient transport errors can be retried automatically when operations are idempotent; operations with unconfirmed external side effects must verify existing job or call status rather than executing blind retry loops. Contract schema validation errors fail closed and must be resolved in code.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
