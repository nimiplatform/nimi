# Host-Agnostic Architecture

> Status: Running today. The host-agnostic projection layer is the
> shipped core of Avatar; backend branches plug into it.

Avatar is built around one architectural commitment: **agent semantics
do not belong to a renderer**. The agent's activity, expression, pose,
gaze, and speech are platform-owned facts; Live2D, VRM, and any future
backend are interchangeable execution branches behind a single
backend-agnostic projection layer.

The canonical teaching model is:

```
agent semantics  →  embodiment projection  →  backend-specific execution
```

- **Agent semantics** belong to runtime / SDK. The runtime owns
  activity ids, the presentation stream, emotion state, and the
  conversation anchor. Avatar never invents semantic truth.
- **Embodiment projection** is Avatar's host-agnostic API. It consumes
  the runtime bundle and event stream and translates them into
  backend-neutral cues: `activity`, `expression`, `pose`, `lookat`,
  `status_text`, `speak`, hit-region intent, and shell intent.
- **Backend execution** is whichever branch is mounted: Live2D today
  via Cubism SDK for Web; VRM via three-vrm tomorrow. Each backend
  implements the same `BackendBranch` interface.

## What the Projection Layer Owns

| Layer | What it owns | What it does NOT own |
| --- | --- | --- |
| Agent semantics (runtime / SDK) | activity, emotion, posture, status text, presentation stream, conversation anchor | per-frame backend calls |
| Embodiment projection (Avatar) | backend-neutral cue translation, shell-bounds intent, hit-region intent, NAS handler API surface | runtime semantic truth, backend pixels |
| Backend branch (Live2D / VRM / …) | model loading, parameter writes, draw loop, audio bridge, alpha mask | backend selection (closed union, kernel-admitted) |

The projection layer is the **only** place where semantics meet
rendering. NAS handlers stay above it; backend branches stay below it.

## Closed Backend Union

Backends are not pluggable strings. `BackendKind` is a closed
discriminated union: `'live2d' | 'vrm'`. New backends require a
contract amendment. This is why a NAS handler written today against
the projection API will keep working when the VRM surface is exposed —
handlers do not hard-code the backend.

Backend-specific extensions exist (e.g., `Live2DBackendExtension` for
parameter-id direct writes), but they are reachable only after type
narrowing. A handler that uses `live2dExtension` declares
`requires: ['live2d-extension']` and accepts that it will not run on
non-Live2D backends.

## Reader Scenario: Same Handler Runs on Both Backends

A package author writes a `wave` activity handler at
`<model>/runtime/nimi/activity/wave.js`. The handler calls projection
methods: motion, expression, wait, pose. No `live2dExtension`. No
backend literals.

1. **Today (Live2D mounted).** Projection translates motion/expression
   calls into Cubism API calls; the wave plays.
2. **Tomorrow (VRM mounted).** Projection translates the same calls
   into three-vrm API calls; the wave plays the VRM equivalent.
3. **Same handler, two backends.** No per-backend code in the
   embodiment package. The closed union is what makes this safe — the
   handler does not invent a third backend that projection cannot
   translate.

## Reader Scenario: Carrier Bounds Stay Backend-Agnostic

The Avatar window must size itself to whatever the active backend is
rendering: Live2D model alpha bbox today, VRM viewport tomorrow.

1. **Backend reports `BackendNominalBounds`.** Width, height, body
   center. Backend-defined; projection-consumed.
2. **App shell consumes via projection.** Window `set_size` happens
   through the projection-owned shell intent, not through a Live2D
   call.
3. **Companion surface composes.** Always-visible companion surface
   adds its footprint to the embodiment bounds; the shell resizes once
   per change.

The Avatar window does not know whether Live2D or VRM is mounted. It
just consumes projection.

## Reader Scenario: Cross-Surface Continuity

The same agent appears in Desktop chat and in the Avatar carrier. Both
must reflect the same emotion at the same time.

1. **Runtime emits `runtime.agent.state.emotion_changed`.** Authoritative.
2. **Projection translates.** Avatar consumes the event; projection
   emits an `avatar.expression.changed` event with the typed
   transition.
3. **Backend renders.** Live2D parameters update; carrier shows the
   new expression.
4. **Desktop chat surface also reflects.** Desktop's
   `.nimi/spec/canonical/desktop/agent-projection.authority.yaml` consumes the runtime event
   directly; both surfaces stay in sync because runtime is the single
   source.

The carrier and the chat surface never have to coordinate with each
other. They both consume runtime.

## Boundary Summary

| Concern | Owner | Surface |
| --- | --- | --- |
| activity / emotion / posture truth | runtime | `runtime.agent.*` events |
| persistent presentation profile | runtime | `agent-presentation-contract.md` |
| backend-neutral projection API | Avatar | `embodiment-projection-contract.md` |
| backend-specific execution | active backend branch | `backend-branch-contract.md` + per-backend contract |
| handler convention | Avatar (NAS) | `agent-script-contract.md` |
| desktop chat avatar transient surface | Desktop | `.nimi/spec/canonical/desktop/agent-projection.authority.yaml` |

## Source Basis

- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/canonical/desktop/agent-projection.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/desktop/agent-projection.authority.yaml)
