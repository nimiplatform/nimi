<div align="center">

  # 🪸 Nimi: AI runtime for apps.

  [![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-black.svg?logo=github&style=flat-square)](https://github.com/nimiplatform/nimi)
  [![Last Commit](https://img.shields.io/github/last-commit/nimiplatform/nimi?style=flat-square)](https://github.com/nimiplatform/nimi)
  [![CI](https://img.shields.io/github/actions/workflow/status/nimiplatform/nimi/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MIT-blue?style=flat-square)](LICENSE)
  [![Go](https://img.shields.io/badge/go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](runtime/go.mod)
  [![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
</div>

[Website](https://nimi.xyz) | [Getting Started](docs/user/index.md) | [Nimi Coding](docs/nimi-coding.md) | [SDK Reference](docs/reference/sdk.md) | [Examples](examples/README.md) | [Spec](spec/INDEX.md) | [Discord](https://discord.gg/BQwHJvPn)

Build AI apps that run local and cloud models through one runtime, one SDK, and one operational surface.

<p align="center">
  <img src="docs/assets/banner.jpg" alt="Nimi Banner" width="1200">
</p>

> **Early Access** Expect breaking changes.
> Core runtime, SDK, and desktop app are functional and open for use, but APIs and Realm may change between releases. We welcome feedback and contributions.

## Download

| Platform | Status | Link |
|---|---|---|
| macOS (Apple Silicon) | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| macOS (Intel) | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| Windows | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| Linux | Desktop release on GitHub; CLI + SDK also available | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |

The desktop app is the fastest way to get started. For CLI-only installs, use `curl -fsSL https://install.nimi.xyz | sh` on macOS/Linux or `npm install -g @nimiplatform/nimi` on supported macOS/Linux/Windows targets.
> In early access, macOS desktop assets may be published in ad-hoc signing mode before Apple Developer ID notarization is configured.

## Install

```bash
curl -fsSL https://install.nimi.xyz | sh

# or
npm install -g @nimiplatform/nimi
```

`curl` installs into `~/.nimi/bin`. The npm package installs the platform-specific CLI launcher for your current OS and architecture.

## 30-Second Start

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
import { Runtime } from '@nimiplatform/sdk/runtime';

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
import { Runtime } from '@nimiplatform/sdk/runtime';
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

## Future Schedule

| Time | Focus | What expect |
|---|---|---|
| Now | Multimodal foundation | Nimi is actively building the runtime base for image, speech, and media workflows |
| Now | Knowledge and RAG foundation | Nimi is actively building document ingestion, retrieval, and grounded answer flows |
| `03-20` | Reading and model UX | Better Markdown rendering, Mermaid, LaTeX, stronger code blocks, AI artifact metadata, local device reporting, and a clearer model selector |
| `03-27` | Core runtime unlocks | MCP support, OpenAI-compatible API access, workflow triggers, document processing, and the first usable RAG loop |
| `04-10` | Smarter agent workflows | Web search, proactive scheduled agents, persona editing, prompt variables, context compression, RAG citations, model catalog upgrades, and stronger audit visibility |
| `04-24` | Creator and workflow tools | Mod marketplace, creator/community features, visual workflow editor, human approval steps, moderation, and deeper RAG controls |
| `05-15` | Next interaction layer | Agent UI surfaces, browser-side lightweight inference, OAuth login, image-generation mod, avatar experiences, social and IM integrations, mobile work, sandboxing, IDE extension, and cross-instance agent flows |

Current progress at a glance:

| Area | Status | What it means |
|---|---|---|
| Multimodal | Foundation defined, first delivery in progress | Nimi is moving beyond text into image, speech, and media workflows |
| Knowledge / RAG | Foundation defined, first delivery in progress | Upload documents, search them, and ground answers with retrieval |
| MCP | Next major runtime unlock | Nimi will connect more naturally to external agent and tool ecosystems |
| Agent UI | Planned for May | Agents will be able to drive safe, structured UI instead of text-only responses |
| Marketplace + Mods | Planned for April | Better discovery, installation, and sharing of Nimi extensions |

| Notes | Meaning |
|---|---|
| Schedule dates | Dates refer to the first usable slice of a feature, not the final polished version |
| Delivery order | Nimi ships runtime and SDK foundations first, then desktop, web, and ecosystem features on top |

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
| `local/*` | LocalAI, Nexa, Nimi Media |
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
