# Embodiment Translation

Avatar's built-in translation maps admitted Agent semantics to its selected graphics backend. It is an Avatar-local seam, not a creator scripting API.

## Input and Output

| Input | Avatar-local handling |
| --- | --- |
| Activity and emotion | Validate the current target and map to supported routes or expressions |
| Semantic posture | Apply admitted backend-specific presentation without redefining Agent state |
| Bounded voice timing and final voice artifact | Correlate local playback and derive lipsync locally |
| Backend bounds and hit regions | Derive the body footprint and local pointer behavior |

The active branch is `live2d` or `vrm`. A model's capability profile and optional mapping sidecar determine whether a route is supported. Unsupported or invalid input fails closed; current Avatar does not run NAS creator files or an injected ctx interface.

## Backend Extensions

Only Avatar-owned translation can access branch-local extensions after type narrowing. Live2D parameter IDs remain backend facts, not public APML tags or Runtime activity IDs. A VRM branch cannot use the Live2D extension.

## Local Observations

The current mapping emits `avatar.activity.start`, `avatar.activity.end`, `avatar.activity.cancel` and `avatar.expression.change` for their corresponding local outcomes. A local rendering result neither commits a Conversation turn nor becomes an authoritative Agent state. See [Avatar Events](/avatar/avatar-events) for producer details.

## Related Documentation

- [Backend-Neutral Architecture](/avatar/host-agnostic-architecture)
- [Model Capabilities](/avatar/model-capabilities)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
