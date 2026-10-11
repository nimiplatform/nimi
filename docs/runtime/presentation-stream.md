# Agent Presentation Inputs and Voice Correlation

A formal App reads and subscribes to bounded Agent presentation data through the SDK embodiment client. Runtime supplies semantics and timing; Avatar maps those inputs to model activity, expression, and local playback.

## Common Presentation Events

The current event types are activity, emotion, posture, and voice-timing. Voice timing contains duration, deadline, and turn correlation information. It does not contain renderer mouth weights, viseme or phoneme frames, bone curves, or playback instructions.

Calls use the current App session's `agentHandle` and exact `conversationAnchorId`. Runtime validates the session, declared access, and operation before returning admitted snapshots or updates.

## Avatar Final-Voice Playback

1. Conversation commits a final voice sidecar containing an artifact reference.
2. Avatar uses its own session handle and Conversation anchor to read that artifact through `conversation.readArtifact`.
3. Avatar plays and analyzes the audio locally, then presents it through the selected Live2D or VRM backend.

An Avatar-local audio_chunk event may carry the entire artifact already read. Its name does not establish a Runtime-native audio stream. Independently admitted Realtime media and general speech generation have their own APIs and prerequisites.

## Consumer Responsibilities

Desktop uses Conversation results and local input or playback state for lightweight feedback. Avatar independently consumes data admitted to its own session; Desktop does not forward cached Conversation state or mouth frames to it. Renderer state and playback progress do not rewrite Runtime Conversation or Agent semantics.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`proto/runtime/v1/agent_presentation.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/agent_presentation.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
