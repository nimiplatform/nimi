# Backend-Neutral Architecture

Runtime owns Agent and Conversation semantics. Avatar consumes admitted semantic updates and final voice artifacts, then owns the local mapping, rendering, playback, and window behavior.

`Runtime / SDK inputs → Avatar built-in translation → selected Live2D or VRM branch`

## Layer Responsibilities

| Layer | Responsibility |
| --- | --- |
| Runtime and SDK | Current-session Agent/Conversation references, activity, emotion, semantic posture, and bounded voice timing |
| Avatar translation | Validated input mapping, local expressions and playback, hit regions, and shell intent |
| Backend branch | Model loading, draw loop, branch-specific parameters, and graphics resources |

The backend union is exactly `live2d` and `vrm`. Live2D uses Cubism; VRM uses three-vrm. Avatar-owned translation may use Live2D's parameter extension after kind narrowing. Model packages cannot inject creators' handlers or private backends.

## Activity and Emotion

The built-in adapter consumes `runtime.agent.presentation.activity_requested` and `runtime.agent.state.emotion_changed`. Supported input maps to the selected model's route or expression. `avatar.expression.change` is a local observation, not a new Runtime emotion or a cross-App synchronization command.

## Window Bounds

Backend nominal bounds and the admitted local scale determine the quiet body's footprint. Companion controls and other transient overlays are not added as a permanent docked stack. Their appearance depends on explicit interaction or voice state, product readiness, and the current quiet state.

## Voice

Avatar reads the canonical final-voice artifact through its own session and performs local playback/lipsync. Common Runtime presentation data does not provide phoneme frames or mouth weights. Each surface uses its own admitted data rather than copying another window's cache.

## Related Documentation

- [Activity Mapping](/avatar/activity-mapping)
- [Model Capabilities](/avatar/model-capabilities)
- [Instance Lifecycle](/avatar/instance-lifecycle)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
