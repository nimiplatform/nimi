# Voice Input, Realtime, and Reply Playback

Agent Chat offers three distinct audio paths: recorded voice input, Realtime media sessions, and on-demand reply playback. Before using any audio feature, check the interface for your active voice configuration and availability indicators.

## Recorded Voice Input

1. Click the microphone button and grant microphone access if prompted.
2. Speak while recording is active.
3. Click the button again to stop. Runtime transcribes the completed recording, and the client submits the recognized text as a Conversation turn.

Recording requires manual stopping: pausing while you speak does not automatically submit the turn, and the composer does not display a live word-by-word transcript during recording.

## Realtime Media

When supported by the current session and the Agent's configured capabilities, use the dedicated Realtime entry point to start and end a live media session. Realtime media is separate from recorded voice input and uses manual turn detection—pauses in speech will not automatically submit a turn.

## Playing Individual Replies

Click the playback button on a reply with playback available to hear it spoken. The client requests voice rendering for that message, retrieves the completed audio artifact once generated, and plays it locally. This action plays only the selected message; it does not auto-play subsequent replies or show real-time highlighted subtitles.

If voice processing fails, check the returned error reason to troubleshoot your session state, configuration, model availability, or network connection. Committed text messages remain intact regardless of playback results.

## Avatar Playback

The Avatar uses the canonical Conversation's final voice artifact and bounded timing metadata to handle local playback and lipsync analysis. Standard Runtime presentation events do not carry renderer mouth weights or viseme frames. In addition, the separate Realtime media path enforces its own admission rules and cannot be inferred from the Avatar's local audio events.

## Related Documentation

- [Conversation Controls](/desktop/conversation-capability)
- [Voice Asset Lifecycle](/runtime/voice-asset-lifecycle)

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
