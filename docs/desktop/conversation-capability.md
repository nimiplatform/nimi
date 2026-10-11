# Controls in an Agent Conversation

The controls in the current conversation let you attach an image, record a voice input, open an available Realtime session, or play a particular reply. Each action depends on the active App session and the required Runtime capability; a local button state does not establish availability.

## Current Controls

| Action | Result |
| --- | --- |
| Attach an image | Adds one pending image to this turn; document and code-file attachments are not accepted |
| Record voice input | Captures audio until you stop recording, then transcribes and submits the recognized text |
| Use an available Realtime entry | Opens a separate realtime media session with its own controls and capability prerequisites |
| Play a reply | Renders voice for that message, reads its completed artifact, and plays it locally |

Paste code or document excerpts as text when you want the Agent to discuss them. Temporary input and playback controls do not change the Agent's shared AIConfig.

## Play One Reply

1. Find a reply that offers the playback action.
2. Click Play. Runtime checks the current voice configuration and generation prerequisites for that message.
3. Once the voice artifact is ready and has been read, the client plays it. Follow the displayed reason if playback is unavailable.

This action applies to the selected reply. It is not a switch that makes every later text reply arrive with streaming audio or highlighted subtitles. See [Voice Interaction](/desktop/voice-session) for the separate input and Realtime paths.

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-canonical-composer.tsx)
- [`apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/desktop/src/shell/renderer/features/chat/chat-agent-manual-voice-playback-button.tsx)
