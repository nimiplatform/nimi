# Relay Bootstrap Contract

> Rule namespace: RL-BOOT-*
> Fact source: tables/bootstrap-phases.yaml

## RL-BOOT-001 — Main Process Initialization

Electron `app.whenReady()` triggers the main bootstrap sequence:

1. Parse environment variables (RL-BOOT-003)
2. Initialize Runtime via `node-grpc` transport (endpoint: `NIMI_RUNTIME_GRPC_ADDR`)
   - Auth: `accessToken` as provider function `() => Promise<string>`, not static string
   - Provider re-evaluates on each SDK call (supports token refresh)
3. Initialize Realm via `openapi-fetch` (baseUrl: `NIMI_REALM_URL`)
4. Establish socket.io connection to Realm realtime endpoint (RL-INTOP-003)
5. Register all IPC handlers (RL-IPC-001 ~ 009)
6. Create `BrowserWindow` and load renderer

The Runtime instance lives in the main process and communicates with the runtime daemon over gRPC.
The Realm instance lives in the main process and communicates with the realm API over HTTP.

## RL-BOOT-002 — Renderer Bootstrap

After the renderer loads, it executes a bootstrap sequence:

1. Call `relay:health` to verify runtime connectivity
2. Resolve initial agent (RL-CORE-003):
   - If `NIMI_AGENT_ID` is set, fetch that agent's profile
   - Else fetch agent list from Realm, present selection UI
3. Initialize React Query client and Zustand store with agent context
4. If runtime unavailable: mark degraded, do not block app shell
5. Timeout: 15 seconds — degrade gracefully on timeout

## RL-BOOT-003 — Environment Variable Resolution

Main process parses the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NIMI_RUNTIME_GRPC_ADDR` | No | `127.0.0.1:46371` | Runtime daemon gRPC endpoint (fallback: `~/.nimi/config.json` grpcAddr) |
| `NIMI_REALM_URL` | Yes | — | Realm API base URL |
| `NIMI_ACCESS_TOKEN` | Yes | — | Bearer token for auth |
| `NIMI_AGENT_ID` | No | — | Default agent binding (RL-CORE-003) |
| `NIMI_WORLD_ID` | No | — | Default world binding |

Reference: S-TRANSPORT-001 (node-grpc default endpoint)

## RL-BOOT-004 — Runtime Unavailable Degradation

When the runtime daemon is not running:

- Mark runtime as unavailable; do not block the app shell
- UI displays connection status with retry affordance
- Realm-dependent features (human chat, agent profile) operate independently of runtime
- Runtime-dependent features (AI chat, TTS, STT, video) show unavailable state
- Live2D operates independently (renderer-only, no runtime dependency)

Reference: D-BOOT-012 (realm fail-open, runtime fail-close pattern)
