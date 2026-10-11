# Voice Input, Realtime, and Reply Playback

Agent Chat has separate paths for recorded voice input, Realtime media, and playing a reply. Check the current voice configuration and the availability shown by the interface before using a path.

## Recorded Voice Input

1. Click the microphone control and allow microphone access when prompted.
2. Speak while recording is active.
3. Click again to stop. Runtime transcribes the completed recording; the client then submits the recognized text as a Conversation turn.

The current recording path uses manual stopping. A pause in speech does not automatically submit the turn, and the composer does not show a word-by-word transcript while this recording runs.

## Realtime Media

Use the separate Realtime entry when the current session and configured capability support it. It opens a media session with its own start and end controls. The current request uses manual turn detection; do not treat it as the recorded-input flow or assume that a pause automatically submits a turn.

## Play a Particular Reply

Use the playback action on a reply. The client requests voice rendering for that message, waits for the completed artifact, reads it, and plays it locally. This does not enable automatic audio for every later reply or real-time highlighted subtitles.

If voice processing fails, use the returned reason to check the session, configuration, model, or connection. Already committed text remains separate from the playback result.

## Avatar Playback

Avatar uses the canonical Conversation's final voice artifact and bounded timing information. It owns local playback and lipsync analysis. Common Runtime presentation events do not carry renderer mouth weights or viseme frames. The separate Realtime media path has its own admission and cannot be inferred from Avatar's local audio events.

## Related Documentation

- [Conversation Controls](/desktop/conversation-capability)
- [Voice Asset Lifecycle](/runtime/voice-asset-lifecycle)

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-voice-input.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-realtime-voice.ts)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
