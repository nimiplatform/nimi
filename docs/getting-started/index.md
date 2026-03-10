# Getting Started

This guide gets you from zero to a first successful Nimi generation without cloning the repo or installing contributor toolchains.

## What You Need

- the `nimi` binary installed
- background mode with `nimi start`
- Node.js only if you want to run the TypeScript SDK examples

If you are developing Nimi itself from source, use the repo-level contributor workflow instead. That is a different path.

## 1. Install Nimi

```bash
# macOS / Linux
curl -fsSL https://install.nimi.xyz | sh

# or
npm install -g @nimiplatform/nimi
```

## 2. Start The Runtime

```bash
nimi start
```

Default endpoint:

- gRPC: `127.0.0.1:46371`

## 3. Verify The Environment

Terminal B:

```bash
nimi doctor
nimi status
```

You should see:

- the CLI version
- config file path
- gRPC daemon health
- runtime mode and process status
- local engine status
- provider status
- installed model count

## 4. First Local Generation

```bash
nimi run "What is Nimi?"
```

What happens on the happy path:

- if the daemon is down, Nimi tells you to run `nimi start`
- if the model is missing, Nimi offers to pull it
- once the model is ready, text streams back to the terminal

## 5. First Cloud Generation

Fastest first-run path:

```bash
nimi run "What is Nimi?" --provider gemini
```

If the provider key is missing, Nimi prompts for it once, stores it in the runtime config, and continues the same command.

Reusable machine-default path:

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
nimi run "What is Nimi?" --cloud
```

Cloud setup stays provider-key-first on the runtime machine. `--provider` is the one-shot path; `--cloud` is the saved-default path.

For first-run onboarding, stay on `nimi run` and `runtime.generate()/stream()`. Fully-qualified explicit model ids remain on lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

![Nimi quickstart walkthrough](../assets/nimi-quickstart.gif)

Install, start the runtime, then run the first local or cloud prompt from the CLI.

## 6. Use Nimi In Your App

```bash
npm install @nimiplatform/sdk
```

```ts
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const result = await runtime.generate({
  prompt: 'Explain Nimi in one sentence.',
});

console.log(result.text);
```

To switch to cloud, keep the app code and add a provider:

```ts
const result = await runtime.generate({
  provider: 'gemini',
  prompt: 'Explain Nimi in one sentence.',
});
```

![Nimi SDK walkthrough](../assets/nimi-sdk.gif)

The same `Runtime` entry point stays intact as you move from local defaults to cloud providers.

## 7. Example Ladder

```bash
npx tsx examples/sdk/01-hello.ts
npx tsx examples/sdk/02-streaming.ts
npx tsx examples/sdk/03-local-vs-cloud.ts
npx tsx examples/sdk/04-vercel-ai-sdk.ts
```

## Common Errors

| Error | Meaning | Fix |
|---|---|---|
| `runtime is not running` | daemon is unavailable | run `nimi start` |
| `model ... is not installed` | local model missing | rerun with `--yes`, or pull a specific local model with `nimi model pull --model-ref <local-model>@latest` |
| `cloud credentials for <provider> are missing or invalid` | provider key missing/bad | rerun with `--provider <provider>`, or save a reusable default with `nimi provider set <provider> --api-key-env <ENV_NAME> --default` |

## Next Steps

- SDK integration: [App Developer](../guides/app-developer.md)
- Runtime operations: [Runtime Reference](../reference/runtime.md)
- More recipes: [Quick Recipes](../cookbook/quick-recipes.md)
- Full examples ladder: [`examples/README.md`](../../examples/README.md)
