# Local AI in Nimi Home

In Nimi Home's "AI Capabilities" section, you can configure local model resources and execution profiles. It provides curated recommendations, community loadouts, local model imports, environment health checks, and machine-wide default configurations (Loadouts).

## Functional Areas

| Section | Core Tasks | Purpose |
| --- | --- | --- |
| **AI Capabilities Workspace** | Browse configured capabilities and set machine defaults | Set the preferred execution plan for text generation, embeddings, etc. |
| **Model Library** | View local model files, import, verify integrity, manage disk space | Manage local weights, GGUF files, and storage quotas |
| **Environment & Drivers** | Check inference engine and hardware acceleration prerequisites | Validate GPU drivers, CUDA, Metal, or Vulkan support |
| **Download Manager** | Track background downloads for models, apps, and dependencies | Monitor download progress, speed, and network throughput |
| **Cloud Services** | Configure cloud provider API keys and compatible endpoints | Provide cloud execution targets when apps or users explicitly choose Cloud routing |

## Getting Started: Setting Up a Local Model

A typical workflow from importing a model to running your first request:

1. **Import or Download**: Import existing model weights (such as GGUF files) in the Model Library, or download tested models directly. The system verifies integrity hashes upon completion.
2. **Create or Select a Loadout**: Bundle the model with optimized inference parameters into a named Loadout tailored to your tasks (e.g., chat, coding, reasoning).
3. **Set as Capability Default**: In the AI Capabilities panel, mark this Loadout as the machine default for that capability.
4. **Run a Query**: In any Nimi App or Desktop Chat, select "Local" mode to start private, low-latency, offline inference.

## Understanding Status Indicators

- **File Integrity**: Verifies that downloaded bytes match registered checksums to prevent corrupted weights.
- **Environment Readiness**: Confirms that your hardware, drivers, and runtime dependencies meet the model's operational requirements.
- **Default Tag**: Marks the active machine default for that capability. Changing a default loadout updates subsequent Local requests across apps that route to local compute.

For technical deep dives into local inference mechanics and loadouts, see [Local Models and Loadouts](/runtime/local-models).

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
