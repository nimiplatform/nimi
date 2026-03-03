<div align="center">

  ## 🪸 Nimi: The Infrastructure Layer for Next-Gen AI Apps

  [![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-black.svg?logo=github&style=flat-square)](https://github.com/nimiplatform/nimi)
  [![Last Commit](https://img.shields.io/github/last-commit/nimiplatform/nimi?style=flat-square)](https://github.com/nimiplatform/nimi)
  [![CI](https://img.shields.io/github/actions/workflow/status/nimiplatform/nimi/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MIT-blue?style=flat-square)](LICENSE)
  [![Go](https://img.shields.io/badge/go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](runtime/go.mod)
  [![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)

  <p align="center">
    <a href="https://nimi.xyz">Website</a> · <a href="docs/getting-started/">Getting Started</a> · <a href="docs/reference/sdk.md">SDK Reference</a> · <a href="spec/platform/protocol.md">Protocol</a> · <a href="CONTRIBUTING.md">Contributing</a>
  </p>
</div>

---

Building an AI app is easy. Giving it memory, context, and identity that persists across every app your users touch — that's the hard part.

**Nimi** is the open-source infrastructure layer that gives AI apps shared context, persistent agents, and cross-app identity. **Runtime** handles AI model abstraction locally. **Realm** provides the persistent world state in the cloud. One unified **SDK** connects both.

<!-- TODO: Add product screenshot or demo GIF here
     Recommended: Desktop shell screenshot showing World + Agent interaction
     Size: 800px width, centered
     Format: GIF (animated demo) or PNG (static screenshot)
     Place file at: docs/assets/nimi-demo.gif or docs/assets/nimi-screenshot.png
     Then replace this comment with:
     <p align="center">
       <img src="docs/assets/nimi-demo.gif" alt="Nimi Demo" width="800">
     </p>
-->

## Why Nimi?

<table>
<tr>
<td width="50%" valign="top">

### For Developers

- **One SDK, any model** — Runtime abstracts provider differences. Switch between local and cloud models without changing code.
- **Rich context out of the box** — Realm gives you Worlds, Agents, Memory, and six protocol primitives. No more building your data layer from scratch.
- **Vercel AI SDK compatible** — Drop-in `ai` provider. Use `generateText`, `streamText` with your existing code.
- **Local-first, cloud-optional** — Go daemon runs on the user's machine. Cloud when you need it.

</td>
<td width="50%" valign="top">

### For Users

- **One identity everywhere** — Unified account, data, and authorization across all Nimi apps.
- **AI that remembers you** — Your agents carry memory, preferences, and relationships between apps.
- **Seamless world traversal** — Switch between AI apps like walking between rooms. Think *Ready Player One*.
- **Your data, your control** — Local-first architecture means your data lives on your machine first.

</td>
</tr>
</table>

## How It Works

<p align="center">
  <img src="docs/assets/structure.jpg" alt="Nimi" width="1200">
</p>

**Realm** is the shared cloud state — identity, social graphs, economy, and persistent world/agent definitions. **Runtime** is the local AI daemon — model routing, inference, workflows, and knowledge indexing. They are **independent peers**. SDK bridges both. Apps access platform exclusively via `@nimiplatform/sdk`.

## AI Coding in Nimi

Nimi applies a Spec-first, AI-first engineering methodology where AI agents are primary executors and deterministic guards are the default safety net.

- **Execution protocol:** every normative change follows `Rule -> Table -> Generate -> Check -> Evidence`.
- **Fact governance:** rules and structured tables are the canonical source; generated docs are projections, not edit targets.
- **Quality guard:** deterministic CI checks are Layer 1, semantic audit is Layer 2, and both are used in a bi-directional audit loop (`Spec -> Impl` and `Impl -> Spec`).
- **Engineering outcome:** changes stay traceable, verifiable, and regression-resistant under continuous AI-assisted delivery.

Method details: [AI_SPEC_CODING_METHODOLOGY.md](AI_SPEC_CODING_METHODOLOGY.md)

## Realm (Cloud Persistent World)

`Realm` is Nimi's cloud state layer (managed, closed-source service) for cross-device and cross-app consistency.

- **What it stores:** identity, social graph, economy state, worlds, agents, and memory.
- **How it communicates:** REST APIs + WebSocket real-time events.
- **How you access it:** `@nimiplatform/sdk` `Realm` client (`auth/users/posts/worlds/...`).
- **Deployment model:** runtime-only, realm-only, or both together.

For detailed contracts, see [Architecture](docs/architecture/) and [SDK Reference](docs/reference/sdk.md).

## Runtime (Local Execution Daemon for Local + Cloud AI)

`Runtime` runs locally as an open-source Go daemon, and serves as a unified AI gateway for both on-device engines and cloud providers.

- **What it handles:** text/image/video/TTS/STT/embedding inference, model lifecycle, workflow execution, local knowledge indexing, and audit.
- **How it routes:** `local-runtime` for on-device engines (LocalAI/Nexa), `token-api` for cloud providers.
- **How it communicates:** local gRPC for app integration and CLI for operations (`go run ./cmd/nimi ...`).
- **How you access it:** `@nimiplatform/sdk` `Runtime` client and `@nimiplatform/sdk/ai-provider` (Vercel AI SDK compatible).

For implementation details, see [Runtime Guide](runtime/README.md) and [SDK Reference](docs/reference/sdk.md).

## Supported Models & Providers

Nimi Runtime routes AI calls through a unified API — switch between local engines and cloud providers without changing your application code.

### Local (On-Device)

Pick the engine that matches your device profile:

- `LocalAI` delivers full multimodal performance on local CPU/GPU, supporting GGUF and OpenAI-compatible models (Qwen, LLaMA, Mistral, Phi, Gemma, and more).
- `Nexa` is tuned for quantized, lower-footprint inference on edge-class devices. Video is currently policy-gated (`nexa.video.unsupported`) and returns `AI_ROUTE_UNSUPPORTED`.

| Engine | Text | Embed | Image | Video | TTS | STT |
|--------|:----:|:-----:|:-----:|:-----:|:---:|:---:|
| [LocalAI](https://localai.io) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Nexa](https://nexa.ai/) | ✅ | ✅ | ✅ | ─* | ✅ | ✅ |

* `Nexa` video generation is intentionally blocked by policy gate `nexa.video.unsupported`.

### Cloud Providers

| Provider | SDK Prefix | Text | Embed | Image | Video | TTS | STT |
|----------|-----------|:----:|:-----:|:-----:|:-----:|:---:|:---:|
| [OpenAI](https://openai.com) | `openai/` | ✅ | ✅ | ─ | ─ | ─ | ─ |
| [Anthropic](https://anthropic.com) | `anthropic/` | ✅ | ─ | ─ | ─ | ─ | ─ |
| [Google Gemini](https://ai.google.dev) | `gemini/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [DeepSeek](https://deepseek.com) | `deepseek/` | ✅ | ─ | ─ | ─ | ─ | ─ |
| [OpenRouter](https://openrouter.ai) | `openrouter/` | ✅ | ─ | ─ | ─ | ─ | ─ |
| OpenAI-Compatible ¹ | `openai_compatible/` | ✅ | ─ | ─ | ─ | ─ | ─ |
| [Alibaba DashScope](https://dashscope.aliyun.com) | `dashscope/` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Volcengine ARK](https://www.volcengine.com/product/ark) (Doubao) | `volcengine/` | ✅ | ✅ | ✅ | ✅ | ─ | ─ |
| [Volcengine OpenSpeech](https://www.volcengine.com/product/speech) | `volcengine_openspeech/` | ─ | ─ | ─ | ─ | ✅ | ✅ |
| [MiniMax](https://www.minimax.chat) | `minimax/` | ✅ | ─ | ✅ | ✅ | ✅ | ✅ |
| [Kimi (Moonshot)](https://kimi.ai) | `kimi/` | ✅ | ─ | ✅ | ─ | ✅ | ✅ |
| [GLM (Zhipu)](https://open.bigmodel.cn) | `glm/` | ✅ | ─ | ✅ | ✅ | ✅ | ✅ |
| [Azure OpenAI](https://azure.microsoft.com/products/ai-services/openai-service) | `azure/` | ✅ | ✅ | ─ | ─ | ─ | ─ |
| [Mistral AI](https://mistral.ai) | `mistral/` | ✅ | ✅ | ─ | ─ | ─ | ─ |
| [Groq](https://groq.com) | `groq/` | ✅ | ─ | ─ | ─ | ─ | P2 |
| [xAI (Grok)](https://x.ai) | `xai/` | ✅ | ─ | ─ | ─ | ─ | ─ |
| [Baidu Qianfan (ERNIE)](https://qianfan.cloud.baidu.com) | `qianfan/` | ✅ | ✅ | P2 | ─ | P2 | P2 |
| [Tencent Hunyuan](https://hunyuan.tencent.com) | `hunyuan/` | ✅ | ✅ | P2 | P2 | P2 | P2 |
| [iFlytek Spark](https://xinghuo.xfyun.cn) | `spark/` | ✅ | ─ | ─ | ─ | P2 | P2 |
| [AWS Bedrock](https://aws.amazon.com/bedrock) | *Phase 2* | P2 | P2 | P2 | ─ | ─ | ─ |
| [Cohere](https://cohere.com) | *Phase 2* | ✅ | P2 | ─ | ─ | ─ | ─ |
| [Together AI](https://together.ai) | *Phase 2* | ✅ | P2 | P2 | ─ | ─ | ─ |
| [Replicate](https://replicate.com) | *Phase 2* | P2 | ─ | P2 | P2 | ─ | ─ |
| [ElevenLabs](https://elevenlabs.io) | *Phase 2* | ─ | ─ | ─ | ─ | P2 | P2 |
| [Baichuan AI](https://www.baichuan-ai.com) | *Phase 2* | ✅ | P2 | ─ | ─ | ─ | ─ |
| [Yi (01.AI)](https://www.01.ai) | *Phase 2* | ✅ | ─ | ─ | ─ | ─ | ─ |
| [Step AI](https://www.stepfun.com) | *Phase 2* | ✅ | ─ | P2 | P2 | ─ | ─ |
| [Perplexity AI](https://perplexity.ai) | *Phase 3* | ✅ | ─ | ─ | ─ | ─ | ─ |
| [Stability AI](https://stability.ai) | *Phase 3* | ─ | ─ | P3 | P3 | ─ | ─ |
| [AssemblyAI](https://assemblyai.com) | *Phase 3* | ─ | ─ | ─ | ─ | ─ | P3 |
| [Runway](https://runwayml.com) | *Phase 3* | ─ | ─ | ─ | P3 | ─ | ─ |

¹ **OpenAI-Compatible** — bring-your-own endpoint: Ollama, vLLM, LM Studio, LiteLLM, Xinference, etc.

> Want to contribute a provider? See [CONTRIBUTING.md](CONTRIBUTING.md), [runtime/README.md](runtime/README.md), and [spec/runtime/nimillm.md](spec/runtime/nimillm.md).

## Components

| Component | Description | Stack |
|-----------|-------------|-------|
| [**runtime**](runtime/) | Local AI daemon — inference, models, workflows, knowledge | Go 1.24, gRPC |
| [**sdk**](sdk/) | Developer SDK (`@nimiplatform/sdk`) | TypeScript, ESM |
| [**desktop**](apps/desktop/) | Desktop shell with mod ecosystem | Tauri, React 19 |
| [**web**](apps/web/) | Web client sharing desktop renderer | React 19 |
| [**mods**](nimi-mods/) | Desktop extensions with 8-stage governance | TypeScript |
| [**proto**](proto/) | gRPC service definitions | Protobuf, Buf CLI |
| [**spec**](spec/) | Executable specifications (kernel + domain) | Markdown, YAML |
| [**docs**](docs/) | Getting started & guides | Markdown |

## Quick Start

### 1. Start the Runtime

```bash
cd runtime
go run ./cmd/nimi serve
```

### 2. Make Your First AI Call

**Option A: CLI** (zero dependencies)

```bash
cd runtime
go run ./cmd/nimi run local/qwen2.5 --prompt "Hello, Nimi!"
```

**Option B: TypeScript SDK**

```bash
pnpm add @nimiplatform/sdk
```

```ts
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

const result = await runtime.ai.text.generate({
  model: 'local/qwen2.5',
  subjectUserId: 'local-user',
  input: 'Hello from Nimi!',
  route: 'local-runtime',
  fallback: 'deny',
  timeoutMs: 30000,
});

console.log(result.text);
```

**Option C: Vercel AI SDK**

```ts
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { generateText } from 'ai';

const nimi = createNimiAiProvider({
  runtime,
  appId: 'my_app',
  subjectUserId: 'local-user',
  routePolicy: 'local-runtime',
  fallback: 'deny',
});

const { text } = await generateText({
  model: nimi.text('local/qwen2.5'),
  prompt: 'What is the Nimi platform?',
});
```

**Option D: Realm (Cloud, optional)**

```ts
import { Realm } from '@nimiplatform/sdk';

const guestRealm = new Realm({
  baseUrl: process.env.NIMI_REALM_BASE_URL || 'https://api.nimi.xyz',
  auth: { accessToken: Realm.NO_AUTH },
});

const tokens = await guestRealm.auth.passwordLogin({
  email: 'user@nimi.local',
  password: 'secret',
});

const realm = new Realm({
  baseUrl: process.env.NIMI_REALM_BASE_URL || 'https://api.nimi.xyz',
  auth: {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || undefined,
  },
});

await realm.users.me();
await realm.posts.create({
  content: 'hello realm',
});
```

> **[Full Getting Started Guide →](docs/getting-started/)** covers configuration, routing, cloud providers, and realm integration.

## Learn More

| | |
|---|---|
| [Getting Started](docs/getting-started/) | Zero to first AI call in minutes |
| [SDK Reference](docs/reference/sdk.md) | Full `@nimiplatform/sdk` API guide |
| [Runtime Guide](runtime/README.md) | CLI commands and daemon configuration |
| [AI Coding Methodology](AI_SPEC_CODING_METHODOLOGY.md) | Spec-first and AI-first execution model used in Nimi |
| [Platform Protocol](spec/platform/protocol.md) | Six primitives: Timeflow · Social · Economy · Transit · Context · Presence |
| [Architecture](spec/platform/architecture.md) | Six-layer platform architecture contract |
| [Mod Development](docs/guides/mod-developer.md) | Build desktop extensions |
| [Vision](VISION.md) | North star and platform direction |

## Contributing

We welcome contributions of all kinds — bug reports, documentation improvements, feature implementations, and spec discussions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [GOVERNANCE.md](GOVERNANCE.md) for the decision-making process.

```bash
pnpm install              # Install dependencies
pnpm build                # Build SDK + Desktop + Web
cd runtime && go test ./... # Run runtime tests
```

## License

| License | Scope |
|---------|-------|
| [Apache-2.0](licenses/Apache-2.0.txt) | runtime, sdk, proto |
| [MIT](licenses/MIT.txt) | desktop, web, mods |
| [CC-BY-4.0](licenses/CC-BY-4.0.txt) | docs, spec |
