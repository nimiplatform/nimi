# Relay IPC Bridge Contract

> Rule namespace: RL-IPC-*
> Fact source: tables/ipc-channels.yaml

## RL-IPC-001 — IPC Channel Naming Convention

All Electron IPC channels use the `relay:` prefix.

Categories:
- `relay:ai:*` — AI consume operations
- `relay:media:*` — Media operations (TTS, STT, image, video)
- `relay:realm:*` — Realm REST passthrough
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

## RL-IPC-008 — Realm Passthrough IPC

| Channel | Type | Description |
|---------|------|-------------|
| `relay:realm:request` | unary | REST request passthrough |

Parameters: `{ agentId?: string, method: string, path: string, body?: unknown, headers?: Record<string, string> }`

`agentId` is optional (RL-CORE-004): agent-scoped realm calls (e.g. channel listing for
an agent's world) pass it; agent-independent calls (e.g. user profile) omit it.

Realm SDK executes in the main process, bypassing renderer CORS restrictions.

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
