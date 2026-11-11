<!-- nimi-docs: {"authority":["rule.nimi.runtime.local-compute.r067","rule.nimi.runtime.ai-provider.r064","rule.nimi.runtime.ai-provider.media-upscale-contract"],"sources":["config/runtime-managed-image-backend-packages.yaml","apps/desktop/src/shell/renderer/features/runtime-config/runtime-capability-inventory.ts"]} -->

# Local AI in Nimi Home

The **AI Capabilities** section in Nimi Home is your control center for local models and execution profiles (Loadouts). From here, you can browse curated recommendations and community configurations, import local model weights, check hardware readiness, and set machine-wide defaults.

## Functional Areas

| Section | Core Tasks | Purpose |
| --- | --- | --- |
| **AI Capabilities Workspace** | Browse configured capabilities and set machine defaults | Set the preferred execution plan for text generation, embeddings, and more |
| **Model Library** | View local model files, import weights, verify integrity, and manage disk space | Manage local weights, GGUF files, and storage quotas |
| **Environment & Drivers** | Check inference engine and hardware acceleration prerequisites | Validate GPU drivers and CUDA, Metal, or Vulkan support |
| **Download Manager** | Track background downloads for models, apps, and dependencies | Monitor download progress, speed, and network throughput |
| **Cloud Services** | Configure cloud provider API keys and compatible endpoints | Provide cloud execution targets when apps or users explicitly choose Cloud routing |

## Getting Started: Setting Up a Local Model

Here is the typical workflow from importing a model to running your first local request:

1. **Import or Download**: In the **Model Library**, import existing model weights (such as GGUF files) or download tested models directly. Nimi automatically verifies integrity hashes once the transfer finishes.
2. **Create or Select a Loadout**: Bundle the model with optimized inference parameters into a named Loadout tailored to your task (such as chat, coding, or reasoning).
3. **Set as Capability Default**: In the **AI Capabilities** panel, set this Loadout as the machine default for that capability.
4. **Run a Query**: In any Nimi App or Desktop Chat that supports the capability, select **Local** mode to run requests through your configured local model. Selecting Local only routes that capability to local compute—the App's online features, external connections, and other cloud capabilities keep their own independent data flows, and the App itself does not become an offline client.

## Prepare Image and Video Models

For H3 Image, HyperFlow, ControlNet or upscaling, start from the corresponding capability in **AI Capabilities**. Select a model configuration, download its missing components and bind compatible existing files. Keep image and video super-resolution defaults separate. RelayVSR needs the transformer and VAE matching its 2×/4× multiplier; Sol-H3-VAE belongs in the H3 video VAE slot.

These new recipes currently use the Runtime-managed sd.cpp 1088 Windows amd64 NVIDIA package. macOS retains 1050; the Windows acceptance does not establish support on that host. SeedVR2 remains experimental. See [model requirements](/runtime/local-models#local-image-and-video-models) before downloading and the [Lab walkthrough](/start/use-nimi-lab#try-local-image-and-video-models) to confirm an actual output after preparation. Ordinary Apps consume the configured capability; they do not install the engine themselves.

## Understanding Status Indicators

- **File Integrity**: Confirms that downloaded bytes match registered checksums so you don't run corrupted weights.
- **Environment Readiness**: Verifies that your hardware, drivers, and runtime dependencies meet the model's requirements.
- **Default Tag**: Marks the active machine default for a capability. Updating the default Loadout applies to all subsequent Local requests across apps that route to local compute; individual apps cannot override machine-wide Loadouts.

For a technical deep dive into local inference mechanics and loadouts, see [Local Models and Loadouts](/runtime/local-models).

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/desktop/shell-ui.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/shell-ui.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
