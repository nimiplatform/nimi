<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.platform.governance-release.p-gov-026-supported-completeness"],"sources":["VISION.md","app-tools/package.json","kit/package.json"]} -->

# Current Capabilities and Direction

Starting from a primary PC Runtime and multi-device consumption paths, Nimi is building toward a user-controlled AI environment for everyday use. See [downloads](https://nimi.ai/download) for product artifacts and [Environment Setup](/start/install) for source versus published packages.

| Direction | Current boundary | Conditions for further delivery |
| --- | --- | --- |
| Native PC Apps | Verified local sessions; package lifecycle on macOS arm64 and Windows x86_64 | Matching artifacts, signatures and real installation/call verification |
| Web consumption | Current source provides HTTPS sources, official login and direct primary access | Admitted production source, trusted TLS, coordination service and target-network verification |
| Android | Kit Capacitor and Zhiyu development entry; Scheme and App Link are distinct | Device, signature, callback and distribution paths verified separately |
| More mobile terminals | No generic native factory for other platforms today | Platform adapter, callback identity, foreground/background lifetime and real consumption |
| Embedded and smart-home devices | Long-term direction, not a current general device-control promise | Select a real task and define device role, resource limits, action permission, outcome feedback and connection-loss behavior |
| Additional Runtime hosts and federation | Current direct access targets one primary Runtime without automatic cross-host sync | Separate execution ownership, consistency, network and failure contracts |

Expanding across devices does not require every terminal to host a Runtime or grant management permissions to client Apps. Saved configuration, connected transport, successful execution, and a public release remain distinct states—none automatically implies the others.

Cognition continues to isolate long-term Memory per Agent. Knowledge V1, general Workflow, autonomous world evolution, and marketplace settlement remain future directions and are not yet callable capabilities. Build against current public types and surface explicit outcomes for unsupported operations and unavailable networks.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/governance-release.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/governance-release.authority.yaml)
