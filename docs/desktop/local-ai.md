# Local AI

Desktop's Local Model Center is a machine-administration surface for Runtime
owned local AI assets. It can browse, install, import, remove, and inspect those
assets, but it does not choose the implementation for an App request.

## Surface Boundary

| Concept | Meaning |
| --- | --- |
| Local asset catalog | Runtime-issued inventory of installable assets |
| Installed assets | Resources registered on this machine |
| Installation progress | Runtime-issued download, verification, and materialization state |
| Recommendation feed | Runtime-ordered installation suggestions and evidence |
| Capability intent | An owner's Local or Cloud preference in `AIConfig` |

The asset catalog is machine configuration. Selecting a bundle in the Local
Model Center means selecting something to install or remove, not pinning a
model, engine, or route for later App calls.

## Runtime Truth Projection

Desktop projects Runtime truth and does not reconstruct it locally.

| Concern | Owner |
| --- | --- |
| Catalog and installed-asset inventory | Runtime |
| Download, verification, and materialization status | Runtime |
| Recommendation order and evidence | Runtime |
| Device and dependency diagnostics | Runtime |
| Implementation selection for each request | Runtime |

Desktop preserves Runtime recommendation order. It may present Runtime-issued
reasons or compatibility evidence, but it does not score, grade, group, or
rerank models on the client.

## Dependency Setup

Engines that require system dependencies use a Runtime materializer. Desktop
shows typed installation progress and failures; it does not execute arbitrary
PowerShell or shell commands. A user confirmation starts the admitted Runtime
operation, and Runtime owns download, verification, installation, and cleanup.

Dependency installation status is machine-administration evidence. It is not a
model-readiness signal that an App can use to select an implementation.

## Reader Scenario: Install a Local Asset

1. **Open Local Model Center.** Desktop reads the Runtime catalog and installed
   inventory.
2. **Browse.** The user reviews Runtime-issued metadata and recommendation
   evidence.
3. **Install.** The user selects an asset bundle for installation. Runtime
   downloads, verifies, and registers it.
4. **Inspect result.** Desktop projects the typed installation result or failure.
5. **Use a capability.** An App with Local capability intent submits its ordinary
   request without a model, route, connector, or target. Runtime decides whether
   an admitted installed asset can service it.

Installation does not create an App-visible binding and does not guarantee that
a particular implementation will handle the next request.

## Reader Scenario: Local Memory Capability

An owner may express Local intent for an admitted memory or embedding
capability. The configuration contains the owner identity, capability, and
Local intent only. Runtime chooses the embedding implementation and owns any
bank migration or cutover required by machine configuration. Desktop does not
expose an embedding-model picker or a client-computed readiness state.

## Realm Connectivity

Realm connectivity and local Runtime reachability are separate concerns. A
Realm outage does not by itself disable local AI. Local execution still requires
the Runtime to be reachable, the owner intent to admit Local use, and Runtime to
find a valid implementation. Missing prerequisites produce a typed failure; the
client does not fabricate fallback success.

## Public Boundary

- Local Model Center manages Runtime-owned machine assets.
- `AIConfig` expresses owner-scoped Local or Cloud capability intent.
- Apps do not receive model activation, warming, engine binding, route
  readiness, or per-model health controls.
- Runtime alone selects the implementation for each request.
- Runtime diagnostics and recommendation evidence never become request input.

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
