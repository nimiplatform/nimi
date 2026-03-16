# Installation Guide

::: tip Early Access
Nimi is in early access. Core features are functional, but APIs may change between releases.
:::

## Download Desktop App

The desktop app is the fastest way to get started with Nimi.

| Platform | Status |
|---|---|
| macOS (Apple Silicon) | Available on [GitHub Releases](https://github.com/nimiplatform/nimi/releases) — updater archive (`.app.tar.gz`) |
| macOS (Intel) | Available on [GitHub Releases](https://github.com/nimiplatform/nimi/releases) — updater archive (`.app.tar.gz`) |
| Windows | Available on [GitHub Releases](https://github.com/nimiplatform/nimi/releases) — NSIS installer (`.exe`) |
| Linux | Available on [GitHub Releases](https://github.com/nimiplatform/nimi/releases) — AppImage |

If you prefer the command line or want automated installs, use the CLI install methods below. The `curl` installer supports macOS and Linux. `npm install -g @nimiplatform/nimi` covers supported macOS, Linux, and Windows targets.
If a macOS desktop release is published in ad-hoc signing mode, Gatekeeper may require you to manually allow the extracted app before first launch.

## System Requirements

- **CLI via `curl`**: macOS or Linux (`x86_64`, `arm64`)
- **CLI via npm**: supported macOS, Linux, and Windows targets with Node.js 18 or later
- **Desktop app**: macOS (Apple Silicon or Intel), Windows, or Linux
- **Disk Space**: At least 2 GB free for the runtime and a base local model
- **Network**: Required for initial install and cloud provider usage; local-only generation works offline after model download

## Install Methods

### curl Script (recommended)

```bash
curl -fsSL https://install.nimi.xyz | sh
```

The script detects your OS and architecture, downloads the appropriate binary, and places it on your PATH.
By default it installs `nimi` into `~/.nimi/bin/nimi` and appends `~/.nimi/bin` to `~/.zshrc`, `~/.bashrc`, and `~/.profile` if needed.

### npm Global Install

```bash
npm install -g @nimiplatform/nimi
```

Requires Node.js 18 or later.

## Verify the Installation

```bash
nimi version
```

This prints the installed CLI version.

Run a full environment check:

```bash
nimi doctor
```

`nimi doctor` reports:

- CLI version
- Config file path
- gRPC daemon health
- Runtime mode and process status
- Local engine status
- Provider status
- Installed model count

## Starting the Runtime

### Background Mode (default)

```bash
nimi start
```

Launches the runtime daemon in the background and returns control to your terminal. The runtime listens on gRPC at `127.0.0.1:46371` by default.

### Foreground Mode

```bash
nimi serve
```

Starts the runtime in the foreground with logs streaming to stdout. Useful for debugging or watching runtime activity in real time. Press `Ctrl+C` to stop.

### Verify the Runtime Is Running

```bash
nimi status
```

Confirms the daemon process is alive and reachable.

## Default Endpoint

The runtime exposes a gRPC endpoint at:

```
127.0.0.1:46371
```

All CLI commands and SDK clients connect to this endpoint by default.

## Updating Nimi

### curl Script

Re-run the install script. It replaces the existing binary with the latest version:

```bash
curl -fsSL https://install.nimi.xyz | sh
```

### npm

```bash
npm update -g @nimiplatform/nimi
```

After updating, restart the runtime to pick up changes:

```bash
nimi stop
nimi start
```

## Uninstalling

### curl Script Install

Remove the binary from the install root. The default location is:

```bash
rm -f ~/.nimi/bin/nimi
```

Remove the PATH line added by the installer from `~/.zshrc`, `~/.bashrc`, or `~/.profile` if you no longer want `~/.nimi/bin` on your shell PATH.

Remove the configuration directory:

```bash
rm -rf ~/.nimi
```

### npm Install

```bash
npm uninstall -g @nimiplatform/nimi
```

Remove the configuration directory:

```bash
rm -rf ~/.nimi
```

## Next Steps

- [User Quickstart](index.md) -- first generation in five minutes
- [CLI Command Reference](cli.md) -- full list of commands
- [Troubleshooting](troubleshooting.md) -- common install issues
