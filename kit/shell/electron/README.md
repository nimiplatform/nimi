# Kit Electron Shell

`kit/shell/electron` is the shared Electron main/preload host glue for Nimi
apps. It is consumed from Electron host code through:

- `@nimiplatform/kit/shell/electron/main`
- `@nimiplatform/kit/shell/electron/preload`

Renderer application code must not import this module. Renderer code consumes
host-neutral bridge APIs from `@nimiplatform/kit/shell/renderer/*` and SDK
Runtime access through the explicit `electron-ipc` transport.

Desktop-supervised local apps register the fixed catalogued Local App host from
their Electron main process. The admitted surface includes Runtime-selected
foreground text candidate generation and the bounded canonical Agent
configuration family:

```ts
import { registerNimiElectronAppBridge } from '@nimiplatform/kit/shell/electron/main';

registerNimiElectronAppBridge({
  appId: 'nimi.example.local-app',
  allowedRendererUrls: [rendererUrl],
  ipcMain,
});
```

The admitted Agent configuration carrier is the canonical `agent.configure`
family: bounded Manager snapshot, shared AIConfig, autonomy, presentation, and
Memory operations. It is identical for every equally covered protected App;
the Electron Host adds no first-party product path or raw identity sideband.

Protected-session unavailability does not terminate the App, request a Host
reopen, or unregister the renderer bridge. Protected calls continue to return
bounded typed unavailable posture while Kit performs bounded same-Host session
rebind. App code receives no session material or authority selector.

This entrypoint deliberately has no Runtime endpoint, ordinary gRPC factory,
native-host injection, capability-set selection, or command-handler input.

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
- The local-app entrypoint owns the narrowed protected carrier/session and
  admits only the catalogued App, storage, WorldCore, conversation, and Agent
  configuration operations. Launch metadata, app-selected carrier authority,
  AI profile mutation, Artifact access, and generic gRPC proxying fail closed.
