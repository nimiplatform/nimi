# Avatar Local Observation Events

This reference describes observations on Avatar's current internal driver. Runtime retains activity, emotion, and Conversation semantics. Avatar events describe local mapping, input, or playback; they are not a cross-App command API.

## Exact Names from Current Producers

| Name | Meaning |
| --- | --- |
| `avatar.before.activity.start` | Local before-mapping observation that the current cancellation policy may block |
| `avatar.activity.start` | Observation emitted when the current activity mapping is applied |
| `avatar.activity.end` | End observation from that same mapping-settlement path |
| `avatar.activity.cancel` | Activity blocked by the local before-execution cancellation policy |
| `avatar.expression.change` | Local expression-mapping change |
| `avatar.user.click` | Local pointer input on a model hit region |
| `avatar.speak.interrupt` | Interruption observation on the current voice/lipsync path |

A settled activity mapping can emit start and end consecutively. End is not proof that a physical animation clip finished playing. Voice playback lifecycle uses the local state bus; this path does not emit `avatar.speak.start` or `avatar.speak.end`.

## Runtime Inputs

The SDK driver consumes admitted embodiment updates and translates them into current internal inputs including `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`. Model directories do not register NAS JavaScript handlers, and clicks do not invoke a creator's onClickHead.js.

## Pointer Handling

The model surface checks the hit region and sends the click to built-in interaction physics. The result belongs to Avatar's local input and presentation, not Runtime Conversation or authorization state.

## Final-Voice Playback

Avatar reads the canonical Conversation's final voice artifactId through its own session, then supplies the complete artifact to local playback and lipsync analysis. `avatar.conversation.voice.audio_chunk` is an Avatar-local event that may carry all the bytes in this read path; it does not establish a Runtime-native stream or playback instruction.

High-frequency mouth weights and backend draw details stay within local rendering and do not enter the common Runtime presentation contract.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-lipsync/avatar-voice-lipsync.ts)
