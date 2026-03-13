# Relay Rule Evidence

> Auto-generated from `tables/rule-evidence.yaml` — do not edit manually

| Rule | Contract | Status | Evidence Path | Test | Notes |
|------|----------|--------|--------------|------|-------|
| RL-BOOT-001 | bootstrap-contract.md | verified | `src/main/index.ts` | `test/bootstrap.test.ts` | 5-step initialization sequence |
| RL-BOOT-002 | bootstrap-contract.md | verified | `src/renderer/infra/bootstrap.ts` | `test/bootstrap.test.ts` | Health check with 15s timeout |
| RL-BOOT-003 | bootstrap-contract.md | verified | `src/main/env.ts` | `test/bootstrap.test.ts` | All 5 env vars with required/optional validation |
| RL-BOOT-004 | bootstrap-contract.md | verified | `src/renderer/features/chat/chat-page.tsx` | `test/bootstrap.test.ts` | RuntimeUnavailable + stub fallback + feature gating |
| RL-IPC-001 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | Dynamic source extraction + YAML cross-check |
| RL-IPC-002 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | ipcMain.handle unary semantics |
| RL-IPC-003 | ipc-bridge-contract.md | verified | `src/main/stream-manager.ts` | `test/stream-manager.test.ts` | 3-phase stream protocol unit tests |
| RL-IPC-004 | ipc-bridge-contract.md | verified | `src/preload/index.ts` | `test/preload.test.ts` | contextBridge + listener ID pattern |
| RL-IPC-005 | ipc-bridge-contract.md | verified | `src/preload/index.ts` | `test/ipc-handlers.test.ts` | Error normalization + base64 round-trip |
| RL-IPC-006 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | AI channels + SDK method verification |
| RL-IPC-007 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | All media channels verified |
| RL-IPC-008 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | Realm passthrough + optional agentId |
| RL-IPC-009 | ipc-bridge-contract.md | verified | `src/main/realtime-relay.ts` | `test/ipc-handlers.test.ts` | Socket.io event forwarding |
| RL-TRANS-001 | transport-validation.md | partial | `src/main/platform-client.ts` | `test/transport-smoke.test.ts` | Requires live runtime |
| RL-TRANS-002 | transport-validation.md | partial | `src/main/stream-manager.ts` | `test/transport-smoke.test.ts` | Requires live runtime |
| RL-TRANS-003 | transport-validation.md | partial | `src/main/platform-client.ts` | `test/transport-smoke.test.ts` | Requires live runtime |
| RL-TRANS-004 | transport-validation.md | partial | `src/main/platform-client.ts` | `test/transport-smoke.test.ts` | Requires live runtime |
| RL-TRANS-005 | transport-validation.md | partial | `src/main/ipc-handlers.ts` | `test/transport-smoke.test.ts` | Requires live runtime |
| RL-INTOP-001 | interop-contract.md | partial | `src/renderer/features/chat/hooks/use-human-chat.ts` | `test/interop-smoke.test.ts` | Requires Realm + 2 sockets |
| RL-INTOP-002 | interop-contract.md | verified | `src/main/platform-client.ts` | — | Constant assertion |
| RL-INTOP-003 | interop-contract.md | partial | `src/main/realtime-relay.ts` | `test/interop-smoke.test.ts` | Requires live Realm |
| RL-CORE-001 | agent-core-contract.md | verified | `src/renderer/app-shell/providers/app-store.ts` | `test/agent-core.test.ts` | Zustand store unit tests |
| RL-CORE-002 | agent-core-contract.md | verified | `src/renderer/app-shell/providers/app-store.ts` | `test/agent-core.test.ts` | Agent change propagation |
| RL-CORE-003 | agent-core-contract.md | verified | `src/renderer/infra/bootstrap.ts` | `test/agent-core.test.ts` | Agent resolution + stub fallback |
| RL-CORE-004 | agent-core-contract.md | verified | `src/main/ipc-handlers.ts` | `test/agent-core.test.ts` | agentId in IPC payloads |
| RL-FEAT-001 | feature-contract.md | verified | `src/renderer/features/chat/hooks/use-agent-chat.ts` | `test/features/agent-chat.test.ts` | AI chat streaming + cancel |
| RL-FEAT-002 | feature-contract.md | verified | `src/renderer/features/chat/hooks/use-human-chat.ts` | `test/features/human-chat.test.ts` | Realm REST + socket.io |
| RL-FEAT-003 | feature-contract.md | verified | `src/renderer/features/voice/hooks/use-speech-playback.ts` | `test/features/tts.test.ts` | TTS + lip sync + voice list |
| RL-FEAT-004 | feature-contract.md | verified | `src/renderer/features/voice/hooks/use-speech-transcribe.ts` | `test/features/stt.test.ts` | Agent-independent STT |
| RL-FEAT-005 | feature-contract.md | verified | `src/renderer/features/buddy/live2d/model-manager.ts` | `test/features/live2d.test.ts` | Live2D + lip sync bridge |
| RL-FEAT-006 | feature-contract.md | verified | `src/renderer/features/video/hooks/use-video-generate.ts` | `test/features/video.test.ts` | Video generation + async jobs |
| RL-FEAT-007 | feature-contract.md | verified | `src/renderer/features/agent/hooks/use-agent-profile.ts` | `test/features/agent-profile.test.ts` | Agent list + selection |
