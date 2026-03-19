# Relay Spec

> Scope: Nimi Relay — Electron AI chat client with beat-first turn pipeline
> Normative Imports: spec/sdk/kernel/transport-contract.md, spec/runtime/kernel/rpc-surface.md

## 0. Authoritative Imports

- S-TRANSPORT-001 ~ 013 (SDK transport rules)
- K-SCENARIO-* (AI scenario execution)
- K-STREAM-* (streaming behavior)
- K-AUTHSVC-010 (RegisterApp)

## 1. Document Positioning

Relay is the Nimi Electron AI chat client, the Electron counterpart to Desktop (Tauri).
Both share SDK, Runtime, and Realm layers — differences are transport + IPC bridge only.
Relay uses node-grpc transport; Desktop uses tauri-ipc transport.

Relay's defining characteristic: **the selected agent is the interaction core**.
Every surface — chat, voice, video, Live2D — is scoped to the currently bound agent.

Relay implements the full beat-first turn pipeline (RL-PIPE-*) adapted from the local-chat mod,
with business logic in the Electron main process and structured beat delivery to the renderer via IPC.

## 2. Reading Path

| Change Area | Start | Fact Source |
|-------------|-------|------------|
| Agent core invariant | kernel/agent-core-contract.md | — |
| IPC bridge | kernel/ipc-bridge-contract.md | tables/ipc-channels.yaml |
| Bootstrap sequence | kernel/bootstrap-contract.md | tables/bootstrap-phases.yaml |
| Feature modules | kernel/feature-contract.md | tables/feature-capabilities.yaml |
| Turn pipeline | kernel/pipeline-contract.md | — |
| Transport validation | kernel/transport-validation.md | spec/sdk/kernel/transport-contract.md |
| Multi-app interop | kernel/interop-contract.md | — |

## 3. Module Map

| Module | Implementation Path |
|--------|-------------------|
| Main process entry | apps/relay/src/main/index.ts |
| SDK bootstrap | apps/relay/src/main/index.ts |
| IPC handlers | apps/relay/src/main/ipc-handlers.ts |
| Stream manager | apps/relay/src/main/stream-manager.ts |
| Socket.io relay | apps/relay/src/main/realtime-relay.ts |
| Chat pipeline | apps/relay/src/main/chat-pipeline/ |
| Prompt compiler | apps/relay/src/main/prompt/ |
| Session store | apps/relay/src/main/session-store/ |
| Media pipeline | apps/relay/src/main/media/ |
| Proactive heartbeat | apps/relay/src/main/proactive/ |
| Settings store | apps/relay/src/main/settings/ |
| Data queries | apps/relay/src/main/data/ |
| Preload | apps/relay/src/preload/index.ts |
| Electron bridge | apps/relay/src/renderer/bridge/electron-bridge.ts |
| Chat feature | apps/relay/src/renderer/features/chat/ |
| Voice feature | apps/relay/src/renderer/features/voice/ |
| Live2D feature | apps/relay/src/renderer/features/buddy/ |
| Video feature | apps/relay/src/renderer/features/video/ |
| Agent feature | apps/relay/src/renderer/features/agent/ |

## 4. Non-Goals

- No mod system (Relay calls SDK directly, does not host mods)
- No local AI model management (depends on external runtime daemon)
- No offline mode
- No external agent gateway
