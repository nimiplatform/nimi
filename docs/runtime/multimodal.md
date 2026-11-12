<!-- nimi-docs: {"authority":["rule.nimi.runtime.remote-access.operation-carrier","rule.nimi.runtime.remote-access.asset-write-stream","rule.nimi.runtime.ai-provider.media-upscale-contract","rule.nimi.runtime.ai-provider.sdxl-controlnet-union","rule.nimi.runtime.ai-provider.minimax-h3-local-image","rule.nimi.runtime.ai-provider.hyperflow-h3-local-video"],"sources":["runtime/internal/grpcserver/remote_transport.go","sdks/typescript/runtime/remote-data-channel.ts","examples/sdk/09-media-jobs.ts","sdks/typescript/core/app/local-app-runtime-platform-ai.ts","apps/lab/src/lab/lab-only/upscale.ts"]} -->

# Multimodal Capabilities and Asset Custody

Nimi provides typed APIs for image and video generation, upscaling, speech, music and visual reasoning. For example, an App can upload a small image, submit an `image.upscale` Job, then retain the enlarged PNG in its project. The selected model and execution route determine which inputs are available.

## Request and Input Conventions

When dispatching multimodal requests, use standard SDK client interfaces:

- **Clean Inputs**: Pass structured prompt text, media byte buffers, or secured asset references without embedding vendor-specific proprietary headers in application logic.
- **Media Adapters**: Tasks accept tailored multimedia payloads conforming to specific operation contracts. For example, on carriers that admit URL inputs, text and vision turns accept HTTP/HTTPS image URLs or uploaded artifact references (`artifact-ref` obtained via the SDK artifact upload API), while operations such as vision-locate require an `imageArtifactId`; voice cloning tasks accept reference audio buffers subject to duration and format constraints. Direct `file://` URIs are not accepted for local image inputs.

## Image and Video Upscaling

`image.upscale` and `video.upscale` are separate capability intents. The native App Job types are `image-upscale` and `video-upscale`. Neither takes a prompt. Prepare a compatible model in Home, save the App's Local intent, then submit one uploaded `sourceArtifactId`, `scale: 2 | 4`, and an optional integer `seed` from 0 through 2147483647. Omitting the seed uses 42; zero is a valid fixed seed.

| Contract | Source | Output and limits |
| --- | --- | --- |
| `image.upscale` | One PNG or JPEG, at most 32 MiB | One PNG at exactly 2× or 4× the source dimensions; each output axis is at most 4096 pixels |
| `video.upscale` | One complete MP4, at most 32 MiB; one H264 stream at nominal 24, 25 or 30 FPS; at most 10 seconds and 300 frames; zero or one AAC stream | One MP4 preserving frame count, order, timestamps and source audio; each output axis is at most 4096 pixels and all decoded output RGB frames together are at most 512 MiB |

Video timestamps must increase from a zero origin. Runtime checks the actual media, including timing and decoded output size; changing a filename or MIME label cannot make an unsupported file valid. Upscaling can reconstruct detail and is not a pixel-preserving resize.

The verified Windows combinations use amd64 with NVIDIA acceleration. Check the Mac results and INT8 ConvRot limitation in Local models. RelayVSR 2x and 4x require their matching scale-specific transformer and VAE; SeedVR2 3B and 7B Sharp accept 2× or 4× and retain experimental status. Cloud execution is not implemented for these two capabilities. See [Local models](/runtime/local-models#local-image-and-video-models) for component and platform requirements.

Use the matching source-built SDK, Kit and Runtime described in [development setup](/start/install); a matching package version string alone does not establish that these additions are present. The following functions receive the App's existing host-bound client. Save a unique `clientSubmissionId` in App storage before submission and persist the returned Job ID. If submission observation is interrupted, use `client.ai.scenarioJobs.lookupSubmission(clientSubmissionId)` to recover the original request; do not submit another Job automatically.

<<< ../../examples/sdk/09-media-jobs.ts#upscale

## Control Images and Ordinary Reference Images

SDXL ControlNet Union ProMax extends `image.generate`; it is not a separate capability. Its `controlImage` contains an owned `imageArtifactId`, an explicit `ImageControlType`, and optional `strength` from 0 through 2, defaulting to 1. The prepared map must match the requested canvas dimensions. The public enum is exported from `@nimiplatform/sdk/runtime/wire-types`.

Supported type values are `OPENPOSE`, `DEPTH`, `SCRIBBLE`, `CANNY`, `NORMAL`, `SEGMENT`, `TILE` and `REPAINT`. Prepare the appropriate map before uploading: Runtime does not automatically run a pose, depth or edge detector. Repaint follows the model's prepared control-map convention and does not guarantee preservation outside a mask. Canny and Tile have been exercised in native Lab; real execution of the other six types remains **NOT-VERIFIED**.

Select the SDXL ControlNet Union configuration in Home before using this example. Supply a 1024×1024 Canny PNG and a scene prompt. The native image Job type requires empty strings/arrays for unused standard fields; these represent absent controls, not a request to use those features:

<<< ../../examples/sdk/09-media-jobs.ts#control

MiniMax-H3-Image ordinary editing instead uses `referenceImageArtifactId` with one uploaded reference. It accepts no mask or negative prompt. To generate from text, submit `image-generate` with a prompt and omit the reference. The current recipe produces one image with a six-step Euler schedule and CFG 1; its default canvas is 1024×1024 with axes aligned to 32 pixels.

<<< ../../examples/sdk/09-media-jobs.ts#reference

Do not combine an ordinary reference or mask with ControlNet input. Other image implementations reject `controlImage` until they explicitly support it. See the [Lab guide](/start/use-nimi-lab#try-local-image-and-video-models) to exercise both input modes through the UI.

## Observe, Cancel and Retain a Media Job

After submission, query the original Job until it reaches a terminal state. An observation error is not a failed inference result. Failed, canceled and timed-out Jobs do not produce a completed output. Stopping polling does not cancel inference: send an explicit Cancel request and inspect the resulting Job state.

This example adopts the complete result into App-private storage without buffering the entire output in the renderer. Pass a new App-relative destination, for example a project path containing the Job ID, and save the returned asset metadata. If adoption observation is lost, inspect that destination before another explicit save; do not overwrite an existing project file or regenerate the result automatically. Use `client.storage.assets.read` or the supported Kit media preview to consume the retained asset.

<<< ../../examples/sdk/09-media-jobs.ts#result

These examples are typechecked against the workspace SDK; they are not standalone CLI programs. The real model observations used native, Desktop-supervised Lab on Windows RTX 5090 with sd.cpp `master-1088-32d516c` on 2026-11-11. The linked Local Models guide records the separate Apple Silicon development results. Installed distributions, remote Web/Android and other inputs remain **NOT-VERIFIED**.

## Asynchronous Outcomes and Structured Data

Multimodal operations typically run as asynchronous scenario jobs:

- **Managed Artifacts**: Generated images, video clips, and audio files are held in managed custody by Runtime. Applications read or adopt files using returned artifact IDs. A `voiceAssetId` selects a voice; it is not a generic file-download handle.
- **Structured Values**: Operations such as admitted visual grounding or speech transcription return structured JSON records (e.g., bounding boxes, aligned timestamps, categorized labels) for immediate programmatic consumption.

## Asset Custody and Retention

- **Integrity & Access Control**: Managed media assets are stored with verified MIME types, SHA-256 integrity checksums, and strict inter-app isolation.
- **Persistence Best Practices**: Runtime maintains transient caching policies for generated artifacts. If your app requires long-term persistence for projects, copy finalized assets into app-local storage upon job completion.

## Remote Web/Android Media

The current remote carrier rejects raw URL or URI values in typed media fields. Pass inline bytes or artifact/asset references that the App is authorized to read, and do not ask the PC Runtime to fetch arbitrary client-selected addresses. Even when a general capability contract defines an input mode, it is only available remotely if the remote carrier supports it; native file reveal and unimplemented bidirectional realtime sessions remain explicitly unavailable.

App asset writes use incremental input within bounded credits, while the existing owner handles total limits, quotas and atomic commit. Cancellation or disconnect cannot publish a partial file or trigger automatic resumption. Query accepted durable Jobs by their existing identifiers rather than resubmitting after a disconnect.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`.nimi/spec/runtime/media-upscale.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/media-upscale.authority.yaml)
- [`examples/sdk/09-media-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/09-media-jobs.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai.ts)
