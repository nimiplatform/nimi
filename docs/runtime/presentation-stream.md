# Agent Presentation Inputs and Voice Correlation

Formal Apps read and subscribe to bounded Agent presentation data through the SDK embodiment client. Runtime supplies semantic events and timing metadata, while Avatar maps those inputs to model activity, expressions, and local audio playback.

## Common Presentation Events

Current presentation event types include `activity`, `emotion`, `posture`, and `voice-timing`. A `voice-timing` event carries duration, deadline, and turn-correlation metadata; it never includes renderer mouth weights, viseme or phoneme frames, bone curves, or playback instructions.

Requests must provide the active App session's `agentHandle` and exact `conversationAnchorId`. Runtime validates the session state, declared access, and operation type before returning admitted snapshots or stream updates.

## Avatar Final-Voice Playback

1. Conversation commits a final voice sidecar containing an artifact reference.
2. Avatar uses its own session `agentHandle` and Conversation anchor to read that artifact via `conversation.readArtifact`.
3. Avatar plays and analyzes the audio locally, then drives presentation through the selected Live2D or VRM backend.

An Avatar-local `audio_chunk` event may carry the full artifact payload already read; the event name does not imply a Runtime-native audio stream. Independently admitted Realtime media and general speech generation use their own APIs and admission prerequisites.

## Consumer Responsibilities

Desktop uses Conversation results and local input or playback state for lightweight UI feedback. Avatar independently consumes data admitted to its own session—Desktop never forwards cached Conversation state or mouth frames to Avatar. Renderer state and playback progress never write back to or alter Runtime Conversation or Agent semantics.

## Source Basis

- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`proto/runtime/v1/agent_presentation.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/agent_presentation.proto)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
