[App introduction and usage](NIMI_APP.md)

# Nimi Desktop

Nimi Desktop is the Electron application hosting Nimi Home: the central workstation for chats, characters, worlds, settings, and Nimi Apps, as well as the process supervisor managing Nimi App hosts. AI model execution is powered by the Nimi Runtime, while account and ecosystem identity are managed by Realm.

## Development

### Prerequisites & Launch

From the repository root, launch Desktop directly — `pnpm dev:desktop` automatically starts or reuses the matching source Runtime (defaulting to the official Realm):

```bash
# Start Desktop (starts or reuses the source Runtime automatically)
pnpm dev:desktop

# Optional: run Runtime in its own terminal when debugging Go foreground logs directly
pnpm dev:runtime
```

Pass `-- --realm local` when developing against a local Realm instead of the default `official` Realm. If you start `pnpm dev:runtime` separately, use the same Realm selection in both terminals.

`pnpm dev:desktop` prepares the workspace SDK/Kit dependencies, builds the Electron main process, starts the renderer dev server on `127.0.0.1:1420`, and enables loopback CDP on port `9333` (customizable via `--cdp-port <port>`, or disable with `--no-cdp`).

Once launched, sign in through Nimi Home (which routes through your default browser) before launching supervised Nimi Apps. See [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md) for full development setup across Windows and macOS.

Connections & access opens `/account/runtime` on the official account site. When the admitted HTTPS manager is deployed separately from the login site, set `NIMI_RUNTIME_MANAGER_WEB_URL` to that manager's base URL; otherwise, it falls back to `NIMI_WEB_URL`. HTTP login-only deployments cannot be used as remote manager entries. Loopback URLs are labeled as local development previews and do not serve other devices. Configuring these URLs does not start a website, register a source, or grant access. Account security continues to use `NIMI_WEB_URL`.

### Recover a retired Nimi Chat v2 backup

Use a standalone SQLite backup. If the source has a journal or WAL, use SQLite's backup facility to capture the committed state into a separate file first. From the repository root, list the saved conversation IDs and titles with `pnpm --filter @nimiplatform/desktop exec tsx scripts/recover-chat-v2.ts --source /absolute/v2-backup.db --list`. Then choose one output:

```bash
pnpm --filter @nimiplatform/desktop exec tsx scripts/recover-chat-v2.ts --source /absolute/v2-backup.db --output /absolute/new-candidate.db
pnpm --filter @nimiplatform/desktop exec tsx scripts/recover-chat-v2.ts --source /absolute/v2-backup.db --thread-id THREAD_ID --output /absolute/selected.nimi-chat.json
```

The first command creates a separate v3 database containing the saved threads and message rows, including their IDs and parent relationships. The second creates a portable file for one completed text conversation; use **History → Open Home conversation** in Harness. The output must be new. Neither operation installs a database. Both report how many relevant drafts remain in the source backup: v2 stored no draft owner, so the new file contains none of those drafts. Keep the backup.

### Validation & Testing

Run workspace checks from the repository root:

```bash
# TypeScript type checking
pnpm --filter @nimiplatform/desktop typecheck

# Unit and integration test suite
pnpm --filter @nimiplatform/desktop test

# Complete quality verification suite
pnpm --filter @nimiplatform/desktop run test:quality
```

## Configuration

Desktop source development resolves its Realm profile through `app-tools/lib/development-environment.mjs` (reading defaults from the repository root `.env` file `nimi/.env`, with shell environment variables and CLI `--realm` taking precedence):

- **Default Realm (`official`)**: Defaults to the official Realm (`https://realm.nimi.ai` for API/realtime and `https://nimi.ai` for web, environment ID `production`). No `.env` override is required for normal source development.
- `NIMI_DEV_REALM`: Selects `official` (default) or `local` (overridden by `--realm official|local`).
- `NIMI_DEV_REALM_URL`, `NIMI_DEV_REALTIME_URL`, `NIMI_DEV_WEB_URL`, `NIMI_DEV_REALM_ENVIRONMENT_ID`: Optional overrides used only when `NIMI_DEV_REALM=local` (defaults: `http://127.0.0.1:3002`, `http://127.0.0.1:3003`, `http://localhost:3000`, `dev`). Origins must be exact HTTPS origins (HTTP is allowed only for `localhost` or `127.0.0.1`).
- Note: `.env` `NIMI_REALM_URL` (and `NIMI_WEB_URL`) are ignored for development Realm selection; the launcher populates `NIMI_REALM_URL`, `NIMI_REALTIME_URL`, and `NIMI_WEB_URL` from the resolved development Realm profile.

### AI Configuration Architecture

- **User Intent Storage:** Desktop records the user's high-level capability preferences (such as preferring Local vs. Cloud providers).
- **Execution Selection:** Runtime dynamically resolves and validates the concrete model and provider when an AI task executes.
- **Display Isolation:** Local hardware and model catalog information in the UI is display-only and decoupled from request-side routing decisions.

## macOS Packaging & Local Service

```bash
# Verify application packaging layout without codesigning
pnpm --filter @nimiplatform/desktop build:macos:electron:layout

# Build local development candidate with ad-hoc signing
pnpm --filter @nimiplatform/desktop build:macos:electron:dev-candidate
```

The layout target verifies package bundling structure. The local development candidate applies ad-hoc code signing with hardened runtime for developer testing without requiring a production Apple Developer Keychain certificate.

For system service integration testing:

```bash
# Initial local service installation
pnpm accept:runtime:fixed-service -- --install

# Rebuild and upgrade local service candidate
pnpm accept:runtime:fixed-service

# Launch Desktop linked to the installed local service
pnpm dev:macos:desktop:installed
```

- On macOS the fixed development Home and Runtime share the per-user control record `~/.nimi-dev/.nimi/nimi.json`. The production record stays at `~/.nimi/nimi.json`. On first use, select a separate development data folder.
- Use `--install` only for first-time installation. Subsequent updates use `pnpm accept:runtime:fixed-service` to replace the development service binary under platform privilege while preserving service credentials.
- Use `pnpm accept:runtime:fixed-service -- --uninstall` to cleanly remove local development service artifacts.
