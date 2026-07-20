# Kit Renderer Shell

`kit/shell/renderer` is shared renderer-side shell glue for Nimi apps. It
publishes:

- `@nimiplatform/kit/shell/renderer/bridge`
- `@nimiplatform/kit/shell/renderer/bootstrap`
- `@nimiplatform/kit/shell/renderer/host`

The module is host-neutral. Renderer code calls injected bridge hooks and SDK
transports; it must not import Electron main/preload code, Tauri Rust host
code, app stores, navigation, or product UI.

## Boundary

- Bridge helpers normalize command invocation, Runtime defaults, auth session
  storage, daemon status projections, OAuth helpers, and small shell UI
  commands.
- Bootstrap helpers coordinate renderer entry loading, auth session bootstrap,
  Runtime readiness checks, and non-critical startup steps.
- Host helpers define `nimi.renderer.host/v1`: a provider-scoped facade with
  opaque identity, explicit renderer/overlay theme targets, typed overlay
  leases, localization, surface lifecycle, and standard-shell error mapping.
  Missing providers or targets fail closed; there is no global host fallback.
- Host-specific implementation remains in `kit/shell/tauri` or
  `kit/shell/electron`.
