# Nimi Avatar

Nimi Avatar is a first-party Tauri app (`@nimiplatform/avatar`)
that puts an agent's character on the user's desktop as a
transparent, always-on-top floating window. It is **a separate
app from Desktop** — not a sub-surface — and the realization of
"your agent is alive on your desktop."

## What Nimi Avatar Is

| Property | Value |
| --- | --- |
| Package | `@nimiplatform/avatar` |
| Shell | Tauri app, separate from Desktop |
| Window shape | Transparent + chrome-less + always-on-top (default; user-toggleable) |
| Mouse-event passthrough | Outside the agent's body region, events pass through to underlying app |
| Position | Draggable; remembered across sessions |
| Click reactions | Programmable through NimiAgentScript handlers |
| Companion stack | Always visible: assistant message bubble + status row + composer |

It isn't a tray icon. It isn't a sidebar bubble. It is a present
visual being living on the user's screen.

## Embodiment Stage And Companion Surface

Avatar has two visible regions:

| Region | Purpose |
| --- | --- |
| Embodiment Stage | The main visible area where the agent's body renders (Live2D today) |
| Companion Surface | Always-visible stack: assistant-bubble + status-row + composer |

The companion surface is **always visible** — no trigger button,
no popup. It is docked next to the agent. Status row holds mic
toggle, mode label, speaker indicator, settings cog. Composer is
text input + send.

## Composition State Machine

| State | Meaning |
| --- | --- |
| `loading` | Initial bootstrap; no embodiment yet |
| `ready` | Stage and companion both mounted; agent is live |
| `degraded:*` | Typed degradation reason (asset missing, runtime unavailable, etc.) |
| `error:*` | Typed error reason |
| `relaunch-pending` | Awaiting Desktop launch update |
| `fixture:active` | Fixture mode (development) |

Hard mutual exclusion between `ready` and non-ready surfaces.
Either both are `ready` or a degraded surface takes over.

## NimiAgentScript (NAS)

NAS is the convention-based JS handler system for embodiment
package creators.

| Handler kind | Path |
| --- | --- |
| Activity | `<model>/runtime/nimi/activity/<name>.js` |
| Event | `<model>/runtime/nimi/event/<name>.js` |
| Continuous | `<model>/runtime/nimi/continuous/<name>.js` |
| Shared | `<model>/runtime/nimi/lib/` |

NAS handlers consume the embodiment projection API (backend-
agnostic) and drive the backend (Live2D-specific extensions
exposed when type-narrowed).

NAS handlers auto-register: runtime scans `<model>/runtime/nimi/`
and registers handlers; hot reload via Tauri notify watcher.

## Window Behavior Details

| Detail | Value |
| --- | --- |
| Decorations | None |
| Transparency | yes |
| Always-on-top | Default (user-toggleable) |
| Dynamic size | Follows model bounds + companion footprint |
| Startup position | Bottom-right with 24px padding |
| Subsequent positions | Remembered across sessions |
| Hit region | Alpha-mask + bbox dual-layer; pixel-level alpha sampling at 60Hz |
| Drag region | Only inside embodiment-stage; companion + degraded absorb pointer events |

These details add up to "the agent is on your screen, you can
interact with it where it is, you can drag it, the rest of your
screen still works."

## Settings Popover

Only 4 toggles. Intentionally minimal:

| Toggle | Default |
| --- | --- |
| `always_on_top` | on |
| `bubble_auto_open` | on |
| `bubble_auto_collapse` | on |
| `show_voice_captions` | (user choice) |

No transcript-heavy panel. No workstation-style configuration.
The Avatar app is an applet, not a workstation.

## Reader Scenario: Opening Avatar From Desktop

You have an agent in Desktop chat. You want to bring them onto
your screen.

1. **Desktop launches Avatar.** Sends only `agent_id` + optional
   `avatar_instance_id` + optional `launch_source`. **No
   tokens. No anchors. No package descriptors.**
2. **Avatar bootstraps.** Window create → renderer mount → emit
   `avatar.app.start` → register first-party app → resolve
   `agent_id` via Runtime account projection.
3. **Load visual package.** Embodiment package + NAS handlers.
4. **Compute hit region.** Alpha-mask + bbox.
5. **Mount stage + companion.** State moves `loading → ready`.
6. **Emit `avatar.app.ready`.** Agent is live.

Desktop is the launcher; Avatar is the carrier; Runtime is the
authority.

## Reader Scenario: Click Reactions Through NAS

The user clicks the agent's head; you want the agent to react.

1. **Click hits the embodiment stage.** Alpha-mask determines
   that the click was inside the agent's body.
2. **`avatar.user.click` event.** Emitted with hit region info.
3. **NAS event handler.** A handler at
   `<model>/runtime/nimi/event/onClickHead.js` is
   auto-registered for this region.
4. **Handler runs.** Triggers a shy reaction — runs an animation,
   plays a small sound, emits an emotion event.
5. **Embodiment projects.** The Live2D backend renders the
   reaction.

The author of the embodiment package wrote the handler at a
convention path. No registration ceremony.

## Reader Scenario: Runtime Unavailable

Runtime daemon stops while Avatar is running.

1. **Runtime detection.** Avatar detects the runtime is
   unreachable.
2. **State move.** Composition state moves
   `ready → degraded:runtime_unavailable`.
3. **Degraded surface takes over.** Stage + companion are both
   replaced by the degraded surface — typed reason visible to
   user.
4. **No silent fallback.** Avatar doesn't pretend to operate
   without runtime; it does not silently switch to mock fixture.
5. **User options.** Reload (after runtime returns) or close.

Recovery is **manual**: an explicit reload button only. No
auto-self-healing from degraded back to ready. This prevents
silently masking platform issues.

## What Avatar Does Not Do

| Concern | Why not |
| --- | --- |
| Persistent transcript | Long history lives in Desktop chat |
| Background voice / wake word | Voice is explicit user-triggered |
| Continuation across screen lock | Voice does not bridge across screen lock |
| Silent fallback to mock | Fail-closed on runtime unavailable |
| Auto-recovery from degraded | Manual reload only |

## Source Basis

- [`.nimi/spec/avatar/nimi-avatar.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/nimi-avatar.md)
- [`.nimi/spec/avatar/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/index.md)
- [`.nimi/spec/avatar/kernel/app-shell-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/app-shell-contract.md)
- [`.nimi/spec/avatar/kernel/embodiment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/embodiment-projection-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-contract.md)
- [`.nimi/spec/avatar/kernel/agent-script-reference.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/agent-script-reference.md)
- [`.nimi/spec/avatar/kernel/avatar-event-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/avatar-event-contract.md)
- [`.nimi/spec/avatar/kernel/live2d-render-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/live2d-render-contract.md)
- [`.nimi/spec/avatar/kernel/mock-fixture-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/mock-fixture-contract.md)
