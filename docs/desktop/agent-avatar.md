# Agent Status and Avatar Presentation

Desktop provides lightweight feedback from the current Conversation result and local recording, input, and playback state. Avatar is a separate embodiment App responsible for Live2D or VRM models, activity, local audio playback, and lipsync analysis.

## Data Sources

| Surface | Input and responsibility |
| --- | --- |
| Desktop chat | Reads admitted Conversation results and combines them with local input/playback state |
| Avatar | Uses its own protected App session for activity, emotion, posture, voice-timing, and final voice artifacts |

Each surface obtains data admitted to its current session. One window's cache is not another surface's state source, and Apps cannot reuse session-scoped Agent handles as cross-session operation selectors.

## Voice and Lipsync

Recorded input, Realtime, and message playback use separate paths; see [Voice Interaction](/desktop/voice-session). Avatar's ordinary Conversation playback reads the final voice artifact, then analyzes it locally to produce mouth weights.

Common Runtime presentation events do not carry viseme/phoneme sequences or renderer mouth parameters. A recording or playback status does not establish that another window has opened Realtime or is displaying word-highlighted subtitles.

## Readiness and Failure

Rendering a model and enabling product interaction have different prerequisites. A development preview can show a model without establishing a live session. Follow the surface's diagnostic reason when session or presentation conditions fail. See [Avatar Instance Lifecycle](/avatar/instance-lifecycle).

## Source Basis

- [`.nimi/spec/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/agent-projection.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-embodiment.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
