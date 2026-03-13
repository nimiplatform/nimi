# Model Management

Nimi runs local AI models on your machine. This guide covers how to list, pull, and manage them.

## Listing Installed Models

See all models currently installed on your system:

```bash
nimi model list
```

For machine-readable output:

```bash
nimi model list --json
```

You can also check the installed model count as part of a full environment diagnostic:

```bash
nimi doctor
```

## Pulling Models

Download a specific model by its reference identifier:

```bash
nimi model pull --model-ref <ref>@latest
```

Replace `<ref>` with the model reference. The `@latest` tag downloads the most recent available version.

## Auto-Pull on Generation

When you run a local generation and the required model is not installed, Nimi handles it interactively:

```bash
nimi run "What is Nimi?"
```

If the default local model is missing, Nimi asks whether you want to pull it. Confirm to download and continue the generation in the same command.

To skip the prompt and automatically pull any missing model:

```bash
nimi run "What is Nimi?" --yes
```

The `--yes` flag tells Nimi to download the model without asking.

## What Happens When a Model Is Missing

When a generation request targets a model that is not installed:

1. Nimi detects the model is missing
2. Without `--yes`: Nimi displays the model reference and asks for confirmation to download it
3. With `--yes`: Nimi immediately starts the download
4. Once the download completes, the generation proceeds as normal

If you decline the download prompt, Nimi exits with an error message indicating which model is needed. You can pull it manually at any time with `nimi model pull`.

## Model Storage Location

Downloaded models are stored in the Nimi data directory. The default location is inside `~/.nimi/`. You can verify the config and data paths by running:

```bash
nimi doctor
```

The output includes the config file path, which is in the same directory tree as downloaded model data.

## See Also

- [User Quickstart](index.md) -- get started fast
- [CLI Command Reference](cli.md) -- all model commands
- [Troubleshooting](troubleshooting.md) -- model download failures
