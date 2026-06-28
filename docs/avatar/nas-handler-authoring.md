# NAS Handler Authoring

> Status: Running today. NimiAgentScript (NAS) 1.0 is the shipped
> handler convention; auto-discovery and hot reload are live.

NimiAgentScript (NAS) is **convention over configuration**: an
embodiment package author drops JS files into a fixed directory layout
and the Avatar runtime auto-discovers them. There is no manifest. The
file path is the registration.

## Directory Layout

```
<model>/runtime/nimi/
├── activity/      # one file per activity id
├── event/         # one file per event name
├── continuous/    # ambient handlers
└── lib/           # shared code
```

| Kind | Path | Fires when |
| --- | --- | --- |
| Activity | `<model>/runtime/nimi/activity/<id>.js` | A typed activity is requested by runtime |
| Event | `<model>/runtime/nimi/event/<name>.js` | An admitted event happens (e.g., `avatar_user_click`) |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` | Continuously, while the admitted condition holds |
| Library | `<model>/runtime/nimi/lib/*.js` | Shared imports for the above |

File-name normalization rules apply. Activity ids and event names map
to file names (kebab/snake-case forms admitted in the agent script
reference).

## Handler Shape

Each handler `export default` an object with at least one entry point:

```js
export default {
  async run(ctx) {
    await ctx.motion.play('wave');
    await ctx.expression.set('smile');
    await ctx.wait.seconds(1);
    await ctx.expression.set('neutral');
  }
};
```

`ctx` is the projection-supplied API. Handlers consume it; they do not
import backend libraries directly. This is what keeps a handler
backend-agnostic.

## Available API Surface

| API | Purpose |
| --- | --- |
| `ctx.motion` | Trigger admitted motion sequences |
| `ctx.expression` | Set / clear expressions |
| `ctx.pose` | Set / clear poses |
| `ctx.lookat` | Drive gaze direction |
| `ctx.params` | Drive admitted parameters (backend-neutral first, backend-specific after type narrow) |
| `ctx.wait` | Await admitted timing primitives |
| `ctx.event` | Subscribe to in-handler events (limited) |

Anything not in the projection API surface is not callable. Worker-
backed capability-RPC is the sandbox boundary; handlers cannot escape
it.

## Backend Extension After Type Narrow

```js
export default {
  requires: ['live2d-extension'],
  async run(ctx) {
    if (ctx.backend.kind !== 'live2d') return;
    ctx.live2dExtension.setParameter('ParamMouthForm', 0.7);
  }
};
```

`requires` declares the capability dependency. On a non-Live2D backend
the handler is registered but skipped (or invokes the admitted
fallback). VRM handlers will declare `requires: ['vrm-extension']` the
same way once the VRM surface is exposed.

## Reader Scenario: Author a `wave` Activity

1. **Create file.** `mychar/runtime/nimi/activity/wave.js`.
2. **Export default with `run(ctx)`.** Use `ctx.motion`, `ctx.expression`,
   `ctx.wait`.
3. **Save.** Tauri notify watcher detects the change; runtime
   re-registers the handler. No restart.
4. **Trigger.** When runtime emits `runtime.agent.activity.wave` for
   the agent driving this embodiment, the handler runs.

The author wrote a JS file at a path. The platform did the rest.

## Reader Scenario: React to a Hit Region Click

1. **Declare hit region.** Per the embodiment package, the `head`
   region is declared with alpha-mask boundary in the package
   manifest.
2. **Author event handler.** `mychar/runtime/nimi/event/onClickHead.js`.
3. **User clicks the head.** Hit region detection fires
   `avatar.user.click` with the region info. The convention path
   binds the handler to that event.
4. **Handler runs.** Triggers shy expression, plays a small sound
   effect, returns to neutral.

No subscription call. The path is the subscription.

## Reader Scenario: Continuous Breathing

1. **Author handler.** `mychar/runtime/nimi/continuous/breathe.js`.
2. **Auto-registered as continuous.** Runtime invokes per admitted
   timing primitive (frame tick or interval, per the contract).
3. **Layer with activities.** A `wave` activity composes over
   breathing without disabling it; both run.

Continuous handlers are how subtle ambient behaviors layer without
each clobbering the others.

## Hot Reload During Development

| Tool | Behavior |
| --- | --- |
| Tauri notify watcher | Detects FS changes under `<model>/runtime/nimi/**` |
| Auto re-registration | New / updated handlers picked up without restart |
| Removal | Deleted file unregisters its handler |
| Errors | Typed reload errors surface in dev console; the session keeps running |

A handler error at reload time does not crash Avatar. The previous
admitted handler stays active until the new file parses cleanly.

## What NAS Is Not

- **Not a declarative DSL.** No YAML, no schema validator, no CEL
  rule engine — JS handlers, full programmable surface.
- **Not an SDK API.** SDK is for app developers. NAS is for the
  embodiment package author's `<model>/runtime/nimi/`.
- **Not a place to hold semantic truth.** Handlers consume runtime
  semantic events. They do not invent agent state.
- **Not a backend escape hatch.** Backend-specific calls are guarded
  behind `requires` + type narrow.

## Source Basis

- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/backend-branch-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/backend-branch-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
