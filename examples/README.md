# Nimi Examples

These examples are organized by onboarding slope: start with one file that proves Nimi works, then move into streaming, capability intent, and deeper Runtime features.

## Before You Run Anything

The public install channel is not open yet. Run examples from a source
checkout with the runtime CLI built locally:

```bash
pnpm install
pnpm build:runtime
export PATH="$PWD/dist:$PATH"
nimi serve
```

On a build with an admitted background/service controller, its bounded process
proof is:

```bash
nimi doctor
nimi health --json
```

Node.js is only needed when you run the TypeScript example files directly.

## 30 Seconds

```bash
npx tsx examples/sdk/01-hello.ts
```

This is the shortest proof that:

- `createNimiClient()` can attach to the local daemon with explicit app identity
- `client.ai.createRuntimeModel(...).generateText(...)` is the vNext text path
- local generation can happen without wiring app-specific transport code

## Onboarding Ladder

```bash
npx tsx examples/sdk/01-hello.ts
npx tsx examples/sdk/02-streaming.ts
npx tsx examples/sdk/03-runtime-intent.ts
npx tsx examples/sdk/04-vercel-ai-sdk.ts
npx tsx examples/sdk/05-multimodal.ts
```

What each file demonstrates:

- `01-hello.ts`: smallest possible text generation
- `02-streaming.ts`: stream chunks from the same runtime surface
- `03-runtime-intent.ts`: keep the request stable while Runtime follows the App's Local or Cloud intent
- `04-vercel-ai-sdk.ts`: Nimi as a provider for the Vercel AI SDK
- `05-multimodal.ts`: image and TTS flows through the runtime

## Author Templates

- `app-template/`: tracked output shape for `pnpm dlx --package @nimiplatform/app-tools nimi-app create --profile standalone`

## Advanced Paths

Advanced examples live under `examples/sdk/advanced/`:

- `app-access.ts`: session posture remains independent while protected App Access fails closed until ingress is available
- `knowledge.ts`: private knowledge bank/page CRUD + keyword search
- `custom-runtime.ts`: explicit Runtime transport configuration

The onboarding ladder keeps execution requests limited to App identity, scenario content,
and supported parameters. Runtime reads the App's capability intent and chooses the
implementation when execution starts.

## Compile Gate

```bash
pnpm --filter @nimiplatform/examples run check
```

## Layout

- `sdk/`: app-facing SDK examples
- `app-template/`: app scaffold reference
- `sdk/advanced/`: deeper runtime features
- `runtime/`: CLI examples
