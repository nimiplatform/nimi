# Backend-Neutral Architecture

Runtime owns Agent and Conversation semantics. Avatar consumes admitted semantic updates and final voice artifacts, and owns local mapping, rendering, audio playback, and window behavior.

`Runtime / SDK inputs → Avatar built-in translation → selected Live2D or VRM branch`

## Layer Responsibilities

| Layer | Responsibility |
| --- | --- |
| Runtime and SDK | Current-session Agent/Conversation references, activity, emotion, semantic posture, and bounded voice timing |
| Avatar translation | Validated input mapping, local expressions and playback, hit regions, and window layout intent |
| Backend branch | Model loading, render loop, branch-specific parameters, and graphics resource management |

The backend union is strictly `live2d | vrm` (powered by Cubism and three-vrm respectively). Avatar's internal translation layer may access Live2D's parameter extension after backend-kind narrowing, while model packages cannot inject creator handlers or custom backends.

## Activity and Emotion

The built-in adapter consumes `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`, mapping supported inputs to routes or expressions on the active model. `avatar.expression.change` is a local observation—not a new Runtime emotion or a cross-App synchronization command.

## Window Bounds

The backend's nominal bounds and the admitted local scale determine the resting character footprint. Companion controls and other transient overlays do not occupy a permanently docked stack; they appear only when triggered by explicit interaction or voice state, product readiness, and current quiet-state rules.

## Voice

Avatar reads the canonical final-voice artifact through its own protected session and runs playback and lipsync analysis locally. Common Runtime presentation data does not carry phoneme frames or mouth weights, and each surface reads its own admitted session data rather than sharing another window's cache.

## Related Documentation

- [Activity Mapping](/avatar/activity-mapping)
- [Model Capabilities](/avatar/model-capabilities)
- [Instance Lifecycle](/avatar/instance-lifecycle)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
