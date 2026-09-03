# Local AI

The Local Model Center is where you manage local AI on this machine.
You can browse, install, import, remove, and inspect Runtime's local
assets — but installing something here never picks which
implementation answers an App's request.

## Surface Boundary

| Concept | Meaning |
| --- | --- |
| Local asset catalog | Runtime-issued inventory of installable assets |
| Installed assets | Resources registered on this machine |
| Installation progress | Runtime-issued download, verification, and materialization state |
| Recommendation feed | Runtime-ordered installation suggestions and evidence |
| Capability intent | An owner's Local or Cloud preference in `AIConfig` |

The asset catalog is machine setup, nothing more. Picking a bundle in
the Local Model Center means "install this" or "remove this" — it
doesn't pin a model, engine, or route for later App calls.

## Runtime Truth Projection

Everything on this page comes from Runtime; Desktop doesn't
reconstruct or second-guess it locally.

| Concern | Owner |
| --- | --- |
| Catalog and installed-asset inventory | Runtime |
| Download, verification, and materialization status | Runtime |
| Recommendation order and evidence | Runtime |
| Device and dependency diagnostics | Runtime |
| Implementation selection for each request | Runtime |

Recommendations appear in the order Runtime gives them, with Runtime's
own reasons and compatibility evidence attached. Desktop doesn't
score, grade, group, or reshuffle the list on the client.

## Dependency Setup

Engines that need system dependencies install through a Runtime
materializer. You confirm, and Runtime runs the whole operation —
download, verification, installation, and cleanup. Desktop shows typed
progress and failures along the way; it never executes arbitrary
PowerShell or shell commands itself.

A finished dependency install is machine-setup evidence. It isn't a
signal that a particular model is ready, and Apps can't use it to pick
an implementation.

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

Your Realm connection and your local Runtime are separate things. A
Realm outage doesn't by itself disable local AI. Local execution still
needs the Runtime to be reachable, your Local preference to allow it,
and Runtime to find a valid implementation. When a prerequisite is
missing you get a typed failure — never a fabricated success.

## Key Points

- The Local Model Center manages machine assets owned by Runtime.
- `AIConfig` records your Local or Cloud preference per capability.
- Apps get no model activation, warming, engine binding, route
  readiness, or per-model health controls.
- Runtime alone picks the implementation for each request.
- Runtime diagnostics and recommendation evidence never become request
  input.

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-runtime.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-runtime.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
