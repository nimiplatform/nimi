# Nimi Desktop (V1 Runtime Core)

This package is the desktop runtime core for Nimi V1:

- Unified communication entry (`cloud` channel)
- Local-agent runtime (`local` channel)
- Play protocol client (`Story` + `Scene Turn`)
- PromptTrace/Audit replay API integration
- Desktop shell scaffold (Tauri)

## Run (CLI)

```bash
pnpm --filter @nimiplatform/desktop dev:cli
```

## Run (Desktop Shell)

```bash
pnpm --filter @nimiplatform/desktop dev:shell
```

Renderer tech stack:

- TypeScript + Vite (Tauri `devUrl` mode in development)
- `pnpm --filter @nimiplatform/desktop typecheck`

Mock fixture quick-start (after `pnpm reset`):

```bash
export NIMI_REALM_URL=http://localhost:3002
export NIMI_WORLD_ID=01JKFANREN00000000000001

# LOCAL route (owned by test-primary)
export NIMI_AGENT_ID=01JKDESKTOPAGENTPRIVATE000001

# CLOUD route (public agent)
# export NIMI_AGENT_ID=01JKDESKTOPAGENTPUBLIC000001

# ROUTE_DENIED case (private agent owned by others)
# export NIMI_AGENT_ID=01JKDESKTOPAGENTDENIED000001
```

Linux runtime prerequisites (for Tauri/WebKit runtime):

- `webkit2gtk` (distribution package name may vary)
- `libayatana-appindicator` (or equivalent tray deps where required)

Environment variables:

- `NIMI_REALM_URL` (default: `http://localhost:3002`)
- `NIMI_CONTROL_PLANE_URL` (default: `http://localhost`, runtime control-plane base URL)
- `NIMI_WEB_URL` (default: `http://localhost`, used for desktop browser-auth launch URL)
- `NIMI_ACCESS_TOKEN` (required)
- `NIMI_USER_CONFIRMED_UPLOAD` (`1` to allow LOCAL turn upload in play demo)
- `NIMI_TARGET_TYPE` (`AGENT` default, also supports `CONTACT` / `FRIEND`)
- `NIMI_TARGET_ACCOUNT_ID` (required for CONTACT/FRIEND route)
- `NIMI_AGENT_ID`
- `NIMI_WORLD_ID`
- `NIMI_USER_ID`
- `NIMI_SESSION_ID`
- `NIMI_REQUEST_ID`
- `NIMI_SESSION_ID`
- `NIMI_PROVIDER` (for LOCAL route)
- `NIMI_LOCAL_PROVIDER_ENDPOINT` (optional; leave empty when runtime has no local binding)
- `NIMI_LOCAL_PROVIDER_MODEL` (optional explicit local model binding)
- `NIMI_LOCAL_OPENAI_ENDPOINT` (optional OpenAI-compatible local binding)
- `NIMI_CONNECTOR_ID` (optional connector ID for managed credential routing)

Provider format examples:

- `local:localai:openai_compat_adapter:qwen2.5-7b-instruct` -> Local route with explicit adapter/model
- `local:nexa:openai_compat_adapter:qwen2.5-7b-instruct` -> Nexa namespace route
- `openai-compatible:gpt-4o-mini` -> generic OpenAI-compatible endpoint

## Scope

V1 runtime core keeps cloud chat on human DIRECT endpoints and local-chat execution on desktop:

- `GET /api/human/chats`
- `POST /api/human/chats/:chatId/messages`
- `GET /api/human/chats/:chatId/sync`
- local-chat execution via desktop runtime (cloud agent chat namespace removed)

## Shell Features

Tauri shell includes:

- Route badge + route reason panel (CLOUD/LOCAL deterministic result)
- Provider field hard-gated to LOCAL route only
- Local-chat 会话列表、会话切换与会话删除
- Local-chat 回合诊断（promptTrace / turnAudit）
- LOCAL 路由默认使用本地 Provider（由用户自配）
- Provider health check 按钮（LOCAL 路由）可验证本地 endpoint 可达性
- Renderer local state persistence (connection/session/turn/replay panel) with auto-restore on restart
- API client retry/backoff for transient network failures and retryable HTTP statuses
- Status rail feedback for retry lifecycle: `retrying` / `retry_exhausted` / `recovered`

## Notes

- Ensure Rust toolchain is installed (`rustup`, `cargo`).
- Shell command uses Tauri CLI:
  - `pnpm --filter @nimiplatform/desktop dev:shell`
