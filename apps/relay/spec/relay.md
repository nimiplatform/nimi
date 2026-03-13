# Relay Spec

> Scope: Nimi Relay — Electron demo app for node-grpc transport validation and multi-app interop
> Normative Imports: spec/sdk/kernel/transport-contract.md, spec/runtime/kernel/rpc-surface.md

## 0. Authoritative Imports

- S-TRANSPORT-001 ~ 013 (SDK transport rules)
- K-SCENARIO-* (AI scenario execution)
- K-STREAM-* (streaming behavior)
- K-AUTHSVC-010 (RegisterApp)

## 1. Document Positioning

Relay is the Electron counterpart to Desktop (Tauri).
Desktop validates tauri-ipc transport; Relay validates node-grpc transport.
Both share SDK, Runtime, and Realm layers — differences are transport + IPC bridge only.

Relay's defining characteristic: **the selected agent is the interaction core**.
Every surface — chat, voice, video, Live2D — is scoped to the currently bound agent.
This is not a collection of isolated demos; it is a single agent interaction experience.

## 2. Reading Path

| Change Area | Start | Fact Source |
|-------------|-------|------------|
| Agent core invariant | kernel/agent-core-contract.md | — |
| IPC bridge | kernel/ipc-bridge-contract.md | tables/ipc-channels.yaml |
| Bootstrap sequence | kernel/bootstrap-contract.md | tables/bootstrap-phases.yaml |
| Feature modules | kernel/feature-contract.md | tables/feature-capabilities.yaml |
| Transport validation | kernel/transport-validation.md | spec/sdk/kernel/transport-contract.md |
| Multi-app interop | kernel/interop-contract.md | — |

## 3. Module Map

| Module | Implementation Path |
|--------|-------------------|
| Main process entry | apps/relay/src/main/index.ts |
| Platform client | apps/relay/src/main/platform-client.ts |
| IPC handlers | apps/relay/src/main/ipc-handlers.ts |
| Stream manager | apps/relay/src/main/stream-manager.ts |
| Socket.io relay | apps/relay/src/main/realtime-relay.ts |
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
