# Embodiment Projection

Embodiment Projection is the **backend-agnostic API surface** for
how an agent's truth turns into visual output on a carrier. NAS
handlers consume the projection; the projection produces
backend-specific calls (Live2D today, VRM future).

## What Projection Owns

| Responsibility | Surface |
| --- | --- |
| Consume runtime / SDK semantic bundle | Read agent state, presentation profile, current emotion, motion |
| Produce backend-specific calls | Translate semantics into the active backend |
| Backend-agnostic API | Same NAS handler shape regardless of backend |
| Backend-specific extensions | Available to handlers when type-narrowed (e.g., `live2dExtension`) |

A NAS handler that operates on backend-agnostic API works with
any backend. A NAS handler that uses `live2dExtension` is bound
to Live2D backend.

## Discriminated Union For Backend

Backend branch is a **closed union**: `live2d | vrm`.

| Property | Value |
| --- | --- |
| Type | Discriminated union |
| Members | `live2d`, `vrm` (future) |
| Extension access | Only when type-narrowed |
| Closed | New backends require admitted contract |

A NAS handler does not invent a third backend. The backend list
is admitted; new backends require kernel admission.

## How Projection Works At Runtime

| Step | Producer | Consumer |
| --- | --- | --- |
| Runtime emits semantic bundle | Runtime presentation stream | Avatar projection layer |
| Projection translates | Avatar projection layer | NAS handler API |
| NAS handler runs | NAS handler | Backend-specific API (when type-narrowed) |
| Backend renders | Live2D / VRM / etc. | Visible output |

## Reader Scenario: A Cross-Backend NAS Handler

A package author writes a `wave` activity handler that should
work on any backend.

1. **Handler at convention path.**
   `<model>/runtime/nimi/activity/wave.js`.
2. **Use backend-agnostic API.** Handler calls embodiment
   projection methods (motion, expression, pose, lookat,
   params, wait).
3. **Projection translates.** On Live2D, it routes through
   Live2D extension; on VRM, it would route through VRM
   extension.
4. **Same handler ships everywhere.** No backend-specific code.

Backend-agnostic handlers are portable.

## Reader Scenario: A Backend-Specific NAS Handler

A package author wants to use a Live2D-specific feature.

1. **Type-narrow.** Handler asserts the backend is `live2d`.
2. **Use `live2dExtension`.** The Live2D-specific extension API
   is now available.
3. **Handler runs only on Live2D.** If the user installs the
   package on a VRM-backed avatar, the type narrowing fails;
   handler falls back to admitted alternative or marks the
   activity as not supported.

The discriminated union prevents accidental backend coupling.

## Reader Scenario: A Semantic Bundle Drives Activity

The agent's runtime emits a "happy" emotion event.

1. **Runtime emits.** `runtime.agent.expression.*` event with
   emotion = happy.
2. **Projection consumes.** Maps emotion to admitted Live2D
   parameters (e.g., mouth shape, expression preset).
3. **Live2D backend renders.** Agent shows happy expression on
   the embodiment stage.
4. **NAS handler may compose.** A `continuous` handler may add
   additional motion that reinforces the emotion.

The runtime is the source; projection is the typed translation;
backend is the renderer.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Agent semantic state | Runtime presentation profile + stream |
| Projection semantics | Avatar embodiment projection contract |
| NAS handler API | Avatar agent-script contract |
| Backend-specific calls | Backend branch contract (live2d / vrm) |

## Source Basis

- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
