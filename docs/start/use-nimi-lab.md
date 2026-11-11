<!-- nimi-docs: {"authority":["rule.nimi.platform.app-ecosystem.lab-web-carrier","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["apps/lab/README.md","apps/lab/NIMI_APP.md","apps/lab/package.json","apps/lab/src/lab/lab-only/upscale.ts","apps/lab/src/studio-modules/studio-media/parameter-panel.tsx"]} -->

# Use Nimi Lab

`apps/lab/` is Nimi's local capability workbench. Built as a fully functional Nimi App, it integrates the latest SDK, Kit, Runtime, Realm, and App Tools capabilities so developers can evaluate and test new features before they are broadly exposed through project templates.

Nimi Lab serves as a reference implementation for capability integration. Core responsibilities—such as permissions, session tokens, model scheduling, and data persistence—remain strictly governed by standard platform boundaries and security invariants.

## Running and Debugging

After completing [Development Environment Setup](/start/install), start Runtime and Nimi Home and sign in. Run the following command from the repository root in a separate terminal:

```bash
pnpm dev:lab
```

Key development scripts provided in `apps/lab/`:

```bash
pnpm dev:shell      # Start the app in the official Electron host
pnpm run validate   # Validate the App manifest and access declarations
pnpm run typecheck  # Check TypeScript types
pnpm run test       # Execute unit and integration tests
```

On Windows and macOS, Nimi Lab runs inside Desktop's supervised Electron development environment. Register local development builds through Developer Mode in Nimi Home and check their Nimi Access session status. Lab is maintained directly in the root workspace; it does not use scaffold init/sync or a public release workflow.

## Try Local Image and Video Models

Use matching source-built Desktop/Runtime, SDK, Kit and Lab. The new sd.cpp recipes currently require a Windows amd64 NVIDIA host; the macOS package remains on 1050. Start native Lab through the supervised command above. Remote browser access and installed distributions have not been validated for these new model paths.

1. In Home, open **AI Capabilities** and select **Image generation**, **Video generation**, **Image super-resolution** or **Video super-resolution**. Choose the model, download missing components and select compatible files already on disk. Wait for preparation to finish and make that configuration current. Downloaded weights alone do not establish readiness.
2. In Lab, open the corresponding entry and configure its AI intent to **Local**. Check the model shown for the next run. Image and video upscaling have separate capability configurations; switching one does not select the other.
3. Open **Parameters** and prepare the input for your task:

| Task | Input and next action |
| --- | --- |
| H3 text generation | Enter a scene prompt in Image generation; leave reference, control image, mask and negative prompt empty, then generate |
| H3 single-image edit | Upload one ordinary **Reference image file** and describe the edit; leave Control image and Mask empty |
| RelayVSR or SeedVR2 upscaling | Upload a PNG/JPEG for Image super-resolution or a complete H264/AAC MP4 for Video super-resolution; select 2× or 4×, matching the RelayVSR recipe; the seed may be left empty |
| SDXL ControlNet Union | Upload a prepared **Control image file**, select its type, and set a canvas matching the map dimensions; Canny and Tile are the exercised modes; strength may be left empty for 1 |
| HyperFlow video | Use Video generation with a text prompt or its supported reference-image mode; prepare the FL2VA/Ref2VA components and select the original video VAE or Sol-H3-VAE in Home |

4. Run the task and inspect the completed image or play the video. A queued/running Job, a downloaded model or an existing history row is not a new successful run. Failed and canceled Jobs retain their actual status. Use the Job's Cancel action to stop inference; navigating away or stopping observation is not the same operation.
5. Reopen the saved result from history. To try a different source, select the input file again. Before switching between ControlNet and ordinary editing, reset parameters so the next request contains only the intended input mode.

Start with a small image or short video. Upscale inputs are limited to 32 MiB; video additionally requires at most 10 seconds/300 frames, nominal 24/25/30 FPS and zero or one AAC audio stream. Other limits are in [Multimodal capabilities](/runtime/multimodal). ControlNet takes prepared maps without automatic preprocessing; repaint is not a promise of masked pixel preservation.

The native Windows RTX 5090 development runs on 2026-11-11 produced real outputs for H3 generation/editing, HyperFlow FL2VA and Ref2VA with Sol, RelayVSR 2x/4x, SeedVR2 3B/7B Sharp and ControlNet Canny/Tile. SeedVR2 is experimental. The remaining ControlNet types, HyperFlow four/eight-step presets, other platforms and installed distributions remain **NOT-VERIFIED**; see [model scope](/runtime/local-models#local-image-and-video-models).

## Key Code and Architectural References

| Area of Interest | Source Path |
| --- | --- |
| Workspace scripts & local checks | `apps/lab/package.json` |
| Protected shell host routing and communication | `apps/lab/README.md` and shell route modules |
| AIConfig storage and application data isolation | `apps/lab/src/lab/lab-ai-config-store.ts` |
| Capability Intent-driven Runtime AI dispatch | `apps/lab/src/lab/lab-runtime.ts` |
| Structured error handling & state mapping | `apps/lab/src/lab/lab-non-success.ts` |
| AI configuration UI component design | `apps/lab/src/lab/workbench/lab-ai-config-settings-panel.tsx` |
| Contract compliance test suites | `apps/lab/test/lab-contract/` |

## Integration Principles

- **Independent Application Identity**: The app ID `nimi.lab` belongs specifically to Nimi Lab; custom applications must declare their own unique App IDs.
- **Data and Fixture Isolation**: Test fixtures, mock datasets, and diagnostics in Lab are for exploration and testing; design dedicated models for your own product logic.
- **Progressive Adoption**: Evaluate new capabilities in Lab first, then adapt relevant patterns into your custom application based on your product needs.
- **Actionable User Guidance**: Surface structured states to users (such as prompting service startup or checking access readiness) to provide clear next steps when an action cannot proceed.

## Common State Codes

| State Code | Meaning | User Feedback Strategy |
| --- | --- | --- |
| `runtime-unavailable` | Local Runtime service is not responding. | Check that local Runtime and Nimi Home are running. |
| `principal-unauthorized` | The current session or caller is not authorized for this operation. | Check sign-in and this app’s Nimi Access status in Nimi Home, then verify the required access declarations in `nimi.app.yaml`; AI calls require `runtime.consume`. |
| `input-invalid` | Prompt or required parameters are missing or malformed. | Prompt the user to verify required parameters and input format. |
| `sdk-method-unavailable` | Capability is not exposed in the current build. | Prompt the user to update the SDK package. |
| `runtime-call-failed` | An error occurred during request processing. | Display a descriptive error message and retain diagnostic logs. |

## Lab in a Browser

Lab also has a declared HTTPS Web entry that reuses the workbench through ordinary remote App admission to the primary PC Runtime. Follow the [Lab README](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md) and [Web guide](/start/connect-web-app), using matching source packages, official login, source confirmation and a reachable direct network.

The Web entry provides the AI workbench, App AIConfig, run history, Agent Center, Conversation, and bounded file operations. Native App Access diagnostics, integrations, realtime media, World Tour, and PC file reveal still require native Lab. Closing the page ends live calls, while durable Jobs remain observable through their original identifiers.

## Source Basis

- [`apps/lab/README.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/README.md)
- [`apps/lab/src/lab/lab-runtime.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-runtime.ts)
- [`apps/lab/src/lab/lab-ai-config-store.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-ai-config-store.ts)
- [`apps/lab/src/lab/lab-non-success.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-non-success.ts)
- [`apps/lab/NIMI_APP.md`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/NIMI_APP.md)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`apps/lab/src/lab/lab-only/upscale.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/lab/lab-only/upscale.ts)
- [`apps/lab/src/studio-modules/studio-media/parameter-panel.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/studio-modules/studio-media/parameter-panel.tsx)
