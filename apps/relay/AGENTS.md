# Relay AGENTS

> Nimi Relay — Electron AI chat client with beat-first turn pipeline

## Authoritative Spec

All implementation must trace to `apps/relay/spec/kernel/*.md` rule contracts.
Rule ID namespace: `RL-*` (RL-BOOT, RL-IPC, RL-TRANS, RL-INTOP, RL-CORE, RL-FEAT, RL-PIPE).

## Architecture

- **Main process** (Node.js): Runtime (node-grpc) + Realm (openapi-fetch) + socket.io + chat pipeline
- **Preload**: contextBridge security boundary — never expose raw ipcRenderer
- **Renderer** (Vite + React 19): features consume `window.nimiRelay` bridge API

### Chat Pipeline (Main Process)

Business logic lives entirely in the main process (RL-PIPE-*):

- `chat-pipeline/` — Turn send flow, first-beat reactor, turn composer, perception, context assembly
- `prompt/` — Layered prompt compiler with lane budgets
- `session-store/` — Conversation ledger persisted to Electron userData via `RelayChatStorage`
- `media/` — Media decision policy, planner, execution pipeline, NSFW guardrail
- `model/` — Model, local runtime, and connector IPC handlers (SDK passthrough)
- `proactive/` — Heartbeat engine, policy, scheduler
- `settings/` — Product settings persistence
- `data/` — Realm API queries (replaces mod data.query capabilities)

The renderer is a thin consumer: it receives structured beat messages via IPC and renders them.

## Editing Rules

- IPC channel names use `relay:` prefix (RL-IPC-001)
- All agent-scoped IPC inputs carry `agentId` (RL-CORE-004)
- Stream protocol is generic — shared by AI stream and video job subscribe (RL-IPC-003)
- Binary data crosses IPC as base64 strings (RL-IPC-005)
- Chat pipeline logic must NOT import from renderer or preload
- Session store must use `RelayChatStorage` interface, not raw fs calls

## Hard Boundaries

- AI calls in chat pipeline use `RelayAiClient` (wraps Runtime SDK). Raw IPC handlers (`relay:ai:*`) still use low-level SDK API via `input-transform.ts` for backward compatibility.
- Preload event listeners return string IDs (not cleanup functions) due to `contextBridge` serialization constraints. Use `removeListener(id)` to unregister.
- Main + preload output as CJS (`.cjs`) via tsup. Renderer built by Vite.

## Verification Commands

- TypeScript: `pnpm --filter @nimiplatform/relay typecheck`
- Build: `pnpm --filter @nimiplatform/relay build`
- Transport tests (requires runtime daemon): `pnpm --filter @nimiplatform/relay test`
- Dev launch: `NIMI_REALM_URL=... NIMI_ACCESS_TOKEN=... pnpm --filter @nimiplatform/relay dev`

## Non-Goals

- No mod system (direct SDK calls)
- No offline mode
