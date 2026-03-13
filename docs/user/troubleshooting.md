# Troubleshooting

## Common Errors

| Error | Meaning | Fix |
|---|---|---|
| `runtime is not running` | The Nimi daemon is not started or not reachable | Run `nimi start` to launch the daemon |
| `model ... is not installed` | A local generation was requested but the required model is not downloaded | Rerun the command with `--yes` to auto-pull, or manually pull with `nimi model pull --model-ref <ref>@latest` |
| `cloud credentials for <provider> are missing or invalid` | The API key for the requested cloud provider is not configured or has been rejected | Rerun with `--provider <provider>` to be prompted for the key, or save it with `nimi provider set <provider> --api-key-env <ENV_VAR> --default` |

---

## Runtime Won't Start

### Port Conflict

The runtime listens on `127.0.0.1:46371` by default. If another process is using that port, the runtime cannot start.

Check what is using the port:

```bash
lsof -i :46371
```

Stop the conflicting process or terminate a stale Nimi instance, then try again:

```bash
nimi start
```

### Another Instance Already Running

If a previous daemon is still running, stop it first:

```bash
nimi stop
nimi start
```

### Permission Issues

On some systems, the Nimi binary or its data directory may lack the necessary permissions. Verify the binary is executable and that `~/.nimi/` is writable by your user.

### Foreground Debugging

Start the runtime in the foreground to see log output directly:

```bash
nimi serve
```

This streams logs to stdout so you can identify startup failures immediately.

---

## Model Download Failures

### Network Issues

Model downloads require a stable network connection. If a download fails partway through:

1. Check your internet connectivity
2. Retry the pull command:

```bash
nimi model pull --model-ref <ref>@latest
```

Nimi resumes or restarts the download as needed.

### Insufficient Disk Space

Local models can be several gigabytes. Verify you have enough free disk space before pulling:

```bash
df -h ~
```

Free up space if needed and retry the download.

### Retry a Failed Pull

Simply run the pull command again:

```bash
nimi model pull --model-ref <ref>@latest
```

---

## Provider Authentication Errors

### Wrong API Key

If a cloud provider returns an authentication error, verify that the API key is correct. You can re-enter it by running a one-shot command:

```bash
nimi run "test" --provider <provider>
```

Nimi prompts for the key if the stored one is invalid.

### Expired or Revoked Key

API keys can expire or be revoked from the provider's dashboard. Generate a new key from the provider, then update your configuration:

```bash
nimi provider set <provider> --api-key-env <ENV_VAR> --default
export <ENV_VAR>=YOUR_NEW_KEY
```

### Rate Limits

Cloud providers enforce rate limits. If you receive rate limit errors:

- Wait a few seconds and retry
- Check your provider's dashboard for usage quotas
- Consider upgrading your plan with the provider

### Testing Provider Connectivity

Verify that a provider is reachable and the key is valid:

```bash
nimi provider test <provider>
```

---

## Desktop App Issues

### App Won't Launch

- Verify your OS meets the system requirements
- On macOS, allow the app in System Settings under Privacy and Security
- Reinstall the app from a fresh download

### Blank Screen

- Restart the app
- Delete the Nimi Desktop cache directory and relaunch
- On Linux, check for GPU driver or Wayland compatibility issues

### Mod Loading Errors

- Disable the problematic mod from the Runtime Config panel
- Check mod compatibility with your Nimi version
- Reinstall the mod from the Mod Hub
- If the app is unresponsive, start the runtime manually with `nimi start` and use the CLI to verify the environment with `nimi doctor`

---

## Collecting Diagnostics

When reporting an issue, gather diagnostic information to help with debugging.

### Full Environment Report

```bash
nimi doctor --json
```

Produces a machine-readable JSON report of your entire environment: CLI version, config paths, gRPC health, runtime mode, process status, engine status, provider status, and model count.

### Recent Runtime Logs

```bash
nimi logs --tail 100
```

Shows the last 100 lines of runtime log output. Increase the number if you need more history.

### Runtime Status

```bash
nimi status
```

Confirms whether the daemon is running and the gRPC endpoint is reachable.

---

## Getting Help

If you cannot resolve an issue using this guide:

- **GitHub Issues**: Report bugs and request features at [github.com/nimiplatform/nimi/issues](https://github.com/nimiplatform/nimi/issues)
- **Discord Community**: Join the Nimi Discord for real-time help from other users and the development team

When filing an issue, include the output of `nimi doctor --json` and any relevant log lines from `nimi logs --tail 100`.

## See Also

- [User Quickstart](index.md) -- get started from scratch
- [Installation Guide](install.md) -- install and update Nimi
- [CLI Command Reference](cli.md) -- all available commands
- [Cloud Provider Setup](providers.md) -- provider configuration details
