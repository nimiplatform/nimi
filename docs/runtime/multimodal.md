# Multimodal Capabilities and Asset Custody

Nimi provides unified, type-safe APIs and lifecycle custody for image generation, video rendering, speech synthesis, music composition, and visual reasoning. Capabilities adapt dynamically based on local loaded models and configured cloud connectors.

## Request and Input Conventions

When dispatching multimodal requests, use standard SDK client interfaces:

- **Clean Inputs**: Pass structured prompt text, media byte buffers, or secured asset references without embedding vendor-specific proprietary headers in application logic.
- **Media Adapters**: Tasks accept tailored multimedia payloads conforming to specific operation contracts. For example, text and vision turns accept remote HTTP/HTTPS image URLs or uploaded artifact references (`artifact-ref` obtained via the SDK artifact upload API), while operations such as vision-locate require an `imageArtifactId`; voice cloning tasks accept reference audio buffers subject to duration and format constraints. Direct `file://` URIs are not accepted for local image inputs.

## Asynchronous Outcomes and Structured Data

Multimodal operations typically run as asynchronous scenario jobs:

- **Managed Artifacts**: Generated images, video clips, and audio files are held in managed custody by Runtime. Applications download or stream assets using opaque handles (e.g., `voiceAssetId` or artifact IDs).
- **Structured Values**: Operations such as visual grounding, speech transcription, or OCR return structured JSON records (e.g., bounding boxes, aligned timestamps, categorized labels) for immediate programmatic consumption.

## Asset Custody and Retention

- **Integrity & Access Control**: Managed media assets are stored with verified MIME types, SHA-256 integrity checksums, and strict inter-app isolation.
- **Persistence Best Practices**: Runtime maintains transient caching policies for generated artifacts. If your app requires long-term persistence for projects, copy finalized assets into app-local storage upon job completion.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
