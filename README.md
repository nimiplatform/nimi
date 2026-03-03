<div align="center">

  # 🪸 Nimi: The Infrastructure Layer for Next-Gen AI Apps

  [![GitHub Repo](https://img.shields.io/badge/GitHub-Repo-black.svg?logo=github&style=flat-square)](https://github.com/nimiplatform/nimi)
  [![Last Commit](https://img.shields.io/github/last-commit/nimiplatform/nimi?style=flat-square)](https://github.com/nimiplatform/nimi)
  [![CI](https://img.shields.io/github/actions/workflow/status/nimiplatform/nimi/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml)
  [![License](https://img.shields.io/badge/license-Apache--2.0%20%2F%20MIT-blue?style=flat-square)](LICENSE)
  [![Go](https://img.shields.io/badge/go-1.24-00ADD8?style=flat-square&logo=go&logoColor=white)](runtime/go.mod)
  [![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?style=flat-square&logo=node.js&logoColor=white)](package.json)
</div>

---

[**Start in 2 minutes**](#quickstart)

[Website](https://nimi.xyz) | [Getting Started](docs/getting-started/index.md) | [SDK Reference](docs/reference/sdk.md) |  [Protocol](spec/platform/protocol.md) | [Contributing](CONTRIBUTING.md)

Build AI-native apps with persistent identity, shared memory, and cross-app context.
Nimi gives you a local Runtime, a cloud Realm, and one unified SDK.

<p align="center">
  <img src="docs/assets/banner.jpg" alt="Nimi Banner" width="1200">
</p>

## Why Nimi?

<table>
<tr>
<td width="50%" valign="top">

### For Developers

- **One SDK, any model** — One SDK for local and cloud inference, so app code stays stable while provider routing changes.
- **Rich context out of the box** — Realm gives you Worlds, Agents, Memory, and six protocol primitives. No more building your data layer from scratch.
- **Local-first, cloud-optional** — Go daemon runs on the user's machine. Cloud when you need it.
- **Spec-first engineering** — Open-source runtime + SDK with explicit contracts.

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

## Architecture At A Glance

<p align="center">
  <img src="docs/assets/structure.jpg" alt="Nimi Architecture" width="1200">
</p>

- **Runtime**: local Go daemon for model routing, inference, workflows, knowledge indexing, and audit.
- **Realm**: managed cloud state for identity, social graph, economy, worlds, agents, and memory.
- **SDK**: single integration layer (`@nimiplatform/sdk`) for Runtime and Realm.

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

## Core Components

| Component | Description | Stack |
|---|---|---|
| [runtime](runtime/README.md) | Local AI daemon and CLI | Go 1.24, gRPC |
| [sdk](sdk/README.md) | Unified SDK for Runtime + Realm | TypeScript, ESM |
| [desktop](apps/desktop/README.md) | Desktop shell with mod ecosystem | Tauri, React 19 |
| [web](apps/web/README.md) | Web client sharing desktop renderer | React 19 |
| [mods](nimi-mods/) | Desktop extensions | TypeScript |
| [proto](proto/README.md) | gRPC service contracts | Protobuf, Buf CLI |
| [spec](spec/INDEX.md) | Normative platform contracts | Markdown, YAML |
| [docs](docs/index.md) | External developer portal | VitePress, Markdown |

## Supported Models & Providers

Nimi Runtime routes AI calls through a unified API — switch between local engines and cloud providers without changing your application code.

### Local (On-Device)

Pick the engine that matches your device profile:

- `LocalAI` delivers full multimodal performance on local CPU/GPU, supporting GGUF and OpenAI-compatible models (Qwen, LLaMA, Mistral, Phi, Gemma, and more).
- `Nexa` is tuned for quantized, lower-footprint inference on edge-class devices. Video is currently policy-gated (`nexa.video.unsupported`) and returns `AI_ROUTE_UNSUPPORTED`.

Status legend:

- `GA`: available now and ready for current runtime contract usage.
- `Beta`: available now with partial or policy-gated modality support.
- `Planned`: tracked for future delivery, not available in current runtime contracts.

Capability legend:

- `✅`: available now
- `─`: unavailable in current release

| Engine | SDK Prefix | Status | Text | Embed | Image | Video | TTS | STT |
|--------|------------|--------|:----:|:-----:|:-----:|:-----:|:---:|:---:|
| [LocalAI](https://localai.io) | `local/` | `GA` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| [Nexa](https://nexa.ai/) | `local/` | `Beta` | ✅ | ✅ | ✅ | ─* | ✅ | ✅ |

* `Nexa` video generation is intentionally blocked by policy gate `nexa.video.unsupported`.

### Cloud Providers

| Provider | SDK Prefix | Status | Text | Embed | Image | Video | TTS | STT | Notes |
|----------|------------|--------|:----:|:-----:|:-----:|:-----:|:---:|:---:|-------|
| [OpenAI](https://openai.com) | `openai/` | `GA` | ✅ | ✅ | ─ | ─ | ─ | ─ | |
| [Anthropic](https://anthropic.com) | `anthropic/` | `GA` | ✅ | ─ | ─ | ─ | ─ | ─ | |
| [Google Gemini](https://ai.google.dev) | `gemini/` | `GA` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| [DeepSeek](https://deepseek.com) | `deepseek/` | `GA` | ✅ | ─ | ─ | ─ | ─ | ─ | |
| [OpenRouter](https://openrouter.ai) | `openrouter/` | `GA` | ✅ | ─ | ─ | ─ | ─ | ─ | |
| OpenAI-Compatible ¹ | `openai_compatible/` | `GA` | ✅ | ─ | ─ | ─ | ─ | ─ | |
| [Alibaba DashScope](https://dashscope.aliyun.com) | `dashscope/` | `GA` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| [Volcengine ARK](https://www.volcengine.com/product/ark) (Doubao) | `volcengine/` | `GA` | ✅ | ✅ | ✅ | ✅ | ─ | ─ | |
| [Volcengine OpenSpeech](https://www.volcengine.com/product/speech) | `volcengine_openspeech/` | `GA` | ─ | ─ | ─ | ─ | ✅ | ✅ | |
| [MiniMax](https://www.minimax.chat) | `minimax/` | `GA` | ✅ | ─ | ✅ | ✅ | ✅ | ✅ | |
| [Kimi (Moonshot)](https://kimi.ai) | `kimi/` | `GA` | ✅ | ─ | ✅ | ─ | ✅ | ✅ | |
| [GLM (Zhipu)](https://open.bigmodel.cn) | `glm/` | `GA` | ✅ | ─ | ✅ | ✅ | ✅ | ✅ | |
| [Azure OpenAI](https://azure.microsoft.com/products/ai-services/openai-service) | `azure/` | `GA` | ✅ | ✅ | ─ | ─ | ─ | ─ | |
| [Mistral AI](https://mistral.ai) | `mistral/` | `GA` | ✅ | ✅ | ─ | ─ | ─ | ─ | |
| [Groq](https://groq.com) | `groq/` | `Beta` | ✅ | ─ | ─ | ─ | ─ | ─ | STT planned |
| [xAI (Grok)](https://x.ai) | `xai/` | `GA` | ✅ | ─ | ─ | ─ | ─ | ─ | |
| [Baidu Qianfan (ERNIE)](https://qianfan.cloud.baidu.com) | `qianfan/` | `Beta` | ✅ | ✅ | ─ | ─ | ─ | ─ | Image/TTS/STT planned |
| [Tencent Hunyuan](https://hunyuan.tencent.com) | `hunyuan/` | `Beta` | ✅ | ✅ | ─ | ─ | ─ | ─ | Image/Video/TTS/STT planned |
| [iFlytek Spark](https://xinghuo.xfyun.cn) | `spark/` | `Beta` | ✅ | ─ | ─ | ─ | ─ | ─ | TTS/STT planned |
| [AWS Bedrock](https://aws.amazon.com/bedrock) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Embed/Image |
| [Cohere](https://cohere.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Embed |
| [Together AI](https://together.ai) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Embed/Image |
| [Replicate](https://replicate.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Image/Video |
| [ElevenLabs](https://elevenlabs.io) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: TTS/STT |
| [Baichuan AI](https://www.baichuan-ai.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Embed |
| [Yi (01.AI)](https://www.01.ai) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text |
| [Step AI](https://www.stepfun.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text/Image/Video |
| [Perplexity AI](https://perplexity.ai) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Text |
| [Stability AI](https://stability.ai) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Image/Video |
| [AssemblyAI](https://assemblyai.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: STT |
| [Runway](https://runwayml.com) | `TBD` | `Planned` | ─ | ─ | ─ | ─ | ─ | ─ | Planned: Video |

¹ **OpenAI-Compatible** — bring-your-own endpoint: Ollama, vLLM, LM Studio, LiteLLM, Xinference, etc.

## Quickstart

Prerequisites: Go `1.24+`, Node.js `24+`, pnpm `10+`.

### 1. Start Runtime

```bash
cd runtime
go run ./cmd/nimi serve
```

### 2. Check Health

```bash
cd runtime
go run ./cmd/nimi health --source grpc
```

Expected: command exits with code `0` and reports runtime health/status.

### 3. Run Your First AI Call

```bash
cd runtime
go run ./cmd/nimi run local/qwen2.5 --prompt "Hello, Nimi!"
```

Expected: runtime returns generated text.

### Optional SDK Quick Path

```bash
npx tsx examples/sdk/sdk-quickstart.ts
```

### Optional TypeScript Snippet

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

### Optional Vercel AI SDK Snippet

```ts
import { Runtime } from '@nimiplatform/sdk';
import { createNimiAiProvider } from '@nimiplatform/sdk/ai-provider';
import { generateText } from 'ai';

const runtime = new Runtime({
  appId: 'my_app',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
});

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

console.log(text);
```

### Optional Realm Snippet (Requires Realm Account)

```ts
import { Realm } from '@nimiplatform/sdk';

const guestRealm = new Realm({
  baseUrl: process.env.NIMI_REALM_BASE_URL || 'https://api.nimi.xyz',
  auth: { accessToken: Realm.NO_AUTH },
});

const tokens = await guestRealm.auth.passwordLogin({
  email: process.env.NIMI_REALM_EMAIL || '',
  password: process.env.NIMI_REALM_PASSWORD || '',
});

const realm = new Realm({
  baseUrl: process.env.NIMI_REALM_BASE_URL || 'https://api.nimi.xyz',
  auth: {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || undefined,
  },
});

const me = await realm.users.me();
console.log(me.id);
```

> Full onboarding and environment setup: [docs/getting-started/index.md](docs/getting-started/index.md)

## Realm Interconnect Paradigm (No More App Islands)

Most ecosystems can scale the number of apps, but still fail to connect them semantically.
Each app becomes its own island: identity does not carry, relationships break, context resets, and economic behaviors cannot be reconciled across boundaries.

Nimi positions `Realm` as a shared semantic layer for cross-app continuity, while preserving app autonomy.
Apps can choose progressive integration levels (`runtime-only`, `render-app`, `extension-app`) instead of all-or-nothing adoption.

The six protocol primitives (`Timeflow`, `Social`, `Economy`, `Transit`, `Context`, `Presence`) are the interoperability contract that keeps cross-app behavior consistent and auditable.
The goal is not centralized product control; the goal is consistent semantics across independently built worlds and apps.

Learn more:

- Realm interconnect narrative: [`docs/architecture/realm-interconnect-paradigm.md`](docs/architecture/realm-interconnect-paradigm.md)
- Spec thin mapping: [`spec/realm/app-interconnect-model.md`](spec/realm/app-interconnect-model.md)
- Protocol contracts: [`spec/platform/protocol.md`](spec/platform/protocol.md)

## New Agent Security Paradigm (What Nimi Is Trying to Solve)

Most agent systems still rely on "human-like operation" (clicking UI, imitating user workflows, api for human programs).  
That can be fast for demos, but it becomes fragile in production: boundaries blur, permissions over-expand, and audit trails become hard to trust.

Nimi is testing a different path: **AI-native interface calling**.  
Instead of acting like a fake human, the agent calls explicit machine interfaces with structured parameters, scoped permissions, and deterministic failure semantics.

In practice, this means:

- **Sandboxed execution** by default (especially for extension/mod capabilities).
- **Least-privilege grants** that are local, scoped, time-bound, and revocable.
- **Fail-close for high-risk writes** when authorization or execution certainty is missing.
- **End-to-end auditable traces** (`trace_id`, principal, operation, reason code) across layers.

This is Nimi's core attempt: keep the openness and speed of agent ecosystems, while making security and governance first-class system properties instead of afterthought patches.

Learn more:

- Full whitepaper: [`docs/architecture/ai-agent-security-interface.md`](docs/architecture/ai-agent-security-interface.md)
- Spec mapping: [`spec/platform/ai-agent-security-interface.md`](spec/platform/ai-agent-security-interface.md)

## AI Coding in Nimi

Nimi applies a Spec-first, AI-first engineering methodology where AI agents are primary executors and deterministic guards are the default safety net.

- **Execution protocol:** every normative change follows `Rule -> Table -> Generate -> Check -> Evidence`.
- **Fact governance:** rules and structured tables are the canonical source; generated docs are projections, not edit targets.
- **Quality guard:** deterministic CI checks are Layer 1, semantic audit is Layer 2, and both are used in a bi-directional audit loop (`Spec -> Impl` and `Impl -> Spec`).
- **Engineering outcome:** changes stay traceable, verifiable, and regression-resistant under continuous AI-assisted delivery.

Method details: [ai_spec_coding_methodology.md](docs/architecture/ai_spec_coding_methodology.md)

## Roadmap

- [Open feature requests](https://github.com/nimiplatform/nimi/issues?q=is%3Aissue%20is%3Aopen%20label%3Afeature)
- [Open enhancements](https://github.com/nimiplatform/nimi/issues?q=is%3Aissue%20is%3Aopen%20label%3Aenhancement)
- [Provider expansion plan](docs/reference/provider-matrix.md#cloud-providers)
- [Release process](RELEASE.md)

## Contribute

Start here:

- [good-first-issue](https://github.com/nimiplatform/nimi/issues?q=is%3Aissue%20is%3Aopen%20label%3Agood-first-issue)
- [help-wanted](https://github.com/nimiplatform/nimi/issues?q=is%3Aissue%20is%3Aopen%20label%3Ahelp-wanted)
- [docs tasks](https://github.com/nimiplatform/nimi/issues?q=is%3Aissue%20is%3Aopen%20label%3Adocs)

Policies and workflow:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [ONBOARDING.md](ONBOARDING.md)
- [TESTING.md](TESTING.md)
- [GOVERNANCE.md](GOVERNANCE.md)

## Community And Trust

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [GitHub Releases](https://github.com/nimiplatform/nimi/releases)
- [CI Workflows](https://github.com/nimiplatform/nimi/actions/workflows/ci.yml)
- [DCO](DCO)

## License

| License | Scope |
|---|---|
| [Apache-2.0](licenses/Apache-2.0.txt) | runtime, sdk, proto |
| [MIT](licenses/MIT.txt) | desktop, web, mods |
| [CC-BY-4.0](licenses/CC-BY-4.0.txt) | docs, spec |

## Learn More

| Resource | Description |
|---|---|
| [Getting Started](docs/getting-started/index.md) | Zero to first AI call |
| [SDK Reference](docs/reference/sdk.md) | `@nimiplatform/sdk` API surface |
| [Runtime Guide](runtime/README.md) | Runtime CLI and daemon operations |
| [Protocol](spec/platform/protocol.md) | Six primitives: Timeflow, Social, Economy, Transit, Context, Presence |
| [Architecture](spec/platform/architecture.md) | Six-layer platform architecture contract |
| [Mod Developer Guide](docs/guides/mod-developer.md) | Build desktop extensions |
| [Vision](VISION.md) | Platform direction |
