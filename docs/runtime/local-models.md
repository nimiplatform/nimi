<!-- nimi-docs: {"authority":["rule.nimi.runtime.local-compute.r067","rule.nimi.runtime.ai-provider.r064","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["config/runtime-managed-image-backend-packages.yaml","runtime/catalog/source/providers/local"]} -->

# Local Models and Loadout Architecture

In Nimi's local compute architecture, model weight files represent static assets on disk. Turning weights into an active capability requires assembling them with an inference engine driver, execution recipes, and runtime parameters into a complete **Loadout**. Runtime maintains a global default Loadout for each capability, serving all applications that declare Local capability intents.

## Recommended Local Setup Workflow

1. **Review Capabilities**: Browse supported capabilities and operational parameters in Nimi Home under "AI Capabilities".
2. **Acquire Model Weights**: Use the selected model's setup flow to download missing weights or select existing verified files. Formats depend on the recipe and include GGUF and safetensors. Downloads verify the declared SHA-256 checksums.
3. **Assemble a Loadout**: Bind every required component and review its workload-specific settings. Image and video models can require separate transformers, encoders and VAEs; a chat model's context-window settings do not apply to every capability.
4. **Set Global Default**: Designate this Loadout as the machine default for that capability. This setting automatically applies to all apps routed to local execution.
5. **Verify Inference**: Configure an app's AIConfig with Local intent and run an actual query to verify end-to-end performance.

## Local Image and Video Models

Home prepares a platform-specific, Runtime-managed sd.cpp `master-1088-32d516c` archive for Windows amd64 NVIDIA or macOS 26.0+ on Apple Silicon. Use Home to import existing weights and bind each model slot before preparing the engine. The official Mac archive runs ordinary Metal operators. INT8 ConvRot executes on CPU because the archive omits the sd.cpp Metal extension. H3 Image timed out at 1024×1024 with that archive. The guarded source-development Runtime can explicitly prepare a separately pinned local archive built with `SD_METAL=ON` and `SD_USE_UPSTREAM_GGML=OFF`. See the [Lab developer instructions](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md).

| Model or component | Capability | Components and supported use |
| --- | --- | --- |
| MiniMax-H3-Image | `image.generate` | Independent PDD image transformer, combined MiniMax-H3 Qwen3-VL GGUF encoder and dedicated image VAE; text generation or one reference-image edit, one output, no mask or negative prompt |
| HyperFlow H3 Flash | `video.generate` | Combined FL2VA and Ref2VA safetensors transformers, combined H3 encoder, video VAE and audio VAE; the implemented distilled schedule uses six Euler steps and CFG 1 |
| Sol-H3-VAE | `video.generate` component | An independently selectable video VAE for the H3 video path, including HyperFlow; it is not a separate generation capability and does not replace the dedicated H3 Image VAE |
| RelayVSR 2x / 4x | `image.upscale`, `video.upscale` | Independent transformer and VAE for the requested multiplier; the 2x and 4x VAEs are not interchangeable |
| SeedVR2 3B / 7B Sharp | `image.upscale`, `video.upscale` | Selected transformer plus SeedVR2 VAE; 2× or 4× output; experimental support |
| SDXL ControlNet Union ProMax | `image.generate` | Complete SDXL Base checkpoint, including its encoders and VAE, plus an independent Union ProMax checkpoint; one prepared control map matching the output canvas |

H3 Image can reuse a compatible installed H3 encoder. HyperFlow can reuse compatible H3 encoder/audio-VAE assets and select either the original video VAE or Sol-H3-VAE. Choose each component in Home: matching filenames or a shared download source do not establish compatibility. Runtime checks model structure; RelayVSR additionally checks the VAE's declared upscale factor. A valid download hash establishes file integrity, not compatibility with every recipe.

The 2026-11-11 Windows RTX 5090 development runs used H3 Image INT8 ConvRot, HyperFlow's pinned BennyDaBall combined INT8 conversion, RelayVSR/SeedVR2 INT8 ConvRot, and SDXL/ProMax F16. H3 text generation and one-reference editing, HyperFlow FL2VA and Ref2VA with Sol, all four upscale variants, and ControlNet Canny/Tile produced real outputs in native Lab. HyperFlow four/eight-step presets, the other six ControlNet types, other quantizations and installed distributions remain **NOT-VERIFIED**. These observations cover the tested samples, not general reconstruction or audio quality.

On the Apple M4 Max development host, native Lab generated 1024×1024 ControlNet Canny and Tile PNGs. RelayVSR 2x and 4x produced the requested PNGs and preserved all 22 source frame timestamps and AAC packet contents in their MP4s. With the explicit Metal INT8 archive, Lab completed H3 Image text generation and one-reference editing at 1024×1024, and both six-step HyperFlow paths at 256×256 with five frames and stereo 32 kHz AAC. The tested HyperFlow combinations used FL2VA with the original H3 video VAE and Ref2VA with Sol-H3-VAE. SeedVR2 3B and 7B Sharp completed their small image and video samples and remain experimental. The exact jobs, engine packages and limits are recorded in the [acceptance matrix](https://github.com/nimiplatform/nimi/blob/main/runtime/acceptance/model-matrix.yaml).

Use [multimodal requests](/runtime/multimodal) for media limits and typed fields, and [the Lab walkthrough](/start/use-nimi-lab#try-local-image-and-video-models) for a first run. New source capabilities require matching SDK, Kit and Runtime builds; they are not a promise that a previously published package contains the same implementation.

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
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`config/runtime-managed-image-backend-packages.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-managed-image-backend-packages.yaml)
- [`runtime/catalog/source/providers/local`](https://github.com/nimiplatform/nimi/blob/main/runtime/catalog/source/providers/local)
