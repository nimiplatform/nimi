# Local Models

Runtime can service admitted AI capabilities with machine-local engines and
assets. Local engines, installed model bundles, device compatibility, and
implementation selection all belong to Runtime. Apps express Local capability
intent; they do not select a model or engine.

For Cloud machine configuration, see
[Connectors and Providers](/runtime/connectors-and-providers).

## Runtime-Owned Selection

| Step | Owner action |
| --- | --- |
| Install engine and asset metadata | Runtime administration |
| Validate package integrity and device compatibility | Runtime |
| Determine eligible implementations | Runtime |
| Schedule device resources | Runtime |
| Select an implementation for a request | Runtime |

A bundle's catalog identity is an installation fact, not a request target.
Installing or inspecting a bundle does not create an App-visible binding and
does not guarantee that Runtime will use it for the next request.

## Engine and Asset Catalogs

Runtime catalogs describe admitted engine families, asset kinds, package
integrity, capabilities, and compatibility constraints. Desktop and CLI may
project these catalogs for machine administration.

| Catalog fact | Purpose |
| --- | --- |
| Engine family and runtime mode | Describe how Runtime can host the engine |
| Asset kind and capability metadata | Describe the asset's admitted use |
| Integrity identity | Verify exact installed content |
| Device requirements | Reject incompatible installation or execution |
| Runtime recommendation evidence | Help a user choose assets to install |

The client preserves Runtime recommendation order. It does not assign grades,
calculate scores, or rerank models from tags and metadata.

## Device Compatibility

Runtime detects CPU, accelerator, memory, and storage facts. It uses those facts
to validate installation and to schedule execution. A package that violates an
admitted device constraint fails closed with a typed reason.

Device diagnostics are machine-management evidence. Apps do not receive a
per-model readiness, warming, or health surface and cannot use device probes to
pick an execution implementation.

## Installation Flow

1. **Browse.** Desktop or CLI reads Runtime's admitted catalog.
2. **Select an asset to install.** The selection affects machine inventory only.
3. **Download and verify.** Runtime validates source, content identity, and
   package shape.
4. **Register.** Runtime records the installed asset and any required engine
   metadata.
5. **Report result.** The administration surface projects typed progress or
   failure.

Random URLs and unverified files are not executable. Import and download paths
must satisfy Runtime's catalog, path-admission, and integrity rules.

## Capability Execution

1. The exact App or Agent owner records Local intent for an admitted capability
   in `AIConfig`.
2. The caller submits identity, scenario content, and supported operation
   parameters.
3. Runtime evaluates installed assets, device state, policy, budget, and current
   resource pressure.
4. Runtime selects an admitted implementation or returns a typed failure.
5. Runtime-issued diagnostics can record what happened, but the caller cannot
   reuse them to pin the next request.

The normalized SDK result does not depend on whether Runtime chose a Local or
Cloud implementation.

## Reader Scenario: Install a Text-Generation Asset

1. A machine administrator opens the Local Model Center.
2. Runtime returns its catalog and recommendation evidence in Runtime order.
3. The administrator chooses a compatible asset bundle to install.
4. Runtime downloads, verifies, and registers the bundle, or fails closed with a
   typed reason.
5. A later App request contains no model, engine, route, connector, or target.
6. If Local intent and current machine state admit execution, Runtime may choose
   an installed implementation.

## Reader Scenario: Device Constraint

1. A selected bundle requires resources that the machine cannot provide.
2. Runtime rejects installation or execution with typed device evidence.
3. Desktop or CLI displays the Runtime reason without claiming model readiness.
4. The administrator can install a different compatible asset or change machine
   configuration.
5. The App request contract remains unchanged.

## Reader Scenario: Multiple Engines

Runtime can manage several engine families on one machine. It arbitrates shared
accelerator and memory resources internally. Text, image, audio, and other App
requests remain capability-shaped; Apps neither route requests to an engine nor
coordinate engine concurrency.

## Dependency Materialization

Some engines require additional machine dependencies. Runtime performs download,
verification, installation, cancellation, and cleanup through an admitted
materializer. Desktop can display typed operation progress and failure, but does
not run arbitrary shell commands or project dependency progress as App execution
readiness.

## Public Boundary

- Local model and engine catalogs are Runtime machine configuration.
- Asset installation is not model activation, warming, or request binding.
- Apps carry Local capability intent, not model, engine, route, connector,
  target, readiness, health, or fallback controls.
- Runtime owns compatibility, scheduling, and implementation selection.
- Recommendation and execution diagnostics remain Runtime-issued evidence.

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`config/runtime-local-engine-catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-local-engine-catalog.yaml)
- [`config/runtime-local-adapter-routing.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-local-adapter-routing.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
