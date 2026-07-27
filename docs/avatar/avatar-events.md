# Avatar Events

> Status: Running today. The event taxonomy is admitted at the
> kernel level; the event bus is shipped.

Avatar emits a typed event surface that NAS handlers, Avatar app
components, and runtime components observe. The event families are admitted at
the kernel level; they are not free-form.

## Event Families

| Family | What it covers |
| --- | --- |
| `avatar.user.*` | User input — click, drag, hover |
| `avatar.activity.*` | Activity events — typed action requests |
| `avatar.motion.*` | Motion lifecycle |
| `avatar.expression.*` | Expression changes |
| `avatar.pose.*` | Pose changes |
| `avatar.lookat.*` | Gaze direction |
| `avatar.speak.*` | Speech / voice output lifecycle |
| `avatar.lipsync.*` | Lipsync frame events |
| `avatar.app.*` | App lifecycle (`start`, `ready`, etc.) |
| `avatar.companion.*` | Companion surface events |
| `avatar.composition.*` | Composition state transitions |

Each family is admitted; new families require kernel admission.

## Admitted Family Examples

### `avatar.user.*`

| Event | Fires |
| --- | --- |
| `avatar.user.click` | User clicks (with hit region info) |
| `avatar.user.drag` | User drags |
| `avatar.user.hover` | User hovers |

### `avatar.activity.*`

Activities are typed action requests. NAS activity handlers fire
on the matching event.

### `avatar.motion.*`, `avatar.expression.*`, `avatar.pose.*`, `avatar.lookat.*`

Lifecycle events: started, in-progress, completed.

### `avatar.speak.*`, `avatar.lipsync.*`

Voice output lifecycle: speech requested, audio played back, lip
movement frames synchronized.

### `avatar.app.*`

| Event | Fires |
| --- | --- |
| `avatar.app.start` | Avatar app starts |
| `avatar.app.ready` | Composition state reached `ready` |

### `avatar.composition.*`

State transitions of the composition state machine
(`loading → ready → degraded:* → relaunch-pending`).

## Reader Scenario: A NAS Handler Subscribes To Avatar Events

A NAS handler wants to react when the agent expresses an emotion.

1. **Handler registers.** Through admitted Avatar handler discovery,
   the handler subscribes to `avatar.expression.*`.
2. **Avatar emits.** When the agent's runtime drives an
   expression update, the projection emits
   `avatar.expression.changed`.
3. **Handler receives.** Typed event with old + new expression.
4. **Handler acts.** Within the Avatar handler boundary.

Avatar events are observable; the handler did not have to construct
its own state inference loop.

## Reader Scenario: A Cross-App Coordination

Another app (not Avatar) wants to coordinate with Avatar — for
example, sync visual emotion with chat UI.

1. **Avatar emits expression event.** Across the runtime event
   bus.
2. **Other app subscribes.** Through admitted runtime event
   subscription.
3. **Apps coordinate.** Both reflect the same emotion at roughly
   the same time.

The `avatar_instance_registry` provides the cross-app coordination
seam (admitted under the avatar app-shell contract).

## Reader Scenario: APML Output Drives Avatar Events

A model emits an APML response that includes typed activity and
emotion intent. Avatar reflects both as event emissions.

1. **Model emits APML.** Public wire: `<activity name="wave" />` plus
   `<emotion name="happy" />`.
2. **Runtime parses + validates.** The runtime owns APML parsing.
   Typed projection events fire:
   `runtime.agent.presentation.activity_requested` and
   `runtime.agent.state.emotion_changed`.
3. **Avatar receives via SDK.** Projection consumes the typed events.
4. **Generated motion provider produces backend output.** Per
   [Generated Motion Provider](/avatar/generated-motion-provider.md).
5. **Avatar event bus emits.** `avatar.activity.started` /
   `avatar.expression.changed` propagate to NAS handlers and
   subscribing apps.
6. **Backend renders.** Live2D plays the wave motion + happy
   expression.

The chain crosses runtime → SDK → projection → provider → backend →
event bus, all through admitted seams. No raw APML reaches Avatar;
no Avatar event invents semantic truth.

## Reader Scenario: Lipsync Bridge

The agent speaks; lip movement should sync with the audio.

1. **Runtime emits voice playback events.** Through admitted
   runtime presentation timeline.
2. **`lipsync_frame_batch`.** Runtime emits frame batches with
   typed timing.
3. **Avatar consumes.** Through SDK queue, frames arrive at
   Avatar.
4. **Avatar bridges into Live2D.** Frames drive Live2D
   `ParamMouthOpenY` parameter.
5. **Visible result.** Lip movement synchronized to audio
   playback.

Lipsync is an admitted bridge; it is one of the more
elaborate cross-domain choreography paths in the platform.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Event taxonomy | Avatar event contract |
| Event emission | Avatar projection layer |
| Event consumption | NAS handlers, Avatar app components, other apps |
| Cross-instance coordination | `avatar_instance_registry` |
| Lipsync bridge | Runtime presentation stream + SDK queue + Avatar `ParamMouthOpenY` |

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/model-catalog.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/model-catalog.authority.yaml)
