# Embodiment Translation

Avatar's built-in translation layer maps admitted Agent semantics to the active graphics backend (`live2d` or `vrm`). It is an internal Avatar boundary, not a creator scripting API.

## Input and Output

| Input | Avatar-Local Handling |
| --- | --- |
| Activity and emotion | Validate the target and map it to supported routes or expressions |
| Semantic posture | Apply admitted backend-specific presentation without redefining Agent state |
| Bounded voice timing and final voice artifact | Correlate local playback and derive lipsync locally |
| Backend bounds and hit regions | Compute the character window footprint and local pointer behavior |

A model's capability profile and optional mapping sidecar determine which routes are supported. Unsupported or invalid inputs fail closed; current Avatar does not execute NAS creator files or expose an injected `ctx` interface.

## Backend Extensions

Only Avatar-owned translation code can access branch-specific extensions after explicit type narrowing. Live2D parameter IDs remain backend-internal facts rather than public APML tags or Runtime activity IDs, and a VRM branch cannot call the Live2D parameter extension.

## Local Observations

The translation layer emits `avatar.activity.start`, `avatar.activity.end`, `avatar.activity.cancel`, and `avatar.expression.change` to report local outcomes. Local rendering results never commit a Conversation turn or become authoritative Agent state. See [Avatar Events](/avatar/avatar-events) for event producer details.

## Related Documentation

- [Backend-Neutral Architecture](/avatar/host-agnostic-architecture)
- [Model Capabilities](/avatar/model-capabilities)

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/semantic-projection/event-dispatch.ts)
- [`apps/avatar/src/shell/renderer/carrier/backend-branch.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/carrier/backend-branch.ts)
