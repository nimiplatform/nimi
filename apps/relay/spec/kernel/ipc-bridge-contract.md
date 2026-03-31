# Relay IPC Bridge Contract

> Rule namespace: RL-IPC-*
> Fact source: tables/ipc-channels.yaml

## RL-IPC-001 — IPC Channel Naming Convention

All Electron IPC channels use the `relay:` prefix.

Categories:
- `relay:ai:*` — AI consume operations
- `relay:media:*` — Media operations (TTS, STT, image, video)
- `relay:model:*` — Model service operations (list, pull, remove, health)
- `relay:local:*` — Local runtime management (models, device, services)
- `relay:connector:*` — Connector CRUD and catalog operations
- `relay:desktop:*` — Desktop interop (deep-link navigation)
- `relay:agent:*` — Agent directory/profile queries
- `relay:human-chat:*` — Agent-channel message mutations
- `relay:realtime:*` — Realtime event forwarding (socket.io → renderer)
- `relay:stream:*` — gRPC stream lifecycle events (main → renderer)
- `relay:health` — Health check

## RL-IPC-002 — Unary IPC Semantics

Unary calls use `ipcMain.handle` / `ipcRenderer.invoke`:

- Request: JSON-serializable input; agent-scoped calls include `agentId` (RL-CORE-004)
- Response: JSON-serializable output or NimiError structure
- Binary data (audio/image): base64-encoded strings
- Error shape: `{ reasonCode: string, message: string, actionHint?: string }`

## RL-IPC-003 — Stream IPC Protocol

Generic streaming protocol shared by all stream-open channels.
Mirrors S-TRANSPORT-003 and the Tauri IPC stream pattern.

**Phase 1 — Open:**
Renderer invokes a stream-open channel → returns `{ streamId: string }`

Stream-open channels that use this protocol:
- `relay:ai:stream:open` — AI text streaming (RL-IPC-006)
- `relay:media:video:job:subscribe` — video job event subscription (RL-IPC-007)

**Phase 2 — Data:**
Main process iterates the async stream and pushes chunks via `webContents.send`:
- `relay:stream:chunk` — `{ streamId, data }` per chunk
- `relay:stream:end` — `{ streamId }` on completion
- `relay:stream:error` — `{ streamId, error }` on failure

The `data` shape depends on the originating channel:
- AI stream: `{ text?: string, ... }` (text generation chunks)
- Video job subscribe: `ScenarioJobEvent` (job status transitions)

**Phase 3 — Cancel:**
Renderer invokes the corresponding cancel channel with `{ streamId }` to abort:
- `relay:ai:stream:cancel` — cancel AI stream
- `relay:media:video:job:cancel` — cancel video job subscription

Both cancel operations abort the underlying async iterator in main process.

Terminal frame projection follows S-TRANSPORT-007.

## RL-IPC-004 — Preload Security Boundary

`contextBridge.exposeInMainWorld('nimiRelay', api)`:

- Never expose raw `ipcRenderer` object
- Each method is individually wrapped with typed parameters
- Event listeners include cleanup functions for unbinding
- No functions, Symbols, or class instances cross the bridge

## RL-IPC-005 — IPC Serialization Constraints

All parameters and return values must be structured-clone-compatible:

| Source Type | Wire Type |
|-------------|-----------|
| `Uint8Array` (protobuf wire) | base64 string |
| `Error` | `{ reasonCode, message, actionHint }` |
| Functions | Forbidden |
| Symbols | Forbidden |
| Class instances | Forbidden |

## RL-IPC-006 — AI Consume IPC

| Channel | Type | SDK Method |
|---------|------|------------|
| `relay:ai:generate` | unary | `runtime.ai.text.generate` |
| `relay:ai:stream:open` | stream-open | `runtime.ai.text.stream` |
| `relay:ai:stream:cancel` | stream-cancel | — |

All AI calls carry `agentId` in the input payload (RL-CORE-004).

## RL-IPC-007 — Media IPC

| Channel | Type | SDK Method |
|---------|------|------------|
| `relay:media:tts:synthesize` | unary | `runtime.media.tts.synthesize` |
| `relay:media:tts:voices` | unary | `runtime.media.tts.listVoices` |
| `relay:media:stt:transcribe` | unary | `runtime.media.stt.transcribe` |
| `relay:media:image:generate` | unary | `runtime.media.image.generate` |
| `relay:media:video:generate` | unary | `runtime.media.video.generate` |
| `relay:media:video:job:subscribe` | stream-open | `runtime.media.jobs.subscribe` |
| `relay:media:video:job:get` | unary | `runtime.media.jobs.get` |
| `relay:media:video:job:artifacts` | unary | `runtime.media.jobs.getArtifacts` |
| `relay:media:video:job:cancel` | stream-cancel | — |

Video job management uses the shared `runtime.media.jobs` module.
`job:subscribe` follows the generic stream protocol (RL-IPC-003);
`job:cancel` aborts the subscription stream.

Image generation stays typed and fail-closed:
- Relay resolves the configured image route before dispatching `relay:media:image:generate`
- Local image routes call `runtime.media.image.generate` with `route: 'local'` and explicit workflow `extensions`
- Relay must not silently recover local image route failures by switching to a cloud connector

## RL-IPC-008 — Typed Realm Data IPC

Relay does not expose a generic Realm REST passthrough.
Renderer-only data access must cross IPC through explicit typed methods:

| Channel | Type | Description |
|---------|------|-------------|
| `relay:agent:list` | unary | List available agents for selection |
| `relay:agent:get` | unary | Fetch one agent profile |

Parameters:

- `relay:agent:list` → no payload
- `relay:agent:get` → `{ agentId: string }`

Main process remains the only place allowed to touch Realm SDK network primitives.

## RL-IPC-009 — Realtime Event Forwarding

Socket.io events received in main process are forwarded to renderer via IPC:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `relay:realtime:message` | main → renderer | New message in subscribed channel |
| `relay:realtime:presence` | main → renderer | User presence change |
| `relay:realtime:status` | main → renderer | Connection status change |

Renderer subscribes/unsubscribes via:
- `relay:realtime:subscribe` — join a channel
- `relay:realtime:unsubscribe` — leave a channel

## RL-IPC-010 — Model Service IPC

| Channel | Type | SDK Method |
|---------|------|------------|
| `relay:model:list` | unary | `runtime.model.list` |
| `relay:model:pull` | unary | `runtime.model.pull` |
| `relay:model:remove` | unary | `runtime.model.remove` |
| `relay:model:health` | unary | `runtime.model.checkHealth` |

Model service operations are not agent-scoped — no `agentId` required.
All calls are SDK passthrough with `normalizeError` wrapping.

## RL-IPC-011 — Local Runtime IPC

| Channel | Type | SDK Method |
|---------|------|------------|
| `relay:local:models:list` | unary | `runtime.local.listLocalModels` |
| `relay:local:artifacts:list` | unary | `runtime.local.listLocalArtifacts` |
| `relay:local:models:verified` | unary | `runtime.local.listVerifiedModels` |
| `relay:local:models:catalog-search` | unary | `runtime.local.searchCatalogModels` |
| `relay:local:models:install-plan` | unary | `runtime.local.resolveModelInstallPlan` |
| `relay:local:models:install` | unary | `runtime.local.installLocalModel` |
| `relay:local:models:install-verified` | unary | `runtime.local.installVerifiedModel` |
| `relay:local:models:import` | unary | `runtime.local.importLocalModel` |
| `relay:local:models:remove` | unary | `runtime.local.removeLocalModel` |
| `relay:local:models:start` | unary | `runtime.local.startLocalModel` |
| `relay:local:models:stop` | unary | `runtime.local.stopLocalModel` |
| `relay:local:models:health` | unary | `runtime.local.checkLocalModelHealth` |
| `relay:local:models:warm` | unary | `runtime.local.warmLocalModel` |
| `relay:local:device-profile` | unary | `runtime.local.collectDeviceProfile` |
| `relay:local:profile:resolve` | unary | `runtime.local.resolveProfile` |
| `relay:local:catalog:nodes` | unary | `runtime.local.listNodeCatalog` |

Local runtime operations are not agent-scoped.
`relay:local:artifacts:list` is read-only and exposes installed local artifacts for explicit local image workflow companion selection.

## RL-IPC-012 — Connector IPC

| Channel | Type | SDK Method |
|---------|------|------------|
| `relay:connector:create` | unary | `runtime.connector.createConnector` |
| `relay:connector:get` | unary | `runtime.connector.getConnector` |
| `relay:connector:list` | unary | `runtime.connector.listConnectors` |
| `relay:connector:update` | unary | `runtime.connector.updateConnector` |
| `relay:connector:delete` | unary | `runtime.connector.deleteConnector` |
| `relay:connector:test` | unary | `runtime.connector.testConnector` |
| `relay:connector:models` | unary | `runtime.connector.listConnectorModels` |
| `relay:connector:provider-catalog` | unary | `runtime.connector.listProviderCatalog` |
| `relay:connector:catalog-providers` | unary | `runtime.connector.listModelCatalogProviders` |
| `relay:connector:catalog-provider-models` | unary | `runtime.connector.listCatalogProviderModels` |
| `relay:connector:catalog-model-detail` | unary | `runtime.connector.getCatalogModelDetail` |
| `relay:connector:catalog-provider:upsert` | unary | `runtime.connector.upsertModelCatalogProvider` |
| `relay:connector:catalog-provider:delete` | unary | `runtime.connector.deleteModelCatalogProvider` |
| `relay:connector:catalog-overlay:upsert` | unary | `runtime.connector.upsertCatalogModelOverlay` |
| `relay:connector:catalog-overlay:delete` | unary | `runtime.connector.deleteCatalogModelOverlay` |

Connector operations are not agent-scoped.

## RL-IPC-013 — Desktop Interop IPC

| Channel | Type | Description |
|---------|------|-------------|
| `relay:desktop:open-config` | unary | Open Desktop runtime config via URL scheme |

Opens `nimi-desktop://runtime-config/{pageId}` using Electron `shell.openExternal`.
See RL-INTOP-004 for the deep-link contract.
