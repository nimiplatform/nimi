# FAQ

## General

### What is Nimi?

An AI-native open world platform. It provides a local AI runtime (inference, model management, workflow orchestration) and a cloud realm (identity, social, economy, worlds, agents) accessible through a unified SDK.

### What's the relationship between Realm and Runtime?

They're independent and parallel:

- **Realm** = cloud persistent world (identity, social graph, economy, worlds, agents, memory)
- **Runtime** = local AI compute (inference, models, knowledge, workflows, app auth)

An app can use either one or both. The SDK bridges access to both.

### Is Nimi open source?

Partially. The runtime, SDK, desktop, nimi-mods, and protocol docs are open source. The realm backend is closed source — it's the commercial platform service.

| Open Source | Closed Source |
|-------------|---------------|
| runtime (Apache-2.0) | nimi-realm (backend) |
| sdk (Apache-2.0) | Database schema |
| desktop (MIT) | Business algorithms |
| nimi-mods (MIT) | Infrastructure |
| proto (Apache-2.0) | |
| docs (CC-BY-4.0) | |

### Can I build my own client instead of using desktop?

Yes. Desktop has no architectural privilege — it uses the same SDK as third-party apps. If you build a better client that connects to nimi-realm, that's a success for the platform.

## Runtime

### How do I start the runtime?

```bash
cd runtime
go build -o nimi ./cmd/nimi
./nimi serve
```

### What AI models are supported?

- **Local**: Any model supported by LocalAI or Nexa (GGUF, ONNX, etc.)
- **Cloud**: Any OpenAI-compatible API via LiteLLM, plus custom adapters for Alibaba, Bytedance, etc.

### What's the difference between `local-runtime` and `token-api`?

- `local-runtime`: Uses on-device models (no internet, full privacy)
- `token-api`: Uses cloud AI providers (requires API key, higher capability)

Every AI call must specify which route to use. There's no silent fallback by default.

### Can I use the runtime without nimi-realm?

Yes. Set up the SDK with only a runtime endpoint:

```ts
const client = createNimiClient({
  appId: 'my_app',
  runtime: {
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  },
  // no realm config — runtime-only mode
});
```

## SDK

### What's `@nimiplatform/sdk/ai-provider`?

A Vercel AI SDK v6 custom provider that routes AI calls through nimi-runtime. It lets you use standard AI SDK functions (`generateText`, `streamText`, `embed`) with Nimi's runtime as the backend.

### What's the version strategy?

**Strict-only.** Only the current `0.x` release line is supported. Cross-major or cross-minor version combinations are unsupported. No compatibility shims, no graceful degradation.

## Mods

### What's a mod?

A lightweight extension running inside desktop's sandbox. Think of it as a mini-program (like WeChat mini-programs) that can access platform capabilities through nimi-hook.

### Can mods access AI directly?

Mods access AI through nimi-hook, which internally calls the SDK. Mods never call the SDK or runtime directly — the hook provides a sandboxed, governed interface.

### How do I publish a mod?

```bash
cd runtime
GITHUB_TOKEN=... go run ./cmd/nimi mod publish --dir /path/to/mod --source-repo yourname/your-mod
```

This creates a PR to the `nimiplatform/mod-circle` index repo. Your mod source stays in your own GitHub repository.

### How do I install a mod from Mod Circle?

```bash
cd runtime
export NIMI_RUNTIME_MODS_DIR=/ABS/PATH/TO/nimi-mods
go run ./cmd/nimi mod install mod-circle:world.nimi.community-tarot --mods-dir "$NIMI_RUNTIME_MODS_DIR" --json
```

To force exact ID matching (no name fallback), add `--strict-id`.

## Contributing

### How do I set up the development environment?

See [Development Setup](./dev/setup.md).

### I'm an AI coding agent. Where do I start?

Read [`AGENTS.md`](../AGENTS.md) at the root, then the component-specific AGENTS.md for the area you're working on:

- [`runtime/AGENTS.md`](../runtime/AGENTS.md)
- [`sdk/AGENTS.md`](../sdk/AGENTS.md)
- [`apps/desktop/AGENTS.md`](../apps/desktop/AGENTS.md)
