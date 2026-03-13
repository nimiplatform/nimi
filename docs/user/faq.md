# FAQ

## General

### What is Nimi?

Nimi is an open-source AI runtime that gives you one unified surface for local and cloud AI. Install it, start the runtime, and generate with local models or cloud providers using the same commands.

### Is Nimi free?

Yes. Runtime, SDK, desktop app, web client, and documentation are all open-source. Realm (cloud state backend) is a managed service.

### What platforms does Nimi support?

macOS and Linux for the runtime CLI. The desktop app is available for macOS, Windows, and Linux.

### Do I need an internet connection?

No. Local models run entirely on your machine. Cloud providers require internet access.

## Runtime

### How do I start the runtime?

Run `nimi start` for background mode or `nimi serve` for foreground with logs.

### How do I check if the runtime is healthy?

Run `nimi doctor` for a full environment check, or `nimi status` for process and reachability status.

### Can I use cloud providers without local models?

Yes. Use `nimi run "..." --provider gemini` to send requests directly to a cloud provider without any local model installed.

## Providers

### How do I add a cloud provider?

Run `nimi provider set <provider> --api-key-env <ENV_VAR> --default` to save a provider with an API key from an environment variable. Then use `nimi run "..." --cloud` to use your saved default.

### Which cloud providers are supported?

See the [Provider Matrix](../reference/provider-matrix.md) for the full list. Major providers include OpenAI, Anthropic, Gemini, DeepSeek, DashScope, and many more.

## Development

### Can I use runtime without realm?

Yes. Runtime and realm are independent, and you can integrate either one or both.

### Can I build my own client instead of desktop?

Yes. Desktop is a first-party app, not a privileged platform path. Use the SDK to build your own client.

### Where are runnable examples?

All examples are under `/examples` and compile-checked in CI.

### Is realm open source?

Runtime, SDK, proto, desktop, web, and docs are open-source. Realm backend is managed/closed-source.

### Where should I look for authoritative rules?

Use `spec/` for normative contracts and this portal for developer-oriented guidance.
