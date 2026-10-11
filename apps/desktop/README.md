# Nimi Desktop

Nimi Desktop is the Electron application hosting Nimi Home: the central workstation for chats, characters, worlds, settings, and Nimi Apps, as well as the supervisor managing supervised Nimi App host processes. AI model execution is powered by the Nimi Runtime, while account and ecosystem identity are managed by Realm.

## Development

### Prerequisites & Launch

From the repository root, start the local Runtime service in one terminal, then launch Desktop in another:

```bash
# Terminal 1: Start Runtime
pnpm dev:runtime

# Terminal 2: Start Desktop
pnpm dev:desktop
```

`pnpm dev:desktop` prepares the workspace SDK/Kit dependencies, builds the Electron main process, starts the renderer dev server on `127.0.0.1:1420`, and enables loopback CDP on port `9333` (customizable via `--cdp-port <port>`, or disable with `--no-cdp`).

Once launched, sign in through Nimi Home (which routes through your default browser) before launching supervised Nimi Apps. See [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md) for full development setup across Windows and macOS.

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

Desktop reads environment settings from the repository root `.env` file (`nimi/.env`):

- `NIMI_REALM_URL`: Source development accepts only `http://127.0.0.1:3002` or `http://localhost:3002`, with no extra path, query, credentials, or fragment. The launcher normalizes either value to `http://127.0.0.1:3002`; remote hosts and other ports are rejected.
- `NIMI_WEB_URL`: Optional web portal base URL used for account management and browser handoffs.

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

- Use `--install` only for first-time installation. Subsequent updates use `pnpm accept:runtime:fixed-service` to replace the development service binary under platform privilege while preserving service credentials.
- Use `pnpm accept:runtime:fixed-service -- --uninstall` to cleanly remove local development service artifacts.
