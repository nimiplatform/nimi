# Relay Rule Evidence

> Auto-generated from `tables/rule-evidence.yaml` — do not edit manually
| Rule | Contract | Status | Evidence Path | Test | Notes |
|------|----------|--------|--------------|------|-------|
| RL-BOOT-001 | bootstrap-contract.md | verified | `src/main/index.ts` | `test/bootstrap.test.ts` | 5-step initialization sequence — env parse, Runtime+Realm init, socket.io, IPC handlers, BrowserWindow |
| RL-BOOT-002 | bootstrap-contract.md | verified | `src/renderer/infra/bootstrap.ts` | `test/bootstrap.test.ts` | Health check with 15s timeout, realtime status listener, agent profile fetch from Realm (RL-CORE-003) |
| RL-BOOT-003 | bootstrap-contract.md | verified | `src/main/env.ts` | `test/bootstrap.test.ts` | All 5 env vars parsed with required/optional validation — direct import unit tests |
| RL-BOOT-004 | bootstrap-contract.md | verified | `src/renderer/features/chat/chat-page.tsx` | `test/bootstrap.test.ts` | RuntimeUnavailable component with retry button, stub fallback, feature gating. Health handler throws on error (BUG-1 fix) ensuring runtimeAvailable correctly reflects degradation |
| RL-IPC-001 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | Dynamic source extraction verifies all channels use relay: prefix and match ipc-channels.yaml |
| RL-IPC-002 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | All unary handlers via ipcMain.handle, error shape via normalizeIpcError |
| RL-IPC-003 | ipc-bridge-contract.md | verified | `src/main/stream-manager.ts` | `test/stream-manager.test.ts` | Generic 3-phase stream protocol — open/chunk/end/error/cancel with unit tests |
| RL-IPC-004 | ipc-bridge-contract.md | verified | `src/preload/index.ts` | `test/preload.test.ts` | contextBridge with listener ID pattern, never exposes raw ipcRenderer — verified by source analysis |
| RL-IPC-005 | ipc-bridge-contract.md | verified | `src/preload/index.ts` | `test/ipc-handlers.test.ts` | Structured-clone compatible error normalization + Uint8Array→base64 round-trip test |
| RL-IPC-006 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | relay:ai:generate, relay:ai:stream:open, relay:ai:stream:cancel — SDK method verification |
| RL-IPC-007 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | TTS, STT, image, video generate + job management — all media channels verified |
| RL-IPC-008 | ipc-bridge-contract.md | verified | `src/main/ipc-handlers.ts` | `test/ipc-handlers.test.ts` | explicit typed Realm bridge only: relay:agent:list, relay:agent:get |
| RL-IPC-009 | ipc-bridge-contract.md | verified | `src/main/realtime-relay.ts` | `test/ipc-handlers.test.ts` | message/presence/status forwarding + subscribe/unsubscribe + websocket transport |
| RL-TRANS-001 | transport-validation.md | partial | `src/main/index.ts` | `test/transport-smoke.test.ts` | Test written — requires live runtime daemon to verify |
| RL-TRANS-002 | transport-validation.md | partial | `src/main/stream-manager.ts` | `test/transport-smoke.test.ts` | Test written — requires live runtime daemon to verify |
| RL-TRANS-003 | transport-validation.md | partial | `src/main/index.ts` | `test/transport-smoke.test.ts` | Token provider function + counting provider test — requires live runtime to verify |
| RL-TRANS-004 | transport-validation.md | partial | `src/main/index.ts` | `test/transport-smoke.test.ts` | runtimeVersion + versionCompatibility tests — requires live runtime to verify |
| RL-TRANS-005 | transport-validation.md | partial | `src/main/ipc-handlers.ts` | `test/transport-smoke.test.ts` | NimiError field assertions (reasonCode, actionHint) — requires live runtime to verify |
| RL-INTOP-001 | interop-contract.md | partial | `src/main/realtime-relay.ts` | `test/interop-smoke.test.ts` | Interop smoke test created — requires Realm instance + 2 socket connections to verify |
| RL-INTOP-002 | interop-contract.md | verified | `src/main/index.ts` | — | appId set to 'nimi.relay', appMode FULL — constant assertion |
| RL-INTOP-003 | interop-contract.md | partial | `src/main/realtime-relay.ts` | `test/interop-smoke.test.ts` | Socket.io connection + event forwarding — interop smoke test requires live Realm |
| RL-CORE-001 | agent-core-contract.md | verified | `src/renderer/app-shell/providers/app-store.ts` | `test/agent-core.test.ts` | All surfaces gated on currentAgent — zustand store unit tests |
| RL-CORE-002 | agent-core-contract.md | verified | `src/renderer/app-shell/providers/app-store.ts` | `test/agent-core.test.ts` | Agent change resets chat, cancels TTS/video streams, unloads Live2D, resubscribes realtime |
| RL-CORE-003 | agent-core-contract.md | verified | `src/renderer/infra/bootstrap.ts` | `test/agent-core.test.ts` | Fetches full agent profile from Realm when NIMI_AGENT_ID set, falls back to stub |
| RL-CORE-004 | agent-core-contract.md | verified | `src/main/ipc-handlers.ts` | `test/agent-core.test.ts` | agentId in every agent-scoped IPC input payload — requireAgentId guard enforced at IPC layer for ai:generate, ai:stream:open, media:tts:synthesize, media:video:generate |
| RL-FEAT-001 | feature-contract.md | verified | `src/renderer/features/chat/hooks/use-agent-chat.ts` | `test/features/agent-chat.test.ts` | AI chat with streaming, cancel, voice integration — contract compliance verified |
| RL-FEAT-002 | feature-contract.md | verified | `src/main/realtime-relay.ts` | `test/ipc-handlers.test.ts` | Realtime presence/message subscription plumbing stays in the main-process socket relay |
| RL-FEAT-003 | feature-contract.md | verified | `src/renderer/features/voice/hooks/use-speech-playback.ts` | `test/features/tts.test.ts` | TTS synthesis + Web Audio playback + lip sync + listVoices hook + voice selector UI. synthesize accepts optional voiceId override from voice selector (BUG-3 fix) |
| RL-FEAT-004 | feature-contract.md | verified | `src/renderer/features/voice/hooks/use-speech-transcribe.ts` | `test/features/stt.test.ts` | Agent-independent STT via MediaRecorder, base64 audio, transcript feeds agent chat |
| RL-FEAT-005 | feature-contract.md | verified | `src/renderer/features/buddy/live2d/model-manager.ts` | `test/features/live2d.test.ts` | PIXI.Application + Live2DModel.from() + animation controller with blink/breath/saccade/lip-sync plugins. Lip sync wired via zustand bridge from TTS audio analyser. Tap interaction on canvas. |
| RL-FEAT-006 | feature-contract.md | verified | `src/renderer/features/video/hooks/use-video-generate.ts` | `test/features/video.test.ts` | Video tab — prompt input, generate, status display, VideoPlayer. Async job subscription via stream protocol. Agent change cancels in-flight jobs. |
| RL-FEAT-007 | feature-contract.md | verified | `src/renderer/features/agent/hooks/use-agent-profile.ts` | `test/features/agent-profile.test.ts` | Realm fetch agent list with full field mapping (voice_model, voice_id, live2d_model_url — BUG-2 fix), agent card UI, switch agent resets all sessions — zustand tests |
