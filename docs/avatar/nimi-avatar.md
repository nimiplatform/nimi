# Nimi Avatar Desktop Companion

Nimi Avatar is an Electron App launched under Desktop supervision. It presents the currently authorized Agent through Live2D or VRM in a separate transparent window and owns local activity, expressions, playback, and window interaction.

## Body Window and Companion

The character body determines the primary window footprint. Companion controls appear on demand when explicit interaction or active voice state requires them; they are not a permanently docked panel and do not enlarge the quiet body's default footprint.

Backend nominal bounds, valid geometry, and local scale govern the window layout. Hit regions and optional opacity queries are supplied directly by the selected backend. Mask update rate is distinct from draw rate; there is no universal 60Hz mask guarantee across backends.

## When Interaction is Available

Full product interaction requires a valid App session, an admitted model, a ready driver, and a completed backend presentation. Incomplete preparation displays a loading view, while failing any session, launch, or model prerequisite surfaces diagnostic reasons.

A development preview can display a model without establishing a live Runtime session or product readiness, but it cannot enable formal product interaction. See [Instance Lifecycle](/avatar/instance-lifecycle).

## Launch and Session Binding

A caller submits its current-session Agent handle through the formal Avatar Host port. Desktop and Runtime revalidate the target before Desktop launches or focuses the matching instance; switching away from another active Agent requires user confirmation.

Avatar verifies its own protected App session and uses the exact handed-off Conversation anchor to resolve a handle for that session. It does not reuse the caller's handle as its own operation selector. Its renderer launch context contains no account credentials or caller-authored model paths; the Host authorizes asset materialization.

## Activity, Expression, and Voice

The built-in adapter maps activity and emotion to validated backend capabilities. Clicks feed directly into local interaction physics rather than executing NAS JavaScript from a model directory. See [Model Capabilities](/avatar/model-capabilities) for model facts and name mapping.

Ordinary Conversation playback reads the final voice artifact, with Avatar owning local audio analysis and lipsync. Independently admitted Realtime media follows a separate processing path.

## Unavailability and Recovery

A failed Runtime binding, driver error, or missing presentation prerequisite halts product interaction and displays the corresponding reason. When the composition is not renderable, neither the model nor the Companion will mount. Triggering recovery only restores interaction after session and presentation prerequisites pass again.

Hiding the window stops local capture, playback, and visible interaction. Stopping an Avatar instance releases that local instance and its resources without deleting the Agent or Conversation. Runtime background work retains its own authorization and lifecycle.

## Source Basis

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`apps/avatar/src/shell/renderer/App.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/App.tsx)
- [`apps/avatar/src/shell/renderer/voice-companion-state.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/voice-companion-state.ts)
- [`apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/companion-surface/companion-surface.tsx)
- [`apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/app-shell/avatar-session-agent-binding.ts)
- [`apps/avatar/src/shell/renderer/sdk/SdkDriver.ts`](https://github.com/nimiplatform/nimi/blob/main/apps/avatar/src/shell/renderer/sdk/SdkDriver.ts)
