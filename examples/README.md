# Nimi Examples

These examples are organized by onboarding slope: start with one file that proves Nimi works, then move into streaming, cloud routing, and deeper runtime capabilities.

## Before You Run Anything

You do not need Go, pnpm, or a local source build unless you are developing Nimi itself.

For the SDK examples you only need:

```bash
# Install the runtime + CLI
curl -fsSL https://install.nimi.xyz | sh

# Start the runtime
nimi start
```

Fastest cloud proof:

```bash
nimi run "What is Nimi?"
nimi run "What is Nimi?" --provider gemini
```

Node.js is only needed when you run the TypeScript example files directly.

## 30 Seconds

```bash
npx tsx examples/sdk/01-hello.ts
```

This is the shortest proof that:

- `createPlatformClient()` can attach to the local daemon with defaults
- `runtime.generate()` is the new ergonomic first-run API
- local generation can happen without wiring app-specific transport code

## Onboarding Ladder

```bash
npx tsx examples/sdk/01-hello.ts
npx tsx examples/sdk/02-streaming.ts
npx tsx examples/sdk/03-local-vs-cloud.ts
npx tsx examples/sdk/04-vercel-ai-sdk.ts
npx tsx examples/sdk/05-multimodal.ts
```

What each file demonstrates:

- `01-hello.ts`: smallest possible text generation
- `02-streaming.ts`: stream chunks from the same runtime surface
- `03-local-vs-cloud.ts`: switch execution plane by adding a provider
- `04-vercel-ai-sdk.ts`: Nimi as a provider for the Vercel AI SDK
- `05-multimodal.ts`: image and TTS flows through the runtime

## Author Templates

- `app-template/`: tracked output shape for `pnpm dlx @nimiplatform/dev-tools nimi-app create --template basic`
- `mod-template/`: tracked output shape for `pnpm dlx @nimiplatform/dev-tools nimi-mod create`
- `mod-catalog-template/`: static GitHub-first catalog layout and signer registry example for desktop mod distribution

## Advanced Paths

Advanced examples live under `examples/sdk/advanced/`:

- `app-auth.ts`: app authorization lifecycle
- `workflow.ts`: workflow DAG orchestration
- `knowledge.ts`: private knowledge bank/page CRUD + keyword search
- `custom-runtime.ts`: explicit transport + provider wiring

Provider-focused examples remain in `examples/sdk/providers/`.

The onboarding ladder stays on high-level `nimi run` and `runtime.generate()/stream()` flows. Fully-qualified explicit model ids remain in lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

For SDK examples that use provider-default cloud targeting, save a reusable default on the runtime machine first:

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
```

## Compile Gate

```bash
pnpm --filter @nimiplatform/examples run check
node scripts/check-example-run-comments.mjs
```

## Layout

- `sdk/`: app-facing SDK examples
- `app-template/`: app scaffold reference
- `sdk/advanced/`: deeper runtime features
- `sdk/providers/`: provider-specific recipes
- `mod-template/`: mod scaffold reference
- `mod-catalog-template/`: catalog repo reference
- `mods/`: mod SDK examples
- `runtime/`: CLI examples
