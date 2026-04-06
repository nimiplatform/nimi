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

Build AI apps against one runtime, one SDK, and one operational surface for local and cloud AI.

<p align="center">
  <img src="docs/assets/banner.jpg" alt="Nimi Banner" width="1200">
</p>

> **Rapid Development Phase** Nimi is still in an extremely fast-moving stage.
> Expect breaking changes, tightened contracts, and occasional docs drift between releases. For normative behavior, use [`spec/`](spec/INDEX.md) as the source of truth and treat [`spec/future/`](spec/future/index.md) as backlog rather than release commitments.

## Download

| Platform | Status | Link |
|---|---|---|
| macOS (Apple Silicon) | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| macOS (Intel) | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| Windows | Desktop release on GitHub | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |
| Linux | Desktop release on GitHub; CLI + SDK also available | [GitHub Releases](https://github.com/nimiplatform/nimi/releases) |

The desktop app is the fastest way to get started. For CLI-only installs, prefer GitHub Releases or `npm install -g @nimiplatform/nimi` on supported macOS/Linux/Windows targets.

> In early access, macOS desktop assets may be published in ad-hoc signing mode before Apple Developer ID notarization is configured.

## Install

```bash
npm install -g @nimiplatform/nimi
```

Release assets are published on GitHub Releases together with `checksums.txt`, SBOMs, and sigstore bundles. Verify those artifacts before manual installation. The npm package installs the platform-specific CLI launcher for your current OS and architecture.

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
import { createPlatformClient } from '@nimiplatform/sdk';

const { runtime } = await createPlatformClient({
  appId: 'readme.quickstart',
});

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

High-level onboarding stays on `nimi run`, `createPlatformClient()`, and `runtime.generate()/stream()`. Fully-qualified explicit model ids stay on lower-level surfaces such as `nimi ai text-generate --model-id ...` and `runtime.ai.text.generate({ model: ... })`.

<p align="center">
  <img src="docs/assets/nimi-sdk.gif" alt="Nimi SDK walkthrough" width="1100">
</p>

## Vercel AI SDK

```ts
import { generateText } from 'ai';
import { createPlatformClient } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';

const { runtime } = await createPlatformClient({
  appId: 'readme.vercel-ai',
});
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

Nimi is a multi-layer platform for building AI-native apps:

- **Runtime** — local Go daemon for routing, inference, streaming, health, model lifecycle, workflow, knowledge, connector management, and audit.
- **SDK** — TypeScript SDK (`@nimiplatform/sdk`) providing a unified interface for runtime and realm.
- **Kit** — cross-app toolkit (`@nimiplatform/nimi-kit`) with design system, auth, telemetry, and shared feature modules (chat, model-picker, generation, commerce).
- **Apps** — a family of Tauri + React desktop applications sharing the same runtime/sdk/kit foundation:
  - **Desktop** — main host shell with cloud/local AI chat, mod ecosystem, and agent interaction.
  - **Relay** — Electron AI chat client with beat-first turn pipeline, Live2D, and multi-session management.
  - **Forge** — creator studio for world/agent/content management, publishing, and analytics.
  - **Overtone** — music creation and collaboration with brief/lyrics/takes/compare/publish workflow.
  - **Shiji** (时迹) — immersive K-12 historical education with dialogue engine.
  - **Moment** — social moment capture and sharing.
  - **Lookdev** — visual design and look development tool.
  - **Realm Drift** — world exploration and agent chat with 3D marble visualization.
  - **Video Food Map** — food-related video content geolocation mapping.
  - **Web** — browser-based client (landing + web-shell, deployed on Cloudflare Pages).
- **Nimi Mods** — mod ecosystem with runtime integration and audit tooling (separate workspace).
- **Realm** — optional cloud state layer for identity, memory, and cross-app continuity.

## Current Specification Status

Nimi's public status should be read from the current spec, not from dated roadmap promises.

| Layer | Current status in spec | What it means |
|---|---|---|
| Runtime | Kernel contracts cover the full proto surface; AI/auth/connector is active and workflow/model/knowledge/app/audit contracts are already defined in kernel | Runtime behavior is contract-first, but implementation details may still harden quickly |
| SDK | `runtime`, `realm`, and `ai-provider` are Phase 1 active; `scope` and `mod` are defined and still evolving | Prefer `createPlatformClient()` for app entry and treat lower-level subpaths as advanced surfaces |
| Kit | UI, auth, core, telemetry, and feature modules are active; app theme variants ship per-app | Reuse kit surfaces before building app-local shells |
| Desktop + Apps | Kernel + domain contracts are active across shell, local AI, mod governance, and testing gates; multiple Tauri apps share runtime/sdk/kit | App UX and extension surfaces may keep shifting as runtime/sdk contracts tighten |
| Future | `spec/future/**` is structured backlog, not a shipping promise | Planned capabilities should not be read as committed dates or guaranteed release order |

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

- **Runtime**: local execution and operational control (Go daemon + CLI)
- **Realm**: cloud state, identity, and continuity
- **SDK**: application-facing integration layer (TypeScript)
- **Kit**: shared design system, auth, telemetry, and feature modules
- **Apps**: desktop host, creator tools, and vertical experiences (Tauri + React)

## Core Components

| Component | Description | Stack |
|---|---|---|
| [runtime](runtime/README.md) | Local AI daemon and CLI | Go, gRPC |
| [sdk](sdk/README.md) | Unified SDK for runtime and realm | TypeScript, ESM |
| [kit](kit/README.md) | Cross-app toolkit and design system | React, Radix UI, Tailwind |
| [desktop](apps/desktop/README.md) | Main desktop host and mod ecosystem | Tauri, React |
| relay (archived) | Archived Electron AI chat client; functionality moved into desktop chat | Electron, React |
| [forge](apps/forge/) | Creator studio for worlds and agents | Tauri, React |
| [overtone](apps/overtone/) | Music creation and collaboration | Tauri, React, Web Audio |
| [shiji](apps/shiji/) | K-12 historical education | Tauri, React, SQLite |
| [moment](apps/moment/) | Social moment capture | Tauri, React |
| [lookdev](apps/lookdev/) | Visual design tool | Tauri, React |
| [realm-drift](apps/realm-drift/) | World exploration with 3D marble | Tauri, React, Socket.IO |
| [video-food-map](apps/video-food-map/) | Food video geolocation | Tauri, React |
| [web](apps/web/README.md) | Web client | React, Cloudflare Pages |
| [install-gateway](apps/install-gateway/) | Release distribution worker | Cloudflare Worker |
| [nimi-mods](nimi-mods/) | Mod ecosystem | TypeScript |
| [proto](proto/) | Protocol Buffer definitions | Protobuf, Buf |
| [spec](spec/INDEX.md) | Normative contracts | Markdown, YAML |
| [docs](docs/index.md) | Developer portal | VitePress |

## Supported Providers

Representative routing planes:

| Plane | Examples |
|---|---|
| `local/*` | Canonical local engines (`llama`, `media`, `speech`) |
| `cloud/*` | OpenAI, Gemini, Anthropic, DeepSeek, GLM, MiniMax, DashScope, Volcengine |
| `live/*` | ElevenLabs, Fish Audio, Stepfun (realtime/streaming services) |

For a deeper matrix, see [provider docs](docs/reference/provider-matrix.md).

## Contributing

If you are developing Nimi itself from source, then you do need the contributor toolchain:

- Go `1.24+`
- Node.js `24+`
- pnpm `10+`

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0 / MIT. See [LICENSE](LICENSE).
