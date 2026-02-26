# 火山引擎（Volcengine）完整接入规格

> 调研日期：2026-02-25
> 目标：为 nimi-runtime 提供火山引擎全模态 AI 能力支持
> 精度：对接时直接参考本文档，无需回查官方文档

---

## 1. 双体系 API 总览

火山引擎 AI API 分两套独立体系，**鉴权、域名、协议完全不同**：

| 体系 | 域名 | 协议 | 覆盖能力 |
|------|------|------|----------|
| **方舟平台**（OpenAI 兼容） | `ark.cn-beijing.volces.com` | HTTPS REST + SSE | LLM / Embedding / 图片生成 / 视频生成 |
| **豆包语音**（字节自有） | `openspeech.bytedance.com` | HTTP + WebSocket 二进制 | TTS / ASR / 声音复刻 / 同声传译 |

---

## 2. 方舟平台 — 鉴权与通用规则

### 2.1 Base URL

```
https://ark.cn-beijing.volces.com/api/v3
```

国际版（BytePlus）：`https://ark.ap-southeast.byteplus.com/api/v3`

### 2.2 鉴权

```http
Authorization: Bearer {ARK_API_KEY}
Content-Type: application/json
```

API Key 格式为 UUID，在火山引擎控制台 → 方舟平台 → API Key 管理中创建。

### 2.3 模型标识：Endpoint ID vs 模型名直调

方舟有两种模型标识方式：

| 方式 | 格式 | 说明 |
|------|------|------|
| **Endpoint ID** | `ep-20240101001122334455` | 用户在控制台创建"推理接入点"后获得，绑定特定模型版本 |
| **模型名直调** | `doubao-seed-2-0-pro-260215` | 无需创建接入点，直接用模型 ID 调用（部分模型支持） |

`model` 参数填写 Endpoint ID 或模型名均可。nimi-runtime 需兼容两种。

### 2.4 路径拼接规则

现有 `openAIBackend` 的 `baseURL` 设为 `https://ark.cn-beijing.volces.com/api/v3`，然后拼接：

| 能力 | 拼接路径 | 完整 URL |
|------|----------|----------|
| Chat | `/chat/completions` | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| Embeddings | `/embeddings` | `https://ark.cn-beijing.volces.com/api/v3/embeddings` |
| 图片生成 | `/images/generations` | `https://ark.cn-beijing.volces.com/api/v3/images/generations` |
| 视频任务创建 | `/contents/generations/tasks` | `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks` |
| 视频任务查询 | `/contents/generations/tasks/{id}` | `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}` |

**关键**：`openAIBackend` 默认拼接 `/v1/chat/completions`，需确保不重复拼接路径前缀。如果 baseURL 已包含 `/api/v3`，则只需拼接 `/chat/completions`。

---

## 3. LLM — 完整模型矩阵与定价

### 3.1 Doubao Seed 2.0 系列（主推，2026-02-14 发布）

> Seed 2.0 是当前主推系列，全系支持文本 / 图片 / 视频输入 → 文本输出，OpenAI SDK 完全兼容。

| 模型 ID（API 调用名） | 定位 | 上下文 | 最大输出 | Function Calling | Vision | Video | 推理档位 |
|------------------------|------|--------|----------|-----------------|--------|-------|----------|
| `doubao-seed-2-0-pro-260215` | 旗舰全能 | 256K | 128K | ✅ | ✅ | ✅ | — |
| `doubao-seed-2-0-lite-260215` | 均衡生产 | 256K | 128K | ✅ | ✅ | ✅ | — |
| `doubao-seed-2-0-mini-260215` | 低延迟高并发 | 256K | 128K | ✅ | ✅ | ✅ | 4 档 |
| `doubao-seed-2-0-code-preview-260215` | 编程专精 | 256K | 128K | ✅ | ✅ | ✅ | — |

**Mini 推理档位（`reasoning_effort`）**：通过 `extra_body` 传递，不影响现有接口

| 值 | 含义 | 质量 | Token 消耗 |
|----|------|------|-----------|
| `minimal` | 无推理 | ~85% | ~1/10 |
| `low` | 轻度推理 | ~90% | ~1/5 |
| `medium` | 中度推理 | ~95% | ~1/2 |
| `hi` | 深度推理 | 100% | 基准 |

**Vision 图片质量**：`detail` 参数支持 `low` / `high`（默认）/ `xhigh`

### 3.2 Doubao Seed 1.6 系列（仍可用，未下线）

| 模型 ID（API 调用名） | 类型 | 上下文 | 最大输入 | 最大输出 | Function Calling | Vision |
|------------------------|------|--------|----------|----------|-----------------|--------|
| `doubao-seed-1-6-251015` | 旗舰文本 | 256K | 224K | 64K | ✅ | ❌ |
| `doubao-seed-1-6-thinking-250715` | 深度推理 | 256K | 224K | 64K | ✅ | ❌ |
| `doubao-seed-1-6-vision-250815` | 多模态 | 256K | 224K | 64K | ✅ | ✅ |
| `doubao-seed-1-6-lite-250614` | 轻量 | 128K | 112K | 16K | ✅ | ❌ |
| `doubao-seed-1-6-flash-250828` | 极速 | 256K | 224K | 16K | ✅ | ✅ |
| `doubao-seed-code-250628` | 代码 | 256K | 224K | 32K | ✅ | ✅ |
| `doubao-seed-translation-250615` | 翻译 | 128K | 112K | 16K | ❌ | ❌ |

### 3.3 第三方托管模型

| 模型 ID | 来源 | 上下文 | 最大输出 |
|---------|------|--------|----------|
| `deepseek-v3-1-250528` | DeepSeek | 64K | 8K |
| `deepseek-r1-250120` | DeepSeek | 64K | 8K |
| `kimi-k2-0711` | Moonshot | 128K | 8K |

### 3.4 定价（CNY / 百万 tokens，按量后付费）

**Doubao Seed 2.0 系列**（≤32K 输入档）：

| 模型 | 输入价格 | 输出价格 | 缓存命中 |
|------|---------|---------|----------|
| **Pro** | ¥3.2 | ¥16 | ¥0.64 |
| **Lite** | ¥0.6 | ¥3.6 | ¥0.12 |
| **Mini** | ¥0.2 | ¥2.0 | ¥0.04 |
| **Code** | ¥3.2 | ¥16 | ¥0.64 |

**Seed 2.0 分档计费**（以 Pro 为例，Lite/Mini 同比例）：

| 输入长度档位 | 输入价格 | 输出价格 | 缓存命中 |
|-------------|---------|---------|----------|
| ≤ 32K | ¥3.2 | ¥16 | ¥0.64 |
| 32K — 128K | ¥4.8 | ¥24 | ¥0.64 |
| 128K — 256K | ¥9.6 | ¥48 | ¥0.64 |

**缓存存储**：¥0.014/百万 tokens/小时

**Doubao Seed 1.6 系列定价**（含 seed/thinking/flash/vision）：

| 输入长度档位 | 输入价格 | 输出价格 |
|-------------|---------|---------|
| ≤ 32K | ¥0.8 | ¥8.0 |
| 32K — 128K | ¥1.2 | ¥16.0 |
| 128K — 256K | ¥2.4 | ¥24.0 |

**Prompt Caching**：缓存命中的 input tokens 享 **80% 折扣**（2.0 系列已在定价表中单列缓存命中价）。

### 3.5 Chat Completions API — 完整参数

**Endpoint**: `POST {baseURL}/chat/completions`

**请求体**（全量参数）:

```jsonc
{
  // 必填
  "model": "doubao-seed-2-0-pro-260215",  // 或 Endpoint ID "ep-xxx"，或旧版 "doubao-seed-1-6-251015"
  "messages": [
    {"role": "system", "content": "系统提示"},
    {"role": "user", "content": "用户输入"},
    // Vision 场景：
    {"role": "user", "content": [
      {"type": "text", "text": "描述这张图片"},
      {"type": "image_url", "image_url": {"url": "https://... 或 data:image/png;base64,..."}}
    ]}
  ],

  // 生成控制（可选）
  "temperature": 0.7,           // 0-2，默认 0.7
  "top_p": 0.9,                 // 0-1，默认 0.9
  "max_tokens": 4096,           // 最大输出 tokens
  "frequency_penalty": 0.0,     // -2.0 到 2.0
  "presence_penalty": 0.0,      // -2.0 到 2.0
  "stop": ["<stop>"],           // 停止序列

  // 流式
  "stream": true,
  "stream_options": {"include_usage": true},  // 流式时在最后一个 chunk 返回 usage

  // 结构化输出
  "response_format": {"type": "json_object"},  // 强制 JSON 输出

  // Function Calling
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "获取天气",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {"type": "string", "description": "城市名"}
        },
        "required": ["city"]
      }
    }
  }],
  "tool_choice": "auto"  // "auto" | "none" | {"type":"function","function":{"name":"xxx"}}
}
```

**非流式响应**:

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1700000000,
  "model": "doubao-seed-2-0-pro-260215",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "回答内容",
      "tool_calls": [{
        "id": "call_xxx",
        "type": "function",
        "function": {"name": "get_weather", "arguments": "{\"city\":\"北京\"}"}
      }]
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 100,
    "total_tokens": 150
  }
}
```

**流式响应**（SSE）:

```
data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":50,"completion_tokens":2,"total_tokens":52}}

data: [DONE]
```

**finish_reason 值**：`stop` | `length` | `tool_calls` | `content_filter`

### 3.6 Function Calling 多轮流程

```
第1轮请求 → messages: [system, user]
第1轮响应 → finish_reason: "tool_calls", tool_calls: [{id, name, arguments}]

第2轮请求 → messages: [system, user, assistant(with tool_calls), {role:"tool", tool_call_id:"call_xxx", content:"工具返回结果"}]
第2轮响应 → finish_reason: "stop", content: "最终回答"
```

### 3.7 推理控制

**Seed 2.0 Mini**：通过 `reasoning_effort` 参数（见 §3.1），传递方式：

```python
# OpenAI SDK 示例
client.chat.completions.create(
    model="doubao-seed-2-0-mini-260215",
    messages=[...],
    extra_body={"reasoning_effort": "medium"}
)
```

**Seed 1.6 Thinking 模式**（仍可用）：

- **思考模式**：模型先输出思考链再输出最终回答
- **非思考模式**：直接输出回答（默认）
- **自适应模式**：模型自动判断是否需要思考

### 3.8 与 OpenAI API 差异汇总

| 项 | OpenAI | 方舟 | 对接影响 |
|----|--------|------|----------|
| Base URL 路径 | `/v1/` | `/api/v3/` | 配置 baseURL 时注意 |
| 模型标识 | 模型名 `gpt-4o` | Endpoint ID `ep-xxx` 或模型名 | 需兼容两种格式 |
| Prompt Caching | 自动 | 需显式启用 `context_cache` 参数 | 可选优化 |
| Thinking 模式 | 无 | 额外参数 | 透传即可 |
| 区域 | 全球 | 仅 cn-beijing（国际版 BytePlus 另域） | 国内用户无影响 |
| response_format | `json_object` / `json_schema` | `json_object` 已支持 | 兼容 |
| Vision 输入 | content array 含 image_url | 同 OpenAI 格式 | 完全兼容 |

---

## 4. Embedding — 完整规格

### 4.1 模型

| 模型 ID | 维度 | 最大输入 | 语言 | 定价（¥/百万tokens） |
|---------|------|---------|------|---------------------|
| `doubao-embedding-large-250401` | 4096 | 4K tokens | 中/英 | ¥0.7 |
| `doubao-embedding-vision-250328` | 2048 | 4K tokens + 图片 | 中/英 | ¥0.7 |

### 4.2 API

**Endpoint**: `POST {baseURL}/embeddings`

**请求体**:
```json
{
  "model": "doubao-embedding-large-250401",
  "input": ["天很蓝", "海很深"],
  "encoding_format": "float"
}
```

**响应体**:
```json
{
  "id": "emb-xxx",
  "object": "list",
  "created": 1700000000,
  "model": "doubao-embedding-large-250401",
  "data": [
    {"index": 0, "object": "embedding", "embedding": [0.0123, -0.0456, ...]},
    {"index": 1, "object": "embedding", "embedding": [0.0789, -0.0012, ...]}
  ],
  "usage": {"prompt_tokens": 8, "total_tokens": 8}
}
```

**注意**：检索场景中 query 建议添加 instruction 前缀（如 `"为这个句子生成表示以用于检索相关段落: "` + query），保证检索效果。

---

## 5. 图片生成 — Seedream 完整规格

### 5.1 模型

| 模型 ID | 版本 | 定价 | 特点 |
|---------|------|------|------|
| `doubao-seedream-5-0-lite-260128` | **5.0 Lite（主推）** | ~¥0.10/张 | 视觉推理生图、联网检索、精准风格迁移、高阶编辑 |
| `doubao-seedream-4-5-251128` | 4.5 | ¥0.14/张 | 稳定版，高质量 |
| `doubao-seedream-4-0-250828` | 4.0 | ¥0.14/张 | 基线版 |

> Seedream 5.0 Lite 是首个支持**联网实时检索**和**深度推理**的图片生成模型。
> 相比 4.5 新增：视觉推理生图、信息可视化、精准风格迁移（单图参考即可）、复杂多主体生成。
> API 向后兼容——仅需将 `model` 参数从 `doubao-seedream-4-5-251128` 替换为 `doubao-seedream-5-0-lite-260128`。

### 5.2 API

**Endpoint**: `POST {baseURL}/images/generations`

**完整请求参数**:

```jsonc
{
  // 必填
  "model": "doubao-seedream-5-0-lite-260128",  // 或 Endpoint ID，或旧版 "doubao-seedream-4-5-251128"
  "prompt": "一只穿着太空服的猫在月球上散步, 写实摄影风格",

  // 可选
  "image": ["https://example.com/ref1.jpg"],  // 参考图 URL 数组（图生图），最多 10 张
  "size": "2K",                    // "1K" | "2K" | "4K" | 自定义如 "2560x1440"
  "response_format": "url",        // "url"（JPEG 链接，24h 有效）| "b64_json"
  "seed": -1,                      // [-1, 2147483647]，-1=随机
  "watermark": false,              // 添加"AI 生成"水印
  "stream": false,                 // 流式输出（逐张返回）

  // 组图生成
  "sequential_image_generation": "auto",  // "auto" | "disabled"
  "sequential_image_generation_options": {
    "max_images": 4               // 1-15，默认 15
  }
}
```

**响应体**:
```json
{
  "model": "doubao-seedream-5-0-lite-260128",
  "created": 1726051200,
  "data": [
    {"url": "https://ark-xxx.tos-cn-beijing.volces.com/...", "revised_prompt": "优化后的提示词"}
  ],
  "usage": {"generated_images": 1}
}
```

**OpenAI 兼容性**：接口格式与 OpenAI Images API 完全兼容，`openAIBackend.generateImage()` 可直接使用。

---

## 6. 视频生成 — Seedance 完整规格

### 6.1 模型

| 模型 ID | 版本 | 分辨率 | 帧率 | 时长 | 定价 |
|---------|------|--------|------|------|------|
| `doubao-seedance-1-0-pro` | 1.0 Pro | 480p/720p/1080p | 24fps | 3-6s | ~¥3.67/5s视频 |
| `doubao-seedance-1-0-pro-fast` | 1.0 Pro Fast | 480p/720p/1080p | 24fps | 3-6s | ~¥1.03/5s视频 |
| `doubao-seedance-1-0-lite-t2v` | 1.0 Lite | 480p/720p | 24fps | 3-6s | 更低 |
| `seedance-2-0` | **2.0（主推）** | 720p/1080p/2K | 24fps | 4-15s | ~$0.10-$0.80/分钟（按分辨率） |

> Seedance 2.0 API 已于 2026-02-24 上线火山方舟。
> 相比 1.0：多模态音视频联合生成架构，支持文字 + 图片（最多 9 张）+ 视频（最多 3 段）+ 音频（最多 3 段）输入。
> 原生立体声 + 8 语种唇同步、多镜头叙事、视频编辑（片段/角色/动作定向修改）。

### 6.2 API — 异步任务模式

> 视频生成 **不是** 同步 API。必须：创建任务 → 轮询状态 → 取结果。
> 在 nimi-runtime 中走 `RuntimeWorkflowService` 单节点 DAG。

#### 6.2.1 创建任务

**Endpoint**: `POST {baseURL}/contents/generations/tasks`

**请求头**:
```http
Authorization: Bearer {ARK_API_KEY}
Content-Type: application/json
```

**文生视频**:
```json
{
  "model": "doubao-seedance-1-0-pro",
  "content": [
    {
      "type": "text",
      "text": "戴着帽子的老爷爷面带微笑往前走 --ratio 16:9 --fps 24 --dur 5"
    }
  ]
}
```

文本内 `--` 参数说明：

| 参数 | 说明 | 可选值 |
|------|------|--------|
| `--ratio` | 宽高比 | `16:9`, `9:16`, `4:3`, `3:4`, `21:9`, `1:1` |
| `--fps` | 帧率 | `24`（目前固定） |
| `--dur` | 时长（秒） | `2`-`12`（1.0）/ `4`-`15`（2.0） |

**图生视频**（首帧驱动）:
```json
{
  "model": "doubao-seedance-1-0-pro",
  "content": [
    {
      "type": "image_url",
      "image_url": {"url": "https://example.com/first-frame.jpg"}
    },
    {
      "type": "text",
      "text": "让画面中的人物缓缓走动 --ratio 16:9 --dur 5"
    }
  ]
}
```

**Seedance 2.0 多模态**（文本 + 多图 + 音频）:
```json
{
  "model": "seedance-2-0",
  "content": [
    {"type": "image_url", "image_url": {"url": "https://example.com/ref1.jpg"}},
    {"type": "image_url", "image_url": {"url": "https://example.com/ref2.jpg"}},
    {"type": "text", "text": "两个角色在海边对话 --ratio 16:9 --dur 10"},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/bgm.mp3"}}
  ]
}
```

**创建任务响应**:
```json
{"id": "cgt-20260225-xxxxxxxxxxxx"}
```

#### 6.2.2 查询任务

**Endpoint**: `GET {baseURL}/contents/generations/tasks/{task_id}`

**响应**（进行中）:
```json
{
  "id": "cgt-20260225-xxxxxxxxxxxx",
  "model": "doubao-seedance-1-0-pro",
  "status": "running"
}
```

**响应**（完成）:
```json
{
  "id": "cgt-20260225-xxxxxxxxxxxx",
  "model": "doubao-seedance-1-0-pro",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-xxx.tos-cn-beijing.volces.com/...",
    "cover_image_url": "https://...",
    "duration": 5.0
  },
  "usage": {...}
}
```

#### 6.2.3 列表查询

**Endpoint**: `GET {baseURL}/contents/generations/tasks?page_num=1&page_size=10`

#### 6.2.4 取消/删除任务

**Endpoint**: `DELETE {baseURL}/contents/generations/tasks/{task_id}`

#### 6.2.5 状态机

```
queued → running → succeeded
                 → failed
       → cancelled（用户取消）
```

#### 6.2.6 轮询策略建议

- 初始间隔 5s
- 指数退避至最大 30s
- 1.0 Pro 典型耗时 30-120s
- 2.0 典型耗时 60-300s

### 6.3 nimi-runtime 集成方案（WorkflowService 单节点 DAG）

```
SDK 调用: nimi.video('seedance-2.0').generate(prompt, options)
  ↓
SDK 内部构建 WorkflowDefinition:
  workflow_type: "ai.video.generate"
  nodes: [{
    node_id: "video-gen"
    node_type: "ai.generate_video"
    config: {
      provider: "bytedance"
      model_id: "seedance-2-0"
      prompt: "..."
      ratio: "16:9"
      fps: 24
      duration: 10
      reference_images: ["url1", "url2"]
    }
  }]
  ↓
SubmitWorkflow → task_id
SubscribeWorkflowEvents(task_id):
  → WORKFLOW_EVENT_STARTED
  → WORKFLOW_EVENT_NODE_STARTED  (node_id="video-gen")
  → WORKFLOW_EVENT_NODE_PROGRESS (progress_percent=30)
  → WORKFLOW_EVENT_NODE_COMPLETED
  → WORKFLOW_EVENT_COMPLETED     (payload.video_url="https://...")
```

workflow-worker 内部：
1. 解析 `node_type: "ai.generate_video"` + `config.provider: "bytedance"`
2. POST 创建火山任务 → 拿到 `cgt-xxx`
3. 轮询 GET 任务状态（5s 间隔，指数退避）
4. 映射 `queued/running → NODE_PROGRESS`，`succeeded → NODE_COMPLETED`
5. 下载视频或返回 URL

---

## 7. 语音合成 — 豆包 TTS 完整规格

> **体系隔离**：TTS 不走方舟平台，有独立的域名、鉴权和协议。

### 7.1 凭证体系

| 凭证 | 获取方式 | 用途 |
|------|----------|------|
| `appid` | 火山引擎控制台 → 语音技术 → 创建应用 | 应用标识 |
| `token` | 同上，应用详情页的 Access Token | 鉴权令牌 |
| `cluster` | 固定值 `volcano_tts` | 集群标识 |

### 7.2 HTTP 一次性合成

**Endpoint**: `POST https://openspeech.bytedance.com/api/v1/tts`

**请求头**:
```http
Authorization: Bearer;{TOKEN}
Content-Type: application/json
```

**注意**: `Bearer;` 后面没有空格，紧跟分号再跟 token（与标准 Bearer 格式不同）。

**完整请求体**:
```json
{
  "app": {
    "appid": "YOUR_APP_ID",
    "token": "YOUR_ACCESS_TOKEN",
    "cluster": "volcano_tts"
  },
  "user": {
    "uid": "user_001"
  },
  "audio": {
    "voice_type": "BV001_streaming",
    "encoding": "mp3",
    "speed_ratio": 1.0,
    "volume_ratio": 1.0,
    "pitch_ratio": 1.0,
    "emotion": "neutral",
    "language": "zh"
  },
  "request": {
    "reqid": "uuid-v4-unique-per-request",
    "text": "要合成的文本内容",
    "text_type": "plain",
    "operation": "query",
    "silence_duration": 0
  }
}
```

**参数详解**:

| 参数 | 类型 | 范围 | 说明 |
|------|------|------|------|
| `voice_type` | string | 见 §7.4 | 音色 ID |
| `encoding` | string | `pcm`/`wav`/`mp3`/`ogg_opus` | 输出格式 |
| `speed_ratio` | float | 0.8 — 2.0 | 语速，1.0 正常 |
| `volume_ratio` | float | 0.5 — 2.0 | 音量，1.0 正常 |
| `pitch_ratio` | float | 0.5 — 2.0 | 音调，1.0 正常 |
| `emotion` | string | 见 §7.5 | 情感标签 |
| `language` | string | `zh`/`en`/`ja`/`es-mx`/`id`/`pt-br` | 语言 |
| `silence_duration` | int | 0 — 300000 | 句尾静音（毫秒） |
| `text_type` | string | `plain`/`ssml` | 文本类型 |

**响应体**:
```json
{
  "reqid": "uuid-v4",
  "code": 3000,
  "message": "Success",
  "sequence": -1,
  "data": "<base64-encoded-audio-bytes>"
}
```

`code` 值：`3000` = 成功，其他 = 失败。

### 7.3 WebSocket 流式合成

**Endpoint**: `wss://openspeech.bytedance.com/api/v1/tts/ws_binary`

**二进制帧协议**:

```
客户端发送帧:
┌────────────┬──────────────┬──────────────────────────┐
│ Header 4B  │ Payload Len  │ Payload (gzip JSON)      │
│ 0x11101100 │ 4 bytes BE   │ gzip(json_config)        │
└────────────┴──────────────┴──────────────────────────┘

Header 字节含义:
  byte[0] = 0x11  (protocol version 1, header size 1*4=4 bytes)
  byte[1] = 0x10  (message type=full_client_request, flags=0)
  byte[2] = 0x11  (serialization=JSON, compression=gzip)
  byte[3] = 0x00  (reserved)
```

**服务端响应帧**:

| message_type (byte[1] 高4位) | 含义 |
|-----|------|
| `0xb` (1011) | 音频数据 |
| `0xf` (1111) | 错误 |

| flags (byte[1] 低4位) | 含义 |
|-----|------|
| `0` | 起始包（无音频数据） |
| 其他 | 含音频 payload |
| `3` | 最后一包，流结束 |

**JSON 配置（gzip 压缩后发送）**:
```json
{
  "app": {"appid": "xxx", "token": "xxx", "cluster": "volcano_tts"},
  "user": {"uid": "user_001"},
  "audio": {"voice_type": "BV001_streaming", "encoding": "pcm", "rate": 24000},
  "request": {"reqid": "uuid-v4", "text": "文本内容", "text_type": "plain", "operation": "submit"}
}
```

### 7.4 音色列表（常用）

**通用场景**:

| voice_type | 名称 | 性别 | 说明 |
|------------|------|------|------|
| `BV700_streaming` | 灿灿 | 女 | 通用，自然亲切 |
| `BV701_streaming` | 梓梓 | 女 | 通用，知性 |
| `BV001_streaming` | 通用女声 | 女 | 基础女声 |
| `BV002_streaming` | 通用男声 | 男 | 基础男声 |
| `BV700_V2_streaming` | 灿灿 V2 | 女 | 升级版 |
| `BV701_V2_streaming` | 梓梓 V2 | 女 | 升级版 |
| `BV001_V2_streaming` | 通用女声 V2 | 女 | 升级版 |
| `BV705_streaming` | 炀炀 | 男 | 阳光男声 |

**有声阅读**:

| voice_type | 名称 | 说明 |
|------------|------|------|
| `BV406_streaming` | 阳光青年 | 适合小说朗读 |
| `BV407_streaming` | 反卷青年 | 轻松风格 |
| `BV408_streaming` | 古风少御 | 古风风格 |

**智能助手**:

| voice_type | 名称 | 说明 |
|------------|------|------|
| `BV405_streaming` | 甜美小源 | 甜美可爱 |
| `BV034_streaming` | 知性女声 | 温柔知性 |

**视频配音**:

| voice_type | 名称 | 说明 |
|------------|------|------|
| `BV410_streaming` | 译制片男声 | 纪录片风格 |
| `BV411_streaming` | 清新文艺女声 | Vlog 风格 |

**方言**:

| voice_type | 名称 | 方言 |
|------------|------|------|
| `BV213_streaming` | 东北老铁 | 东北话 |
| `BV025_streaming` | 上海阿姨 | 上海话 |
| `BV421_streaming` | 广东靓仔 | 粤语 |

> 完整列表（70+ 种）：https://www.volcengine.com/docs/6561/1257584

### 7.5 情感标签

| 值 | 说明 |
|----|------|
| `neutral` | 中性（默认） |
| `happy` | 开心 |
| `sad` | 悲伤 |
| `angry` | 愤怒 |
| `fear` | 恐惧 |
| `hate` | 厌恶 |
| `surprise` | 惊讶 |

**注意**：情感效果因音色而异，部分音色不支持情感调节。

### 7.6 长文本异步合成

**创建任务**: `POST https://openspeech.bytedance.com/api/v1/tts_async/submit`
**查询结果**: `GET https://openspeech.bytedance.com/api/v1/tts_async/query?appid={appid}&task_id={task_id}`

- 最大 10 万字符
- 支持 `enable_subtitle` 参数开启句级/字词级/音素级时间戳
- 音频 URL 有效期 1 小时，结果保留 7 天
- 支持 HTTP 回调通知完成

### 7.7 nimi-runtime 集成方案

TTS 延迟低（首包 ~200ms），可走 `RuntimeAiService.SynthesizeSpeech`（同步流式 → `stream ArtifactChunk`）：

runtime 内部新增 `bytedanceTTSBackend`：
1. 建立 WebSocket → `wss://openspeech.bytedance.com/api/v1/tts/ws_binary`
2. 发送 gzip 压缩的 JSON 配置帧
3. 接收二进制音频帧 → 逐帧转为 `ArtifactChunk`
4. 收到 flags=3（最后一包）→ 设置 `eof=true`

---

## 8. 语音识别 — 豆包 ASR 完整规格

### 8.1 凭证体系

| 凭证 | 获取方式 |
|------|----------|
| `appid` | 火山引擎控制台 → 语音技术 → 创建应用 |
| `token` | 应用 Access Token |
| `access_key` | 控制台 Access Key |

### 8.2 流式 ASR — WebSocket 二进制协议

**Endpoint**: `wss://openspeech.bytedance.com/api/v2/asr`

**连接时请求头**:
```http
Authorization: Bearer;{TOKEN}
X-Api-Resource-Id: volc.bigasr.sauc.duration
X-Api-Access-Key: {ACCESS_KEY}
X-Api-App-Key: {APP_KEY}
X-Api-Request-Id: {UUID}
```

**Resource ID 选择**:

| 值 | 计费方式 |
|----|----------|
| `volc.bigasr.sauc.duration` | 按识别时长计费 |
| `volc.bigasr.sauc.concurrent` | 按并发路数计费 |

**二进制帧协议**:

```
帧结构（所有帧）:
┌──────────┬────────────┬──────────────────┬──────────────┐
│ Header   │ Reserved   │ Payload Length   │ Payload      │
│ 4 bytes  │ 4 bytes    │ 4 bytes (BE)     │ N bytes      │
└──────────┴────────────┴──────────────────┴──────────────┘

Header 4 字节:
  byte[0]: protocol_version(4bit) + header_size(4bit) = 0x11
  byte[1]: message_type(4bit) + message_type_flags(4bit)
  byte[2]: serialization(4bit) + compression(4bit)
  byte[3]: reserved = 0x00
```

**客户端消息类型**:

| message_type | 值 | 含义 |
|------|------|------|
| Full Client Request | `0x01` | 首包，JSON 配置 + 可选首段音频 |
| Audio Only Request | `0x02` | 后续音频包 |

**serialization**: `0x00` = raw, `0x01` = JSON
**compression**: `0x00` = none, `0x01` = gzip

**首包 JSON 配置**:
```json
{
  "user": {"uid": "user_001"},
  "audio": {
    "format": "pcm",
    "rate": 16000,
    "bits": 16,
    "channel": 1,
    "language": "zh-CN"
  },
  "request": {
    "model_name": "bigmodel",
    "enable_itn": true,
    "enable_punc": true,
    "result_type": "single"
  }
}
```

**音频发送规则**:
- PCM 格式，16000Hz，16bit，单声道
- 每帧 3200 字节（100ms 音频）
- 发送间隔 100ms
- 最后发送空音频帧表示结束

**服务端响应**:

| message_type | 值 | 含义 |
|------|------|------|
| Full Server Response | `0x09` (1001) | 识别结果 |
| Server Error | `0x0f` (1111) | 错误 |

**响应 JSON**:
```json
{
  "reqid": "xxx",
  "code": 1000,
  "message": "Success",
  "sequence": 1,
  "result": [{
    "text": "识别到的文字内容",
    "confidence": 0.95,
    "language": "zh-CN",
    "utterances": [{
      "text": "识别到的文字内容",
      "start_time": 0,
      "end_time": 3200,
      "definite": true
    }]
  }],
  "addition": {}
}
```

`code` 值：`1000` = 成功，`1001` = 部分结果，`1002` = 结束。

### 8.3 nimi-runtime 集成方案

ASR 走 `RuntimeAiService.TranscribeAudio`（unary RPC），runtime 内部管理 WebSocket：

runtime 内部新增 `bytedanceASRBackend`：
1. 收到 `TranscribeAudioRequest`（含 `audio_bytes` + `mime_type`）
2. 建立 WebSocket → `wss://openspeech.bytedance.com/api/v2/asr`
3. 发送首包（Full Client Request）含 JSON 配置
4. 将 audio_bytes 按 3200B/帧切分发送
5. 发送结束帧
6. 收集所有 `result[].text` 拼接为最终文本
7. 关闭 WebSocket
8. 返回 `TranscribeAudioResponse`

---

## 9. 与 nimi-runtime 集成总览

### 9.1 能力 → 服务 → 接口映射

| 能力 | nimi-runtime 服务 | API 层 | 火山接口 | 兼容性 |
|------|-------------------|--------|----------|--------|
| Chat | `RuntimeAiService.Generate` | openAIBackend | `/api/v3/chat/completions` | ✅ 直接兼容 |
| Streaming | `RuntimeAiService.StreamGenerate` | openAIBackend | SSE `/api/v3/chat/completions` | ✅ 直接兼容 |
| Function Calling | 同上 | openAIBackend | tools + tool_choice | ✅ 直接兼容 |
| Embedding | `RuntimeAiService.Embed` | openAIBackend | `/api/v3/embeddings` | ✅ 直接兼容 |
| 图片生成 | `RuntimeAiService.GenerateImage` | openAIBackend | `/api/v3/images/generations` | ✅ 直接兼容 |
| 视频生成 | `RuntimeWorkflowService` 单节点 DAG | 新增 workflow node executor | `/api/v3/contents/generations/tasks` | ⚠️ 需 workflow 适配 |
| TTS | `RuntimeAiService.SynthesizeSpeech` | 新增 bytedanceTTSBackend | `openspeech.bytedance.com` WS/HTTP | ❌ 需全新实现 |
| ASR | `RuntimeAiService.TranscribeAudio` | 新增 bytedanceASRBackend | `openspeech.bytedance.com` WS 二进制 | ❌ 需全新实现 |

### 9.2 环境变量配置

```bash
# 方舟平台（OpenAI 兼容部分）
NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
NIMI_RUNTIME_CLOUD_ADAPTER_BYTEDANCE_API_KEY=<ark-api-key>

# 豆包语音（TTS/ASR，独立凭证）
NIMI_RUNTIME_BYTEDANCE_SPEECH_APP_ID=<speech-app-id>
NIMI_RUNTIME_BYTEDANCE_SPEECH_TOKEN=<speech-access-token>
NIMI_RUNTIME_BYTEDANCE_SPEECH_ACCESS_KEY=<access-key>  # ASR 用
```

### 9.3 模型注册映射

**Seed 2.0 系列（主推）**：

| nimi model ID | 方舟模型 | Modal | 备注 |
|---------------|----------|-------|------|
| `bytedance/doubao-seed-2.0-pro` | `doubao-seed-2-0-pro-260215` | TEXT | 旗舰全能，文本/图片/视频输入 |
| `bytedance/doubao-seed-2.0-lite` | `doubao-seed-2-0-lite-260215` | TEXT | 均衡生产 |
| `bytedance/doubao-seed-2.0-mini` | `doubao-seed-2-0-mini-260215` | TEXT | 低延迟，4 档 reasoning_effort |
| `bytedance/doubao-seed-2.0-code` | `doubao-seed-2-0-code-preview-260215` | TEXT | 编程专精 |

**Seed 1.6 系列（仍可用）**：

| nimi model ID | 方舟模型 | Modal |
|---------------|----------|-------|
| `bytedance/doubao-seed-1.6` | `doubao-seed-1-6-251015` 或 `ep-xxx` | TEXT |
| `bytedance/doubao-seed-1.6-thinking` | `doubao-seed-1-6-thinking-250715` | TEXT |
| `bytedance/doubao-seed-1.6-vision` | `doubao-seed-1-6-vision-250815` | TEXT (multimodal) |
| `bytedance/doubao-seed-1.6-lite` | `doubao-seed-1-6-lite-250614` | TEXT |
| `bytedance/doubao-seed-1.6-flash` | `doubao-seed-1-6-flash-250828` | TEXT |
| `bytedance/doubao-seed-code` | `doubao-seed-code-250628` | TEXT |

**多模态模型**：

| nimi model ID | 方舟模型 | Modal |
|---------------|----------|-------|
| `bytedance/doubao-embedding-large` | `doubao-embedding-large-250401` | EMBEDDING |
| `bytedance/doubao-embedding-vision` | `doubao-embedding-vision-250328` | EMBEDDING |
| `bytedance/seedream-5.0-lite` | `doubao-seedream-5-0-lite-260128` | IMAGE |
| `bytedance/seedream-4.5` | `doubao-seedream-4-5-251128` | IMAGE |
| `bytedance/seedance-2.0` | `seedance-2-0` | VIDEO |
| `bytedance/seedance-1.0-pro` | `doubao-seedance-1-0-pro` | VIDEO |
| `bytedance/seedance-1.0-pro-fast` | `doubao-seedance-1-0-pro-fast` | VIDEO |
| `bytedance/tts-default` | N/A（走语音 API） | TTS |
| `bytedance/asr-default` | N/A（走语音 API） | STT |

### 9.4 openAIBackend 路径兼容处理

现有 `openAIBackend` 拼接路径逻辑（`provider_openai_http.go`）：

```go
// 当前逻辑：baseURL + "/v1/chat/completions"
// 火山方舟需要：baseURL + "/chat/completions"（baseURL 已含 /api/v3）
```

需确认 `openAIBackend` 是否在 baseURL 后追加 `/v1/` 前缀。如果是，方舟的 baseURL 应设为 `https://ark.cn-beijing.volces.com/api/v3` 并确保不重复追加 `/v1`。

---

## 10. 实现优先级

| P | 能力 | 工作量 | 涉及文件 | 说明 |
|---|------|--------|----------|------|
| P0 | Chat + Streaming + FC | 配置级 | `provider.go` 环境变量 | 设 baseURL + apiKey 即可 |
| P0 | Embeddings | 配置级 | 同上 | OpenAI 兼容 |
| P1 | 图片生成 | 配置级 | 同上 | OpenAI Images API 兼容 |
| P1 | 视频生成 | 中 | `workflow/executor.go` 新增 node type | 单节点 DAG + 异步轮询 |
| P2 | TTS | 高 | 新增 `provider_bytedance_tts.go` | 独立协议，WebSocket 二进制帧 |
| P2 | ASR | 高 | 新增 `provider_bytedance_asr.go` | 独立协议，WebSocket 二进制帧 |

---

## 11. 参考文档索引

### 方舟平台
- [文档主页](https://www.volcengine.com/docs/82379)
- [模型列表](https://www.volcengine.com/docs/82379/1330310)
- [模型价格](https://www.volcengine.com/docs/82379/1544106)
- [Base URL 及鉴权](https://www.volcengine.com/docs/82379/1298459)
- [Chat API](https://www.volcengine.com/docs/82379/1494384)
- [OpenAI SDK 兼容](https://www.volcengine.com/docs/82379/1330626)
- [Function Calling](https://www.volcengine.com/docs/82379/1262342)
- [Embeddings API](https://www.volcengine.com/docs/82379/1329508)
- [Seedream 5.0 Lite API](https://www.volcengine.com/docs/82379/1541523)
- [Seedream 提示词指南](https://www.volcengine.com/docs/82379/1829186)
- [Seedance 2.0 SDK 示例](https://www.volcengine.com/docs/82379/1366799)
- [创建视频任务](https://www.volcengine.com/docs/82379/1520757)
- [查询视频任务](https://www.volcengine.com/docs/82379/1521309)
- [Seed 2.0 官方发布](https://seed.bytedance.com/en/blog/seed2-0-%E6%AD%A3%E5%BC%8F%E5%8F%91%E5%B8%83)
- [Seed 2.0 Model Card (79页 PDF)](https://lf3-static.bytednsdoc.com/obj/eden-cn/lapzild-tss/ljhwZthlaukjlkulzlp/seed2/0214/Seed2.0%20Model%20Card.pdf)

### 豆包语音
- [语音 API 文档](https://www.volcengine.com/docs/6561/1096680)
- [WebSocket TTS 接口](https://www.volcengine.com/docs/6561/79821)
- [音色列表（完整）](https://www.volcengine.com/docs/6561/1257584)
- [流式 ASR 接口](https://www.volcengine.com/docs/6561/80818)
- [声音复刻 API](https://www.volcengine.com/docs/6561/1305191)
- [同声传译 2.0](https://www.volcengine.com/docs/6561/1756902)

### 第三方参考
- [豆包 API Apifox 文档](https://doubao.apifox.cn)
- [mi-gpt-tts 开源实现（TTS WebSocket）](https://github.com/idootop/mi-gpt-tts/blob/main/src/tts/volcano.ts)
