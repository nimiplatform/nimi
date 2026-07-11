# Kit Electron Shell

`kit/shell/electron` is the shared Electron main/preload host glue for Nimi
apps. It is consumed from Electron host code through:

- `@nimiplatform/kit/shell/electron/main`
- `@nimiplatform/kit/shell/electron/preload`

Renderer application code must not import this module. Renderer code consumes
host-neutral bridge APIs from `@nimiplatform/kit/shell/renderer/*` and SDK
Runtime access through the explicit `electron-ipc` transport.

## Boundary

- Main process code owns app-scoped IPC command registration, origin
  allowlisting, Runtime gRPC proxying, stream forwarding, and artifact URL
  serving.
- Preload code exposes only a narrowed Nimi bridge API. It must not expose raw
  `ipcRenderer`, `electron`, Node.js modules, arbitrary channel senders, or
  unrestricted event listeners.
- Electron never owns Runtime lifecycle or configuration. It consumes the
  shared native protected-local carrier for exact typed fixed-service
  `status/start/restart` and protected calls. Stop, external-daemon fallback,
  executable/service/path selection, generic config JSON, bearer injection and
  renderer-visible protected material are forbidden.
- Installed-app protected child carrier/session behavior is absent pending A.1;
  launch metadata and generic gRPC proxying must fail closed for protected
  methods.
