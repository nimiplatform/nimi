# Avatar Events

Avatar events are typed, bounded observations of what the local
presentation is doing. They let Avatar's own handlers and components
react to rendering, playback, interaction, backend, and lifecycle
results. They are not a public driver API, not a cross-app event bus,
and not a source of Runtime LocalAgent truth.

## Observation Families

| Family | Local observation |
| --- | --- |
| `avatar.user.*` | Bounded pointer interaction and hit-region results |
| `avatar.activity.*` | Start, completion, or cancellation of Avatar-local activity handling |
| `avatar.motion.*` | A validated backend motion result |
| `avatar.expression.*` | A validated backend expression result |
| `avatar.pose.*` | A validated backend pose result |
| `avatar.lookat.*` | A validated backend look-at result |
| `avatar.speak.*` | Avatar-local audio playback and interruption observations |
| `avatar.lipsync.*` | Bounded lipsync phase observations, never per-frame public events |
| `avatar.app.*` | Avatar application lifecycle observations |
| `avatar.composition.*` | Closed shell lifecycle observations |

Each emitted event has one declared identity, a typed payload, an active Avatar
instance, a validated backend result where applicable, and an owner-defined
rate posture. Wildcard driver hooks and generic public cancellation are not
part of the surface.

## Runtime Input and Avatar Output

Runtime owns participation, turns, presentation intent, emotion state, voice
timing, continuity, and provenance. Avatar consumes those typed results through
the SDK and may report what happened locally after a backend acts.

For example, a Runtime presentation activity can lead to an
`avatar.activity.start` observation after Avatar accepts the activity. Avatar
may later report completion or cancellation based on the local handler and
backend result. It does not mirror the event as a new Runtime event or claim
that rendering success changes Runtime state.

## Interaction Scenario

1. The user clicks a visible part of the embodiment.
2. The active backend returns a bounded hit-region result.
3. Avatar emits a typed `avatar.user.click` observation for the active
   instance.
4. An admitted Avatar-local handler may react within the Avatar boundary.

The event does not grant another App raw motion, expression, renderer, or
backend control.

## Speech and Lipsync Scenario

1. Runtime provides typed voice timing and audio playback input.
2. Avatar attaches the audio source to the active Live2D, VRM, or Nimi2D
   backend audio consumer.
3. The backend derives bounded mouth weights and renders them locally.
4. Avatar may report lifecycle or lipsync phase observations after local
   playback results.

Per-frame mouth values stay inside the renderer path. Avatar does not publish
deprecated per-frame lipsync events as product API and does not invent voice
timeline truth.

## Backend and Lifecycle Scenario

1. Avatar validates one backend branch: `live2d`, `vrm`, or `nimi2d`.
2. The branch loads resources and produces visible output.
3. Avatar reports the local backend or lifecycle result for the active
   instance.
4. If Runtime input, the instance, or the backend is stale or mismatched,
   Avatar rejects the success-shaped event.

## Ownership Summary

| Concern | Owner |
| --- | --- |
| Local rendering, playback, interaction, backend, and lifecycle observations | Avatar |
| Local event handlers | Avatar |
| LocalAgent participation, presentation, state, voice timing, continuity, and provenance | Runtime |
| Backend-specific parameter execution | The active Avatar backend branch |
| Cross-app product state | Its owning Realm or Runtime surface, not Avatar events |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
