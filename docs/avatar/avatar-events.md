# Avatar Local Observation Events

This reference covers the local observation events emitted by Avatar's internal driver. Runtime retains ownership of activity, emotion, and Conversation semantics; Avatar events reflect local mapping, pointer input, or playback activity and are not a cross-App command API.

## Exact Names from Current Producers

| Name | Meaning |
| --- | --- |
| `avatar.before.activity.start` | Local pre-mapping observation that the active cancellation policy may block |
| `avatar.activity.start` | Emitted when the current activity mapping is applied |
| `avatar.activity.end` | Emitted when that same activity mapping settles |
| `avatar.activity.cancel` | Emitted when an activity is blocked before execution by the local cancellation policy |
| `avatar.expression.change` | Emitted when the local expression mapping changes |
| `avatar.user.click` | Emitted on local pointer input within a model hit region |
| `avatar.speak.interrupt` | Emitted when the current voice or lipsync path is interrupted |

A settled activity mapping may emit `avatar.activity.start` and `avatar.activity.end` back-to-back. `avatar.activity.end` marks mapping settlement, not the completion of a physical animation clip. Voice playback lifecycle runs on the local state bus and does not emit `avatar.speak.start` or `avatar.speak.end`.

## Runtime Inputs

The SDK driver consumes admitted embodiment updates and translates them into internal inputs such as `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`. Model directories cannot register NAS JavaScript handlers, and pointer clicks do not invoke creator scripts such as `onClickHead.js`.

## Pointer Handling

The model surface tests the pointer against valid hit regions and forwards hits to built-in interaction physics. The outcome stays within Avatar's local input and presentation layer without creating Runtime Conversation state or authorization grants.

## Final-Voice Playback

Avatar reads the canonical Conversation's final voice `artifactId` through its own protected session, then passes the complete artifact to local playback and lipsync analysis. `avatar.conversation.voice.audio_chunk` is an Avatar-local event that may carry the full artifact bytes on this read path; it does not represent a Runtime-native audio stream or playback instruction.

High-frequency mouth weights and backend draw details stay inside the local rendering path and do not enter the common Runtime presentation contract.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts)
