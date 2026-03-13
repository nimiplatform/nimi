# Cloud Provider Setup

Nimi routes AI requests to local models by default. Cloud providers add access to remote models from services like Google Gemini, OpenAI, Anthropic, and others.

## How It Works

When you run a generation command, Nimi decides where to route it:

- **No flags**: uses the default local model
- **`--provider <name>`**: routes to the specified cloud provider for this single request
- **`--cloud`**: routes to the saved default cloud provider

## One-Shot Provider Usage

The fastest way to use a cloud provider is the one-shot flag:

```bash
nimi run "Summarize quantum computing" --provider gemini
```

If the API key for that provider is not yet stored, Nimi prompts you for it once, saves it in the runtime config, and continues with the same command. No separate setup step needed.

## Saving a Default Provider

If you use the same cloud provider regularly, save it as your default:

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
```

Then use the `--cloud` flag without specifying a provider name:

```bash
nimi run "Summarize quantum computing" --cloud
```

This always routes through your saved default provider.

## Testing a Provider

Verify that a provider is correctly configured and reachable:

```bash
nimi provider test gemini
```

This sends a lightweight request to confirm connectivity and key validity.

## Listing Providers

See all configured providers and their status:

```bash
nimi provider list
```

For machine-readable output:

```bash
nimi provider list --json
```

## Configuration Precedence

When multiple configuration sources exist, Nimi resolves them in this order (highest priority first):

1. **CLI flags** -- `--provider gemini` on the command line
2. **Environment variables** -- e.g., `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY`
3. **Config file** -- `~/.nimi/config.json`
4. **Built-in defaults**

CLI flags always win. If you pass `--provider openai` but your saved default is `gemini`, the request goes to OpenAI.

## Available Providers

Nimi supports a wide range of cloud providers including OpenAI, Anthropic, Google Gemini, DeepSeek, Azure OpenAI, Mistral, Groq, xAI, and many more.

For the full list of supported providers, their capabilities (text, image, audio, video), and current status, see the [Provider Matrix](../reference/provider-matrix.md).

## See Also

- [User Quickstart](index.md) -- first generation in five minutes
- [CLI Command Reference](cli.md) -- all available commands
- [Troubleshooting](troubleshooting.md) -- provider authentication errors
