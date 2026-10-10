# Product Direction and Availability

Nimi brings local and cloud AI capabilities, Apps, and AI characters into one personal product. Use the [download status](https://nimi.ai/download) for product availability and [development setup](/start/install) for the current source toolchain.

## Build Against Current Interfaces

The current development interfaces separate App AIConfig, machine Loadouts, protected App sessions, and Runtime execution. Agent conversations use Runtime-owned continuity and optional Cognition Memory; Knowledge V1 has no active public path.

App development, local-package import, verified Catalog distribution, and public product release are different stages. See [App development and distribution](/start/#local-development-and-distribution) for their prerequisites and current platform limits. An implementation or a successful local build alone does not establish public release readiness.

## Future Capabilities

General Workflow, World Evolution, compute federation, marketplace settlement, and unadmitted protocol adapters do not become usable APIs merely because they appear in architectural direction. Their absence must not block unrelated admitted capabilities. No delivery date or automatic activation follows from a roadmap mention.

For a needed capability, begin with the [SDK](/sdk/) and its current typed surface. If the required operation or exact implementation combination is unavailable, preserve the typed failure and follow the relevant component's changes before depending on it.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
