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
text generation with function tools and structured output, managed storage,
and the bounded canonical Agent configuration family:

```ts
import { registerNimiElectronAppBridge } from '@nimiplatform/kit/shell/electron/main';

const bridge = registerNimiElectronAppBridge({
  appId: 'nimi.example.local-app',
  allowedRendererUrls: [rendererUrl],
  ipcMain,
  assetMediaPlatform: { protocol, webRequest: session.defaultSession.webRequest, webContents },
});
```

The admitted Agent configuration carrier is the canonical `agent.configure`
family: bounded Manager snapshot, shared AIConfig, autonomy, presentation, and
Memory operations. It is identical for every equally covered protected App;
the Electron Host adds no first-party product path or raw identity sideband.
The same formal client carries the `agent.local` embodiment snapshot and
ordered event subscription: activity, emotion, semantic posture, and bounded
voice-timing correlation only. Renderer motion, lipsync, audio-clock, replay,
and backend diagnostics remain outside the standard shell.

Protected-session unavailability does not terminate the App, request a Host
reopen, or unregister the renderer bridge. Protected calls continue to return
bounded typed unavailable posture while Kit performs bounded same-Host session
rebind. App code receives no session material or authority selector.
After a maintenance failure, a successful session status read or same-Host
rebind resumes periodic renewal. Failed sessions are not retried by that timer,
and resuming maintenance does not replay interrupted business work.

App-owned Node modules use `bridge.services.ai`, `bridge.services.aiConfig`
and `bridge.services.storage`, which are SDK feature clients over this same
Host. Register fixed business commands through `appCommandHandlers` and use
`onSessionInvalidated` to abort application tasks and clear their account-scoped
memory. These handlers never occupy the reserved `nimi.shell.*` namespace.
Business requests carry their own cancellation signal into the SDK model
binding and check it before committing asynchronous work. Renderer disconnect
does not itself replay or cancel a business workflow; the App owns that policy.

This entrypoint has no Runtime endpoint, ordinary gRPC factory, native-host
injection or capability-set selection. Services become unavailable when the
bridge is unregistered, and old resource handles cannot cross a session rebind.

The public Windows native package targets the existing D2 Runtime. A
Desktop-launched installed App loads that binding from its own package;
workspace native-entry overrides remain limited to the default Electron
development host. Both use the current non-elevated Runtime peer checks,
Desktop parent supervision, and Runtime-owned registration/session/App Access.
This carrier does not enable Catalog or installed launch by itself, and does
not claim compatibility with the separately governed production Runtime service.

## Managed asset previews

Renderer code can call `openNimiLocalAppAssetMediaUrl(relativePath)` from
`@nimiplatform/kit/shell/renderer/bridge` to preview an App-managed asset.
The Electron host must register the asset media platform shown above. The
returned URL is scoped to that renderer and asset; call its `revoke()` method
when the preview is released. It streams byte ranges without assembling the
whole asset into a renderer Blob.

Supported media types are PNG, JPEG, WebP and GIF images; WAV (`audio/wav` or
`audio/x-wav`), MP3 (`audio/mpeg`) and Ogg Opus/Vorbis (`audio/ogg`); and MP4 (`video/mp4`) and WebM
(`video/webm`) video. The host checks both the stored media type and the actual
container signature. A supported container still needs codecs supported by the
running browser.

QuickTime/MOV (`video/quicktime`) is not accepted by this preview API. An App can
keep that original asset for its own media processing and use FFmpeg or another
deterministic media tool to create a compatible preview in managed storage.
Changing only the filename or media type does not convert a container. Preview
rejection with `invalid-payload` does not establish that the original input is
invalid for processing or that a Runtime AI capability is unavailable.

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
- The local-app entrypoint carries only catalogued protected operations under
  the Runtime-owned App session, including typed AI scenario/Job operations,
  owned artifact read/upload, managed storage, WorldCore, conversation, and Agent
  configuration. Artifact access and adoption retain their exact ownership and
  size/lifetime limits. Launch metadata, app-selected carrier authority,
  AI profile mutation, unscoped artifact access, and generic gRPC proxying fail closed.
