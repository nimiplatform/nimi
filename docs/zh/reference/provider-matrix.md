# Provider 矩阵

Nimi Runtime 通过统一 API 路由 AI 请求。
本页面是 Provider 能力覆盖范围和上线状态的唯一参考来源。

入门和快速开始请使用高层目标选择接口：

- `nimi run "<prompt>"` 使用本地默认文本目标
- `nimi run "<prompt>" --provider <provider>` 指定 Provider 的云端目标
- `nimi run "<prompt>" --cloud` 使用已保存的机器默认云端目标

本矩阵记录了底层 runtime 和 SDK 接口暴露的高级 Provider 限定前缀。

## 状态图例

- `GA`：当前 runtime 契约中可用于生产环境
- `Beta`：当前可用，但模态受限或受策略门控
- `Planned`：已列入未来交付计划，当前 runtime 契约中不可用

## 能力图例

- `✅` 当前可用
- `-` 当前 runtime 契约中不可用
- `🟡` 已规划

## 本地引擎

| 引擎 | SDK 前缀 | 状态 | Text | Embed | Image | Video | TTS | STT | 备注 |
|---|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|
| [LocalAI](https://localai.io) | `local/` | GA | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full local multimodal routing |
| [Nexa](https://nexa.ai/) | `local/` | Beta | ✅ | ✅ | ✅ | - | ✅ | ✅ | Video intentionally blocked by `nexa.video.unsupported` (`AI_ROUTE_UNSUPPORTED`) |
| Nimi Media | `nimi_media/` | GA | - | - | ✅ | ✅ | - | - | Nimi 受管 diffusers 引擎，支持本地图像 (FLUX) 和视频 (Wan2.1) 生成 |

## 云端 Provider

| Provider | SDK 前缀 | 状态 | Text | Embed | Image | Video | TTS | STT | 备注 |
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

## 在你的环境中验证

```bash
nimi provider list
nimi doctor
nimi provider test gemini
nimi run "Hello from Nimi" --provider gemini
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
nimi run "Hello from Nimi" --cloud
```

可运行的 Provider 示例：[examples/sdk/providers/](../../../examples/sdk/providers/)
