# Multimodal Capabilities

Nimi exposes typed capability requests and complete typed or owned-artifact results for admitted image, video, audio, speech, music, and vision operations. Support depends on the exact configured implementation, features, and execution mode; it is not implied by a provider family or installed model.

## Request Inputs

Use the protected App client's operation-specific request shape. Supply content, admitted resource references, and supported parameters. Do not inject provider context, credentials, endpoints, a Local Loadout, or a request-time routing override.

Resource input rules differ by operation. For example, media attached to text generation uses the admitted content-part and owned-artifact contract; a speech Job has its own bytes/URI, MIME, duration, and feature limits. Use the typed API and Runtime-issued support facts rather than converting every media input into a generic URL.

## Asynchronous Results

Submit once and retain the original Job identity. Repeated Get observes and may reconcile a native asynchronous task; subscription events are optional hints. A completed Job requires the entire validated result, including all required artifacts or typed fields. Provider-private task phases do not become a second public state machine.

Some outputs are typed values rather than artifacts: text annotation, transcription, and vision locations have their own result shapes. Voice creation returns its VoiceAsset and VoiceReference through complete terminal Get. A successful empty result, such as no locations, is distinct from a missing required result.

## Artifact Custody

Runtime owns an accepted artifact's bytes, integrity, MIME, audience, lifetime, and authorized reads. An artifact ID is an opaque identity scoped to its Runtime, not a public download URL or proof of access. Read through the admitted App artifact operation and preserve the returned metadata.

Adopt all results needed by the project into App storage before Runtime's bounded retention expires. Saving only a Job or artifact ID is not durable project storage. Music editing, subtitle assembly, chunking, listening review, and business completion remain App responsibilities.

## Failures and Cancellation

Invalid input, unavailable features, incomplete output, failed acquisition, or lost authority returns a typed failure or observation issue. Do not fabricate an artifact, silently drop one member of a required output set, switch implementations, or resubmit generation to recover a result. Explicit Cancel and observation detachment have different effects; preserve submission and stop outcomes.

See [Job observation](/runtime/streaming), [AIConfig](/sdk/ai-config-surface), and the [SDK capability notes](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/README.md).

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
- [`config/runtime-voice-enums.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-voice-enums.yaml)
- [`config/runtime-tts-provider-capability-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/runtime-tts-provider-capability-matrix.yaml)

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
