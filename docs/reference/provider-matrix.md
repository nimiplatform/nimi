# Provider Matrix

Nimi Runtime routes AI requests through a unified API.
Use this page as the single source for provider capability coverage and rollout status.

## Status Legend

- `GA`: available now for production usage in current runtime contracts
- `Beta`: available now with limited or policy-gated modalities
- `Planned`: tracked for future delivery, not available in current runtime contracts

## Capability Legend

- `✅` available now
- `-` not available in current runtime contract
- `🟡` planned

## Local Engines

| Engine | SDK Prefix | Status | Text | Embed | Image | Video | TTS | STT | Notes |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| [LocalAI](https://localai.io) | `local/` | GA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full local multimodal routing |
| [Nexa](https://nexa.ai/) | `local/` | Beta | ✅ | ✅ | ✅ | - | ✅ | ✅ | Video intentionally blocked by `nexa.video.unsupported` (`AI_ROUTE_UNSUPPORTED`) |

## Cloud Providers

| Provider | SDK Prefix | Status | Text | Embed | Image | Video | TTS | STT | Notes |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| [OpenAI](https://openai.com) | `openai/` | GA | ✅ | ✅ | - | - | - | - | |
| [Anthropic](https://anthropic.com) | `anthropic/` | GA | ✅ | - | - | - | - | - | |
| [Google Gemini](https://ai.google.dev) | `gemini/` | GA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| [DeepSeek](https://deepseek.com) | `deepseek/` | GA | ✅ | - | - | - | - | - | |
| [OpenRouter](https://openrouter.ai) | `openrouter/` | GA | ✅ | - | - | - | - | - | |
| OpenAI-Compatible (BYO endpoint) | `openai_compatible/` | GA | ✅ | - | - | - | - | - | Supports Ollama, vLLM, LM Studio, LiteLLM, Xinference, and similar endpoints |
| [Alibaba DashScope](https://dashscope.aliyun.com) | `dashscope/` | GA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| [Volcengine ARK (Doubao)](https://www.volcengine.com/product/ark) | `volcengine/` | GA | ✅ | ✅ | ✅ | ✅ | - | - | |
| [Volcengine OpenSpeech](https://www.volcengine.com/product/speech) | `volcengine_openspeech/` | GA | - | - | - | - | ✅ | ✅ | |
| [MiniMax](https://www.minimax.chat) | `minimax/` | GA | ✅ | - | ✅ | ✅ | ✅ | ✅ | |
| [Kimi (Moonshot)](https://kimi.ai) | `kimi/` | GA | ✅ | - | ✅ | - | ✅ | ✅ | |
| [GLM (Zhipu)](https://open.bigmodel.cn) | `glm/` | GA | ✅ | - | ✅ | ✅ | ✅ | ✅ | |
| [Azure OpenAI](https://azure.microsoft.com/products/ai-services/openai-service) | `azure/` | GA | ✅ | ✅ | - | - | - | - | |
| [Mistral AI](https://mistral.ai) | `mistral/` | GA | ✅ | ✅ | - | - | - | - | |
| [Groq](https://groq.com) | `groq/` | Beta | ✅ | - | - | - | - | 🟡 | STT planned |
| [xAI (Grok)](https://x.ai) | `xai/` | GA | ✅ | - | - | - | - | - | |
| [Baidu Qianfan (ERNIE)](https://qianfan.cloud.baidu.com) | `qianfan/` | Beta | ✅ | ✅ | 🟡 | - | 🟡 | 🟡 | |
| [Tencent Hunyuan](https://hunyuan.tencent.com) | `hunyuan/` | Beta | ✅ | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | |
| [iFlytek Spark](https://xinghuo.xfyun.cn) | `spark/` | Beta | ✅ | - | - | - | 🟡 | 🟡 | |
| [AWS Bedrock](https://aws.amazon.com/bedrock) | `TBD` | Planned | 🟡 | 🟡 | 🟡 | - | - | - | |
| [Cohere](https://cohere.com) | `TBD` | Planned | 🟡 | 🟡 | - | - | - | - | |
| [Together AI](https://together.ai) | `TBD` | Planned | 🟡 | 🟡 | 🟡 | - | - | - | |
| [Replicate](https://replicate.com) | `TBD` | Planned | 🟡 | - | 🟡 | 🟡 | - | - | |
| [ElevenLabs](https://elevenlabs.io) | `TBD` | Planned | - | - | - | - | 🟡 | 🟡 | |
| [Baichuan AI](https://www.baichuan-ai.com) | `TBD` | Planned | 🟡 | 🟡 | - | - | - | - | |
| [Yi (01.AI)](https://www.01.ai) | `TBD` | Planned | 🟡 | - | - | - | - | - | |
| [Step AI](https://www.stepfun.com) | `TBD` | Planned | 🟡 | - | 🟡 | 🟡 | - | - | |
| [Perplexity AI](https://perplexity.ai) | `TBD` | Planned | 🟡 | - | - | - | - | - | |
| [Stability AI](https://stability.ai) | `TBD` | Planned | - | - | 🟡 | 🟡 | - | - | |
| [AssemblyAI](https://assemblyai.com) | `TBD` | Planned | - | - | - | - | - | 🟡 | |
| [Runway](https://runwayml.com) | `TBD` | Planned | - | - | - | 🟡 | - | - | |

## Validation In Your Environment

```bash
cd runtime
go run ./cmd/nimi providers --source grpc
```

Runnable provider examples: [examples/sdk/providers/](../../examples/sdk/providers/)
