# Relay Bootstrap Phases

> Auto-generated from `tables/bootstrap-phases.yaml` — do not edit manually
| Order | Phase | Process | Description | Blocking | Timeout | Rule |
|-------|-------|---------|-------------|----------|---------|------|
| 1 | MAIN_INIT | main | Electron app ready, parse env vars, init Runtime (node-grpc) + Realm | yes | — | RL-BOOT-001 |
| 2 | SOCKET_CONNECT | main | Establish socket.io connection to Realm realtime endpoint | no | — | RL-BOOT-001 |
| 3 | IPC_REGISTER | main | Register all ipcMain.handle handlers | yes | — | RL-BOOT-001 |
| 4 | WINDOW_CREATE | main | Create BrowserWindow, load renderer | yes | — | RL-BOOT-001 |
| 5 | RENDERER_HEALTH | renderer | Health check via relay:health | no | 15000ms | RL-BOOT-002 |
| 6 | RENDERER_AGENT_RESOLVE | renderer | Resolve initial agent (env var or Realm fetch + user selection) | yes | — | RL-BOOT-002 |
