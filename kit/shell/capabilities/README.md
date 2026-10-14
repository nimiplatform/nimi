# Shell Capabilities

`kit/shell/capabilities` is the standard contract surface for Nimi shell hosts.
It owns capability ids, operation ids, standard command names, and the standard
error envelope consumed by Tauri, Electron, and renderer bridge code.

The machine authority for this module is
`config/platform-standard-shell-capabilities.yaml`.
Human guides, acceptance matrices, and gate descriptions may reference that
table, but they do not create a parallel source of truth.

## Chrome Contract

This entry exports the chrome contract: `NimiChromeBindRequest`, `NimiChromeState`,
`NimiChromeStateSetRequest`, `NimiChromeCommandRequest`, and `NimiChromeUnbindRequest`.
Its four operations use the existing standard bridge.

- **Generation fencing**: Every non-bind operation and command/state event carries the current Host-issued generation.
- **Catalogs and commands**: Locale selects a registered `en`/`zh` catalog; state updates carry only registered command IDs and booleans.
- **Security and isolation**: Renderer code cannot select a window, inject a role, label, URL, or script, or receive native handles or clipboard text. Native platform selection remains in Electron main.
- **State projection**: Chrome state projects independent UI behavior (menu placement, drag availability, geometry, supported native commands, and shortcut execution ownership). Consumers use each fact directly; the facade exposes no OS identifier or combined Host presentation mode.
- **Availability posture**: Declaring this contract does not establish a working Host implementation; unsupported or unbound Hosts return typed unavailable.
