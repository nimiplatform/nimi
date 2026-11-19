# Voice Input, Realtime, and Reply Playback

In Home, a partner conversation lets you dictate a draft and play individual replies. Before using any audio feature, check the interface for your active voice configuration and availability indicators.

## Recorded Voice Input

1. Click the microphone button and grant microphone access if prompted.
2. Speak while recording is active.
3. Click the button again to stop. If the draft is still unchanged when transcription finishes, the transcript is appended to it. Review the draft and select **Send**.

Recording requires manual stopping: pausing while you speak does not automatically submit the turn, and the composer does not display a live word-by-word transcript during recording.

## Realtime Media

Apps that expose a Realtime entry can open a separate media session. Lab’s Agent Realtime uses server-side voice activity detection to identify turns.

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
- [`apps/desktop/src/shell/renderer/features/chat/home-partner-conversation.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/home-partner-conversation.tsx)
- [`apps/lab/src/product-modules/agent-realtime/index.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/lab/src/product-modules/agent-realtime/index.tsx)
- [`kit/features/chat/src/components/canonical-message-actions.tsx`](https://github.com/nimiplatform/nimi/blob/main/kit/features/chat/src/components/canonical-message-actions.tsx)
