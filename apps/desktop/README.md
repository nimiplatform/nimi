# Nimi Desktop (V1 Runtime Core)

This package is the desktop runtime core for Nimi V1:

- Unified communication entry (`cloud` channel)
- Local-agent runtime (`local` channel)
- Play protocol client (`Story` + `Scene Turn`)
- PromptTrace/Audit replay API integration
- Electron Desktop host

## Run (CLI)

```bash
pnpm --filter @nimiplatform/desktop dev:cli
```

## Run (Desktop)

```bash
pnpm --filter @nimiplatform/desktop dev
```

Renderer tech stack:

- TypeScript + Vite, supervised by the Electron main process in development
- `pnpm --filter @nimiplatform/desktop typecheck`

Mock fixture quick-start (after `pnpm reset`):

```bash
export NIMI_REALM_URL=http://localhost:3002
export NIMI_WORLD_ID=01JKFANREN00000000000001

# LOCAL route (resolved by runtime-owned local model status)
export NIMI_AGENT_ID=01JKDESKTOPAGENTPRIVATE000001

# CLOUD route (public agent)
# export NIMI_AGENT_ID=01JKDESKTOPAGENTPUBLIC000001

# ROUTE_DENIED case (private agent owned by others)
# export NIMI_AGENT_ID=01JKDESKTOPAGENTDENIED000001
```

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

Provider and model selection:

- Local text readiness and sendability are resolved from the runtime authoritative local model list/status.
- Host-side local snapshots are display-only; endpoint reachability alone is not route truth.
- Managed cloud credentials and model selection use Runtime connector routing via Runtime Config and SDK route projection, not `runtime_defaults` env fields.

## Scope

V1 runtime core keeps cloud chat on human DIRECT endpoints and desktop agent chat execution on desktop:

- `GET /api/human/chats`
- `POST /api/human/chats/:chatId/messages`
- `GET /api/human/chats/:chatId/sync`
- desktop agent chat execution via desktop runtime (cloud agent chat namespace removed)

## Desktop Features

The Electron Desktop host includes:

- Route badge + route reason panel (CLOUD/LOCAL deterministic result)
- Agent chat 会话列表、会话切换与会话删除
- Agent chat 回合诊断（promptTrace / turnAudit）
- LOCAL route readiness reflects runtime-owned local model records and status.
- Local runtime health display consumes runtime local model status; it must not infer ready from endpoint reachability alone.
- Renderer local state persistence (connection/session/turn/replay panel) with auto-restore on restart
- API client retry/backoff for transient network failures and retryable HTTP statuses
- Status rail feedback for retry lifecycle: `retrying` / `retry_exhausted` / `recovered`

## macOS packaging

```bash
pnpm --filter @nimiplatform/desktop build:macos:electron:layout
pnpm --filter @nimiplatform/desktop build:macos:electron:dev-candidate
```

The layout target validates packaging without signing or installation. The
local-development candidate uses fixed ad-hoc signing with hardened Runtime and
requires no Keychain signing identity. This development-only path is separate
from production signing and notarization. Production release remains unavailable
until the native production service installation path is implemented and can be
exercised as a real install.

On macOS, `pnpm dev:desktop` rebuilds the Electron host and launches the
workspace Electron application for ordinary UI, main, preload, and loopback CDP
iteration. This host does not gain protected Runtime access: the native carrier
loader remains fail-closed with `protected-carrier-required`. A protected
Runtime journey still requires building and installing the fixed ad-hoc
development candidate.

After `pnpm dev:runtime -- --install` reports a healthy service, launch the
workspace renderer with the installed protected Desktop carrier using:

```bash
pnpm dev:macos:desktop:installed
```

This is a direct development launcher, not an acceptance harness. It stops the
renderer when the installed `Nimi Dev.app` exits.

The privileged installer rolls back ordinary reported failures. An abrupt
termination can still leave a partial local machine namespace; that state is
handled by inspecting and removing the exact administrator-owned development
paths once, then performing a fresh install. It is intentionally not a product
migration or automatic repair path.
