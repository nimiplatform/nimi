# Relay Interop Contract

> Rule namespace: RL-INTOP-*

## RL-INTOP-001 — Multi-App Chat Interop

Relay (Electron) and Desktop (Tauri) achieve human message interop through the Realm API:

- Both apps connect to the same Realm instance
- Relay sends a message → Desktop receives in real-time via socket.io
- Desktop sends a message → Relay receives in real-time via socket.io

**Critical path**: this requires socket.io connection in main process (RL-INTOP-003)
and event forwarding to renderer (RL-IPC-009). REST polling alone is insufficient.

**Validation method**: two-app smoke test — launch both Relay and Desktop against the same
Realm instance, send a message from each, verify receipt in the other within 5 seconds.

## RL-INTOP-002 — App Registration Isolation

Each app registers independently with the Runtime:

| App | appId | appMode |
|-----|-------|---------|
| Desktop | `nimi.desktop` | FULL |
| Relay | `nimi.relay` | FULL |

Reference: K-AUTHSVC-010 (RegisterApp)

Both apps maintain independent Runtime sessions while sharing the Realm message bus.

## RL-INTOP-003 — Socket.io Connection

Main process maintains a socket.io connection for real-time events:

- Connect to `NIMI_REALM_URL` realtime endpoint on bootstrap (RL-BOOT-001 step 4)
- Authenticate with `NIMI_ACCESS_TOKEN`
- Subscribe to channels relevant to the current agent context
- Events forwarded to renderer via IPC (RL-IPC-009)
- Disconnect/reconnect handled by socket.io-client built-in logic
- Connection status exposed to renderer via `relay:realtime:status`

This is the mechanism that makes RL-INTOP-001 work.
Without it, human chat is REST-only and interop is not real-time.
