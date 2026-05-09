# Agent Script

> Status: Running today. NimiAgentScript (NAS) 1.0 is the shipped
> convention; auto-discovery and hot reload are live.

NimiAgentScript (NAS) is the convention-based JS handler system
that drives an embodiment. Embodiment package creators write JS
files at convention paths; runtime auto-registers them; hot
reload via Tauri notify watcher.

For the full authoring walkthrough — handler shape, available API
surface, hot reload behavior, type narrowing — see
[NAS Handler Authoring](/avatar/nas-handler-authoring.md). This
page is the conceptual overview.

## Three Handler Kinds

| Kind | Path | Fires when |
| --- | --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` | An activity is requested |
| Event | `<model>/runtime/nimi/event/<name>.js` | A typed event happens (e.g., user click on body region) |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` | Continuously, while admitted condition holds |

Plus `lib/` for shared code.

## Convention Over Configuration

| Property | Value |
| --- | --- |
| Path-based registration | Yes — file at convention path = registered handler |
| Manifest-required? | No — convention paths are sufficient |
| Hot reload | yes — Tauri notify watcher detects changes |
| Scoping | Per-model |

Authors do not write a "register this handler" call. The path
**is** the registration.

## Available Handler APIs

| API | Purpose |
| --- | --- |
| Motion | Trigger motion sequences |
| Expression | Set expressions |
| Pose | Set poses |
| Lookat | Set gaze direction |
| Params | Drive admitted Live2D parameters (or backend-agnostic equivalents) |
| Wait | Await admitted timing primitives |

NAS handlers consume these via the embodiment projection API.
They don't directly call Live2D / VRM internals; the projection
is the typed seam.

## Backend-Specific Extensions When Type-Narrowed

Live2D-specific handlers can use `live2dExtension` after type
narrowing. VRM-specific handlers (when VRM ships) will use a
distinct extension after their own type narrowing. Cross-backend
handlers stay on the backend-agnostic API.

## Reader Scenario: An Activity Handler Plays A Wave Animation

A package author wants the agent to wave when a `wave` activity
fires.

1. **Author handler.** At
   `<model>/runtime/nimi/activity/wave.js`. Handler signature
   exposes runtime context plus admitted APIs.
2. **Auto-registered.** Runtime scans, finds the file at the
   convention path, registers it.
3. **Activity fires.** When `runtime.agent.activity.wave` is
   emitted, handler runs.
4. **Handler runs.** Calls motion API to trigger wave; calls
   expression API to set a smile; calls wait to hold the pose;
   calls expression to return to neutral.
5. **Embodiment renders.** Live2D backend renders the sequence.

The author wrote a JS file at a path; the rest is automatic.

## Reader Scenario: An Event Handler Reacts To A Click

A package author wants the agent to react when its head is
clicked.

1. **Author handler.** At
   `<model>/runtime/nimi/event/onClickHead.js`.
2. **Hit region declared.** Per the embodiment package, the
   "head" region is declared with alpha-mask boundary.
3. **User clicks head.** Hit region detection fires
   `avatar.user.click` event with region info.
4. **Handler runs.** Triggers a shy expression and a small
   sound effect.

The handler did not have to subscribe; the convention path was
sufficient.

## Reader Scenario: A Continuous Handler Keeps The Agent Breathing

A package author wants the agent to breathe continuously.

1. **Author handler.** At
   `<model>/runtime/nimi/continuous/breathe.js`.
2. **Auto-registered as continuous.** Runtime invokes the
   handler under admitted continuous timing primitives.
3. **Handler runs continuously.** Drives a breathing parameter
   (Live2D `ParamBreath`).
4. **Other handlers compose.** Activity handlers can compose
   over this without disabling breathing.

Continuous handlers are how subtle ambient behaviors layer on
without each other clashing.

## Hot Reload During Development

| Tooling | Behavior |
| --- | --- |
| Tauri notify watcher | Detects filesystem changes |
| Auto re-registration | New / updated handlers picked up |
| Removal | Deleted files unregister handlers |
| Errors | Typed reload errors do not crash the session |

A package author iterates on handlers without having to restart
Avatar.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Handler discovery | Convention paths under `<model>/runtime/nimi/` |
| Handler API | Embodiment projection methods |
| Backend extensions | Backend-specific extensions after type narrowing |
| Hot reload | Tauri notify watcher |

## Source Basis

- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
