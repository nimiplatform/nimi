# CLI Command Reference

Complete reference for all user-facing `nimi` CLI commands. Commands are organized by category.

---

## Runtime Lifecycle

### `nimi start`

Start the runtime daemon in the background.

```bash
nimi start
```

The daemon listens on gRPC at `127.0.0.1:46371` by default and continues running after your terminal session ends.

### `nimi serve`

Start the runtime in the foreground with logs streaming to stdout.

```bash
nimi serve
```

Useful for debugging. Press `Ctrl+C` to stop.

### `nimi stop`

Stop the running daemon.

```bash
nimi stop
```

### `nimi status`

Check whether the daemon process is alive and reachable.

```bash
nimi status
```

Reports process status and gRPC endpoint reachability.

### `nimi doctor`

Run a full environment diagnostic.

```bash
nimi doctor
```

Reports:

- CLI version
- Config file path
- gRPC daemon health
- Runtime mode
- Process status
- Local engine status
- Provider status
- Installed model count

For machine-readable output:

```bash
nimi doctor --json
```

### `nimi health`

Perform a targeted health check.

```bash
nimi health --source grpc
```

Checks gRPC endpoint reachability directly.

### `nimi version`

Print the installed CLI version.

```bash
nimi version
```

### `nimi logs`

View runtime logs.

```bash
nimi logs --tail 100
```

Shows the most recent 100 lines of runtime log output.

---

## Generation

### `nimi run`

Generate AI text from a prompt.

**Local generation (default):**

```bash
nimi run "What is Nimi?"
```

Uses the default local model. If the model is not installed, Nimi offers to pull it.

**One-shot cloud provider:**

```bash
nimi run "What is Nimi?" --provider gemini
```

Routes the request through the specified cloud provider. If the API key is missing, Nimi prompts for it once and stores it.

**Saved default cloud provider:**

```bash
nimi run "What is Nimi?" --cloud
```

Uses the provider previously saved with `nimi provider set ... --default`.

**Auto-pull missing model:**

```bash
nimi run "What is Nimi?" --yes
```

Automatically pulls a missing local model without prompting.

---

## Model Management

### `nimi model list`

List all installed local models.

```bash
nimi model list
```

For machine-readable output:

```bash
nimi model list --json
```

### `nimi model pull`

Download a specific model.

```bash
nimi model pull --model-ref <ref>@latest
```

Replace `<ref>` with the model reference identifier. The `@latest` tag fetches the most recent version.

---

## Provider Management

### `nimi provider list`

List all configured cloud providers and their status.

```bash
nimi provider list
```

For machine-readable output:

```bash
nimi provider list --json
```

### `nimi provider set`

Configure a cloud provider and optionally set it as the default.

```bash
nimi provider set <provider> --api-key-env <ENV_VAR> --default
```

- `<provider>` -- the provider name (e.g., `gemini`, `openai`, `anthropic`)
- `--api-key-env` -- the environment variable that holds the API key
- `--default` -- makes this provider the default for `--cloud` usage

### `nimi provider test`

Test connectivity and authentication for a configured provider.

```bash
nimi provider test <provider>
```

Sends a lightweight request to verify the provider is reachable and the API key is valid.

---

## See Also

- [User Quickstart](index.md) -- get started fast
- [Cloud Provider Setup](providers.md) -- detailed provider configuration
- [Model Management](models.md) -- pulling and managing models
- [Troubleshooting](troubleshooting.md) -- common errors and fixes
