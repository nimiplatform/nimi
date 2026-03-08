<div align="center">

  # 🪸 Nimi: The Last Mile from AI to Users

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

Nimi is the last-mile infrastructure that turns model capability into reliable product behavior.

Developers run multimodal AI across local and cloud Runtime, while Realm keeps identity, memory, and governance consistent across apps.

> Interconnected AI apps building shared worlds with a unified, Ready Player One-like user experience (vision)

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

Nimi focuses on three practical delivery gaps:

| Last-Mile Gap | What Usually Breaks | Nimi Approach |
|---|---|---|
| Execution reliability | route/model/provider behavior drifts across environments | Runtime enforces explicit route policy (`local` / `cloud`) with reason-coded failures |
| Identity and context continuity | every app starts from zero user context | Realm provides persistent identity, world state, and memory across apps |
| Governance and trust | hard to audit who called what and why | end-to-end traces (`trace_id`, principal, reason code), scoped grants, fail-close defaults |

Most AI apps today are islands.
Nimi's longer-term goal is to make them interoperable worlds where user identity, agent memory, and application semantics can move across boundaries.

This is the "Ready Player One" narrative with system constraints:

- interoperability is contract-driven (not ad-hoc glue)
- app autonomy remains intact (no forced centralization)
- cross-app behavior stays auditable and governable

Core protocol primitives: `Timeflow`, `Social`, `Economy`, `Transit`, `Context`, `Presence`.

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
- **How it routes:** `local` for on-device engines (LocalAI/Nexa), `cloud` for cloud providers.
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
| [landing](apps/landing/README.md) | Independent static landing site | React 19, Vite |
| [mods](nimi-mods/) | Desktop extensions | TypeScript |
| [proto](proto/README.md) | gRPC service contracts | Protobuf, Buf CLI |
| [spec](spec/INDEX.md) | Normative platform contracts | Markdown, YAML |
| [docs](docs/index.md) | External developer portal | VitePress, Markdown |

## Supported Models & Providers

Representative capabilities available now:

| Route Plane | Representative Backends | Typical Use |
|---|---|---|
| `local` | LocalAI, Nexa | local-first inference and media generation |
| `cloud` | Gemini, OpenAI, Anthropic, DeepSeek, MiniMax, GLM, Kimi, DashScope, Volcengine | cloud model access under one routing contract |

<details>
<summary>Full provider matrix</summary>

### Local (On-Device)

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

¹ OpenAI-Compatible means bring-your-own endpoint: Ollama, vLLM, LM Studio, LiteLLM, Xinference, etc.

</details>

## Quickstart

Prerequisites: Go `1.24+`, Node.js `24+`, pnpm `10+`.

### 0. Install Dependencies

```bash
pnpm install
```

### 1. Start Runtime (Terminal A)

```bash
pnpm runtime:serve
```

### 2. Path A - Observe State (No model required)

In Terminal B:

```bash
pnpm runtime:health
pnpm runtime:providers
npx tsx examples/sdk/sdk-quickstart.ts
```

Expected:

- runtime health/status is printed
- provider snapshot is printed
- quickstart reports model inventory and exits gracefully when no model is ready

### 3. Path B - Produce Output (Choose one)

Option 1: local model route

```bash
cd runtime
go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json
cd ..
npx tsx examples/sdk/last-mile-route-switch.ts
```

Option 2: cloud provider route (example: Gemini)

```bash
cd runtime
NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=<your-key> \
go run ./cmd/nimi serve
```

Then run in another terminal:

```bash
npx tsx examples/sdk/last-mile-route-switch.ts
```

### 4. Troubleshooting

| Error | Meaning | Exact Next Step |
|---|---|---|
| `AI_LOCAL_MODEL_UNAVAILABLE` | local model is not ready | `cd runtime && go run ./cmd/nimi model pull --model-ref local/qwen2.5@latest --source official --json` |
| `AI_REQUEST_CREDENTIAL_INVALID` | runtime process has no valid provider credentials | set provider env vars on runtime startup command, then restart runtime |
| `AI_PROVIDER_AUTH_FAILED` | provider rejected current auth config | verify API key + endpoint + provider health (`pnpm runtime:providers`) |

## Security and Governance

Nimi uses an AI-native interface calling model with explicit machine interfaces, scoped permissions, and deterministic failure semantics.

- sandboxed execution by default for high-risk capability surfaces
- least-privilege grants with revocation and delegation boundaries
- fail-close behavior for uncertain high-risk writes
- end-to-end auditability across runtime layers

Details:

- [AI Agent Security Interface](docs/architecture/ai-agent-security-interface.md)
- [Spec mapping](spec/platform/ai-agent-security-interface.md)

## Engineering Method

Nimi applies Spec-first, AI-first engineering with deterministic checks.

- execution protocol: `Rule -> Table -> Generate -> Check -> Evidence`
- generated docs are projections; structured rules stay canonical
- CI deterministic checks + semantic audits form a bidirectional loop

Details: [ai_spec_coding_methodology.md](docs/architecture/ai_spec_coding_methodology.md)

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
| [Getting Started](docs/getting-started/index.md) | Zero to first verifiable run |
| [Examples](examples/README.md) | Goal-oriented runnable examples |
| [SDK Reference](docs/reference/sdk.md) | `@nimiplatform/sdk` API surface |
| [Runtime Guide](runtime/README.md) | Runtime CLI and daemon operations |
| [Protocol](spec/platform/protocol.md) | Six primitives: Timeflow, Social, Economy, Transit, Context, Presence |
| [Architecture](spec/platform/architecture.md) | Six-layer platform architecture contract |
| [Mod Developer Guide](docs/guides/mod-developer.md) | Build desktop extensions |
| [Vision](VISION.md) | Platform direction |
