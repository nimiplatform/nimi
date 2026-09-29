# Nimi Desktop

This package is the Electron application that hosts Nimi Home: the
account-gated entry for conversations, characters, worlds, settings, and Nimi
Apps, and the supervisor that launches Nimi App Hosts. Runtime executes AI;
Realm owns account and ecosystem identity. Module rules live in
[AGENTS.md](AGENTS.md).

## Run (Development)

From the repository root, start the current-user source Runtime supervisor and
keep that terminal running, then start Desktop in another terminal:

```bash
pnpm dev:runtime
pnpm dev:desktop
```

`pnpm dev:desktop` prepares the workspace SDK/Kit outputs, builds the Electron
host, starts the renderer on `127.0.0.1:1420`, and enables loopback CDP on
`9333` (`--cdp-port <port>` overrides it, `--no-cdp` disables it). Sign in
from Nimi Home, which completes the sign-in in your browser, before launching
Desktop-supervised Apps. [LOCAL_DEVELOPMENT.md](../../LOCAL_DEVELOPMENT.md)
covers the complete Windows and macOS paths.

Package checks:

```bash
pnpm --filter @nimiplatform/desktop typecheck
pnpm --filter @nimiplatform/desktop test
```

## Configuration

Desktop reads these values from the repository-root `.env` (`nimi/.env`):

- `NIMI_REALM_URL` — the source-development Realm URL passed to the source
  Runtime binding. It must be loopback HTTP on port `3002` and defaults to
  `http://127.0.0.1:3002`.
- `NIMI_WEB_URL` (optional) — the controlled public Web base used only for
  account-management and other admitted Web handoffs. Desktop login always
  opens the authorize URL issued by RuntimeAccountService.

AI execution configuration:

- Nimi Desktop stores canonical Local or Cloud capability intent.
- Runtime exclusively selects and validates the execution implementation when work starts.
- Machine-local catalog snapshots are display-only and never become request-side execution controls.

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

The fixed-service development candidate is installed and updated with the
repository acceptance command:

```bash
pnpm accept:runtime:fixed-service -- --install
pnpm accept:runtime:fixed-service
pnpm dev:macos:desktop:installed
```

Use `--install` only for the first installation, when the status is `absent`.
After that, `pnpm accept:runtime:fixed-service` builds one candidate and
replaces the healthy installed development service through the platform sudo
authorization while retaining its verified service principal and protected
state. Only explicit `--uninstall` removes that installation state.
`pnpm dev:macos:desktop:installed` launches the workspace renderer with the
installed `Nimi Dev.app`; it is a direct development launcher, not an
acceptance harness, and stops the renderer when the installed app exits.

The privileged installer rolls back ordinary reported failures. An abrupt
termination can still leave a partial local machine namespace; that state is
handled by inspecting and removing the exact administrator-owned development
paths once, then performing a fresh install. It is intentionally not a product
migration or automatic repair path.
