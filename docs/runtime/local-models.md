# Local Models and Loadout Architecture

In Nimi's local compute architecture, model weight files represent static assets on disk. Turning weights into an active capability requires assembling them with an inference engine driver, execution recipes, and runtime parameters into a complete **Loadout**. Runtime maintains a global default Loadout for each capability, serving all applications that declare Local capability intents.

## Recommended Local Setup Workflow

1. **Review Capabilities**: Browse supported capabilities and operational parameters in Nimi Home under "AI Capabilities".
2. **Acquire Model Weights**: Import local GGUF models via the Model Library or download curated weights through the Download Manager. Files are verified with SHA-256 checksums.
3. **Assemble a Loadout**: Pair the model with optimized runtime parameters (e.g., context window size, GPU offload layers) tailored to specific workloads, saving it as a named Loadout.
4. **Set Global Default**: Designate this Loadout as the machine default for that capability. This setting automatically applies to all apps routed to local execution.
5. **Verify Inference**: Configure an app's AIConfig with Local intent and run an actual query to verify end-to-end performance.

## Status Indicators and Diagnostics

To streamline monitoring and troubleshooting, status indicators represent distinct lifecycle phases:

| Indicator | Represents | Possible Values |
| --- | --- | --- |
| **File Verification** | Whether disk bytes match registered cryptographic hashes | `verified` / `corrupted` / `unchecked` |
| **Resource Binding** | Whether all weights, adapters, and tokenizer assets are linked | `complete` / `missing_assets` |
| **Environment Readiness** | Whether local drivers, CUDA/Metal runtimes, and libraries meet criteria | `ready` / `missing_dependency` |
| **Default Selection** | Whether this Loadout is designated as the active machine default | `active_default` / `inactive` |

Runtime provides actionable diagnostic feedback for each stage, giving developers and power users transparent visibility into the local inference stack.

## Execution Stability Guarantees

When an application submits an inference task:
- **Atomic Context Freezing**: Runtime records an atomic snapshot containing the active Loadout parameters, driver options, and exact model hashes.
- **Consistent Execution Context**: Tasks in the processing queue execute against their frozen context, ensuring that parameter changes made after submission do not alter the running job.
- **Lifecycle Management**: If the inference host process is dormant during cold start, Runtime boots the process on demand and manages process lifespan based on local memory policies.

## Source Basis

- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
