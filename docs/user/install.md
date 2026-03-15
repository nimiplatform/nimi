# Installation Guide

::: tip Early Access
Nimi is in early access. Core features are functional, but APIs may change between releases.
:::

## Download Desktop App

The desktop app is the fastest way to get started with Nimi.

| Platform | Status |
|---|---|
| macOS (Apple Silicon) | Available — [Download](https://nimi.xyz/download) |
| macOS (Intel) | Available — [Download](https://nimi.xyz/download) |
| Windows | Coming Soon |
| Linux | CLI + SDK available (see below) |

If you prefer the command line or are on Linux, use the CLI install methods below.

## System Requirements

- **Operating System**: macOS (Apple Silicon or Intel) or Linux (x86_64, arm64)
- **Disk Space**: At least 2 GB free for the runtime and a base local model
- **Network**: Required for initial install and cloud provider usage; local-only generation works offline after model download

## Install Methods

### curl Script (recommended)

```bash
curl -fsSL https://install.nimi.xyz | sh
```

The script detects your OS and architecture, downloads the appropriate binary, and places it on your PATH.

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

Remove the binary from your PATH. The default location depends on your system; the install script prints the path during installation. Common locations:

```bash
rm /usr/local/bin/nimi
```

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
