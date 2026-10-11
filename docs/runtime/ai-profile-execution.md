# Profile, Loadout, and Execution Scheduling

AIProfile is a portable configuration package designed for sharing and templating. Applying an AIProfile generates editable prefilled values in the configuration interface—it does not silently overwrite existing AIConfigs, switch machine Loadouts, or initiate background inference.

## Three Distinct Configuration Objects

| Object | Scope & Responsibility | Security & Storage |
| --- | --- | --- |
| **AIProfile** | Portable capability configuration template for cross-device sharing | Contains suggested parameters and model tags; contains no secrets or machine identities |
| **AIConfig** | Authoritative capability configuration for an App or shared across an account's LocalAgents | Stores revision, route (Local vs. Cloud), and parameters; each app has one config, while all LocalAgents for an account share a single config |
| **Loadout** | Concrete execution recipe for a capability on this local machine | Directly binds inference drivers, execution recipes, and verified local model weights |

A machine can maintain multiple Loadouts for a given capability, but only one is selected as the active machine default at any time. When an app configures Local routing, Runtime routes its requests to this default Loadout. For Cloud routing, AIConfig explicitly points to a configured connector reference and provider target.

## Preparation and Atomic Commit

Changing local machine configurations follows standard preparation and verification workflows (Prepare / Commit):
- Importing or downloading a model only adds the weights to the local resource inventory.
- Binding weights to an execution recipe and setting it as the default Loadout is an explicit configuration step.
- The active default Loadout applies to all subsequent Local inference requests across apps.

## Input Snapshot Invariance

To ensure execution consistency throughout a task's lifecycle:
1. **Immutable Execution Context**: When an inference Job is submitted, Runtime freezes a snapshot of the active AIConfig and resolved Loadout parameters. The job continuously executes using this snapshot.
2. **Isolation from Configuration Drift**: Queued or executing jobs continue using the exact parameters captured at submission; they are not perturbed by subsequent setting changes or silent fallbacks.
3. **Explicit Failure Semantics**: If required model files or hardware acceleration drivers become unavailable, Runtime returns structured error codes and actionable diagnostics.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
