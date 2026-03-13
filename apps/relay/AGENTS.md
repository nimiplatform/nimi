# Relay AGENTS

> Nimi Relay — Electron demo app for node-grpc transport validation and multi-app interop

## Authoritative Spec

All implementation must trace to `apps/relay/spec/kernel/*.md` rule contracts.
Rule ID namespace: `RL-*` (RL-BOOT, RL-IPC, RL-TRANS, RL-INTOP, RL-CORE, RL-FEAT).

## Architecture

- **Main process** (Node.js): Runtime (node-grpc) + Realm (openapi-fetch) + socket.io
- **Preload**: contextBridge security boundary — never expose raw ipcRenderer
- **Renderer** (Vite + React 19): features consume `window.nimiRelay` bridge API

## Editing Rules

- IPC channel names use `relay:` prefix (RL-IPC-001)
- All agent-scoped IPC inputs carry `agentId` (RL-CORE-004)
- Stream protocol is generic — shared by AI stream and video job subscribe (RL-IPC-003)
- Binary data crosses IPC as base64 strings (RL-IPC-005)

## Hard Boundaries

- AI IPC handlers must use the low-level SDK API (`runtime.ai.text.generate()` / `runtime.ai.text.stream()`) as specified by RL-IPC-006, with input transformation handled by `input-transform.ts`.
- Preload event listeners return string IDs (not cleanup functions) due to `contextBridge` serialization constraints. Use `removeListener(id)` to unregister.
- Main + preload output as CJS (`.cjs`) via tsup. Renderer built by Vite.

## Verification Commands

- TypeScript: `pnpm --filter @nimiplatform/relay typecheck`
- Build: `pnpm --filter @nimiplatform/relay build`
- Transport tests (requires runtime daemon): `pnpm --filter @nimiplatform/relay test`
- Dev launch: `NIMI_REALM_URL=... NIMI_ACCESS_TOKEN=... pnpm --filter @nimiplatform/relay dev`

## Non-Goals

- No mod system (direct SDK calls)
- No local AI model management
- No offline mode
