# Nimi

Open-source AI runtime for apps.

Build AI apps that run local and cloud models through one runtime, one SDK, and one operational surface.

[Website](https://nimi.xyz) | [Getting Started](docs/getting-started/index.md) | [SDK Reference](docs/reference/sdk.md) | [Examples](examples/README.md) | [Spec](spec/INDEX.md) | [Discord](https://discord.gg/BQwHJvPn)

## Install

```bash
curl -fsSL https://install.nimi.xyz | sh

# or
npm install -g @nimiplatform/nimi
```

You do not need Go, pnpm, or a source checkout unless you are developing Nimi itself.

## 30-Second Proof

```bash
nimi start
```

Then:

```bash
nimi doctor
nimi status
nimi run "What is Nimi?"
```

For cloud:

```bash
nimi run "What is Nimi?" --provider gemini
```

That command will prompt for a missing API key once, save it to the runtime machine config, and continue the same run.

For a reusable machine default:

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
nimi run "What is Nimi?" --cloud
```

<p align="center">
  <img src="docs/assets/nimi-quickstart.gif" alt="Nimi quickstart walkthrough" width="1100">
</p>

Same runtime. Same CLI. Different execution plane.

## Use In Your App

```bash
npm install @nimiplatform/sdk
```

```ts
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime();

const local = await runtime.generate({
  prompt: 'Explain Nimi in one sentence.',
});

const cloud = await runtime.generate({
  provider: 'gemini',
  prompt: 'Explain Nimi in one sentence.',
});

console.log('[local]', local.text);
console.log('[cloud]', cloud.text);
```

The runtime call shape stays the same. Add `provider` when you want the cloud default for a provider.

If the runtime is not running, `nimi run` points you back to `nimi start`.

High-level onboarding stays on `nimi run` and `runtime.generate()/stream()`. Fully-qualified explicit model ids stay on lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

<p align="center">
  <img src="docs/assets/nimi-sdk.gif" alt="Nimi SDK walkthrough" width="1100">
</p>

## Vercel AI SDK

```ts
import { generateText } from 'ai';
import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

const runtime = new Runtime();
const nimi = createNimiAiProvider({ runtime });

const { text } = await generateText({
  model: nimi.text('gemini/default'),
  prompt: 'Hello from Vercel AI SDK + Nimi',
});
```

## Why Nimi Feels Different

- One runtime for local and cloud AI, instead of stitching together local runners, cloud SDKs, and app-specific glue
- Runtime-backed streaming, health checks, model lifecycle, and operational commands
- A clean app-facing SDK that can stay stable while execution moves between local and cloud
- A path from app integration to desktop-hosted experiences and mods

This is not just a provider wrapper. The runtime is a real execution boundary.

## What Nimi Is

Nimi has three practical layers:

- Runtime: local Go daemon for routing, inference, streaming, health, model lifecycle, workflow, knowledge, and audit
- SDK: TypeScript SDK for integrating runtime and realm into apps
- Desktop: host shell and mod surface for desktop AI experiences

Realm is Nimi's optional cloud state layer for identity, memory, and cross-app continuity.

## Examples

The onboarding ladder lives in [examples/README.md](examples/README.md).

Start here:

```bash
npx tsx examples/sdk/01-hello.ts
npx tsx examples/sdk/02-streaming.ts
npx tsx examples/sdk/03-local-vs-cloud.ts
npx tsx examples/sdk/04-vercel-ai-sdk.ts
```

The same runtime surface also covers multimodal flows such as image generation and TTS:

<p align="center">
  <img src="docs/assets/nimi-multimodal.gif" alt="Nimi multimodal walkthrough" width="1100">
</p>

## Architecture

<p align="center">
  <img src="docs/assets/structure.jpg" alt="Nimi Architecture" width="1200">
</p>

- Runtime: local execution and operational control
- Realm: cloud state and continuity
- SDK: application-facing integration layer
- Desktop: host experience and extension surface

## Core Components

| Component | Description | Stack |
|---|---|---|
| [runtime](runtime/README.md) | Local AI daemon and CLI | Go, gRPC |
| [sdk](sdk/README.md) | Unified SDK for runtime and realm | TypeScript, ESM |
| [desktop](apps/desktop/README.md) | Desktop host and mod ecosystem | Tauri, React |
| [web](apps/web/README.md) | Web client | React |
| [spec](spec/INDEX.md) | Normative contracts | Markdown, YAML |
| [docs](docs/index.md) | Developer portal | VitePress |

## Supported Providers

Representative routing planes:

| Plane | Examples |
|---|---|
| `local/*` | LocalAI, Nexa |
| `cloud/*` | OpenAI, Gemini, Anthropic, DeepSeek, GLM, MiniMax, DashScope, Volcengine |

For a deeper matrix, see [provider docs](docs/reference/provider-matrix.md).

## Contributing

If you are developing Nimi itself from source, then you do need the contributor toolchain:

- Go `1.24+`
- Node.js `24+`
- pnpm `10+`

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 / MIT. See [LICENSE](LICENSE).
