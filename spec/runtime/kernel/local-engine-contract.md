# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 支持四种本地推理引擎：

- `localai`：LocalAI 引擎，OpenAI-compatible HTTP 服务。
- `nexa`：Nexa 引擎，OpenAI-compatible HTTP 服务。
- `nimi_media`：Nimi 受管本地图像/视频引擎，基于 `diffusers`，暴露 runtime 私有 canonical media HTTP 协议。
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

## K-LENG-002 运行模式

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`：连接外部已运行的引擎进程，runtime 不管理其生命周期。
- `SUPERVISED`：runtime 负责 spawn、监控与回收引擎进程。

Phase 1 同时支持 `ATTACHED_ENDPOINT` 和 `SUPERVISED` 两种模式。

## K-LENG-003 ATTACHED_ENDPOINT 约束

当 `engine_runtime_mode=ATTACHED_ENDPOINT` 时：

- `endpoint` 必须指向已运行的 HTTP 服务（格式：`http://<host>:<port>[/<base_path>]`）。
- runtime 不负责启动、停止或重启该进程。
- `localai` / `nexa` / `nimi_media` 的健康探测协议见 `K-LENG-007`；`sidecar` 当前不纳入 RuntimeLocalService 的标准引擎健康探测与生命周期管理，availability 由实际请求结果决定。
- `endpoint` 缺失或空字符串时，按 `K-LENG-005` 注入默认端点。
- `nimi_media` 的 attached endpoint 逃生口必须是显式外部 endpoint。对不满足 `Windows x64 + NVIDIA CUDA` 的主机，runtime 不得把默认 loopback `http://127.0.0.1:8321/v1` 伪装成 attached fallback。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec 引擎二进制，传入端口与配置。
- 信号处理：`SIGTERM` 优雅关闭，超时（默认 10 秒）后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 进程退出码非零视为异常，写审计并触发状态迁移。
- 当前仅 `localai` / `nexa` / `nimi_media` 支持 `SUPERVISED`；`sidecar` 不属于 daemon-managed engine。

### 二进制管理

- 二进制存储路径：`~/.nimi/engines/{engine}/{version}/{binary_name}`。
- 注册表：`~/.nimi/engines/registry.json`，atomic write（temp→rename）。
- LocalAI：从 GitHub Releases 下载，SHA256 校验，支持 darwin/arm64、darwin/amd64、linux/amd64、linux/arm64。
- Windows 当前不支持 LocalAI `SUPERVISED` 托管；Windows 用户必须通过 WSL / Docker 等外部进程提供 `ATTACHED_ENDPOINT`。
- Nexa：非 Windows 平台使用系统安装（`exec.LookPath("nexa")`）；Windows 使用 runtime 托管的 `uv + Python` 环境安装 `nexaai` 并执行 `nexa serve`。
- `nimi_media`：runtime 使用 `uv + Python 3.12` 受管环境安装 `diffusers` 推理栈，并启动内置 `nimi_media_server.py`；Phase 1 的 managed support 仅覆盖 `Windows x64 + NVIDIA CUDA`。若 host 不满足该条件，runtime MUST fail-close supervised 路径，并要求调用方改用显式 `ATTACHED_ENDPOINT`。

### 进程管理

- PID 文件：`~/.nimi/engines/{engine}/supervised.pid`，用于僵尸进程清理。
- 端口分配：优先使用配置端口，冲突时 port+1 递增尝试最多 10 次。
- 启动等待：LocalAI 默认 120 秒（首次下载 GPU backend 可能较慢），Nexa 默认 30 秒，`nimi_media` 默认 180 秒（首次安装 Torch / diffusers 依赖可能较慢）。
- 健康探测：LocalAI 使用 `GET /readyz`（HTTP 200=健康），Nexa 使用 `GET /`（body 含 "Nexa SDK is running"=健康），`nimi_media` 使用 `GET /readyz`（body 含 `"status": "ok"`=健康）。
- Host 支持面判定：runtime 内部必须区分 `supported_supervised`、`attached_only`、`unsupported`。Phase 1 中 `nimi_media` 的 supervised host 只有 `Windows x64 + NVIDIA CUDA`；其余 host 至少视为 `attached_only`。

### env var 注入

引擎就绪后，runtime 自动设置以下环境变量供现有 AI provider 层自动接管：

- LocalAI：`NIMI_RUNTIME_LOCAL_AI_BASE_URL={endpoint}`
- Nexa：`NIMI_RUNTIME_LOCAL_NEXA_BASE_URL={endpoint}`
- `nimi_media`：`NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL={endpoint}`

`sidecar` 不做 runtime 注入与进程管理，调用方直接通过 `NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL` / `NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY` 提供 attached endpoint。

### 配置

FileConfig `engines` 段：

```json
{
  "engines": {
    "localai": {
      "enabled": true,
      "version": "3.12.1",
      "port": 1234,
      "imageBackend": {
        "mode": "official",
        "backendName": "stablediffusion-ggml",
        "address": "127.0.0.1:50052"
      }
    },
    "nexa": { "enabled": false, "version": "", "port": 8000 },
    "nimi_media": { "enabled": false, "version": "0.1.0", "port": 8321 }
  }
}
```

ENV 覆盖：`NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED`、`NIMI_RUNTIME_ENGINE_LOCALAI_VERSION`、`NIMI_RUNTIME_ENGINE_LOCALAI_PORT`；Nexa 与 `nimi_media` 同理（分别替换为 `NEXA` / `NIMI_MEDIA`）。

受管 LocalAI image backend 约束：

- `engines.localai.imageBackend.mode` 允许 `disabled|official|custom`。
- `official` 模式表示 runtime 负责供应并启动官方 `stablediffusion-ggml` external gRPC backend，再通过 `--external-grpc-backends` 接入 LocalAI。
- `custom` 模式表示 runtime 负责启动自定义 backend command，并以 `address` 作为 LocalAI gRPC 连接目标。
- 该 backend 必须作为 daemon-managed local service 对外可见；用户不得通过通用 service lifecycle RPC 直接 install/start/stop/remove 它。

自动托管推导（LocalAI）：

- 当 `providers.local.baseUrl`（等价 env：`NIMI_RUNTIME_LOCAL_AI_BASE_URL`）为回环地址（`localhost`/`127.0.0.1`/`::1`）且 `engines.localai.enabled` 未被显式设置（配置文件与环境变量均未给值）时，runtime MUST 仅在当前平台支持 LocalAI `SUPERVISED` 托管时推导 `engines.localai.enabled=true`，并进入 SUPERVISED 启动链路。
- 若当前平台不支持 LocalAI `SUPERVISED` 托管，回环 `providers.local.baseUrl` 必须保持 `ATTACHED_ENDPOINT` 语义，runtime 不得自动托管 LocalAI 进程。
- 显式覆盖优先级：`engines.localai.enabled` 的显式配置（`true` 或 `false`）始终高于自动推导。
- 在不支持的当前平台上若显式设置 `engines.localai.enabled=true`，runtime MUST 在加载配置时自动禁用 supervised LocalAI，并继续按 `ATTACHED_ENDPOINT` 语义处理 `providers.local.baseUrl`。
- 在不支持的当前平台上，`nimi config set` / `nimi config validate` MUST 与运行时保持一致，不得因 `engines.localai.enabled=true` 而阻止配置写入或 runtime 启动。
- 端口推导：当 `engines.localai.port` 未显式设置时，runtime MUST 从 `providers.local.baseUrl` 解析端口；解析失败或未提供端口时回退 `1234`。
- `engines.localai.port` 显式配置始终高于 URL 端口推导。

### gRPC RPC

`RuntimeLocalService` 新增 5 个 Engine RPC：

- `ListEngines` — 列出所有受管引擎状态。
- `EnsureEngine` — 确保引擎二进制可用（下载如缺失）。
- `StartEngine` — 启动引擎进程。
- `StopEngine` — 停止引擎进程。
- `GetEngineStatus` — 获取单个引擎状态。

`engineMgr == nil` 时返回 `FAILED_PRECONDITION`。

## K-LENG-005 引擎默认端点

引擎默认端点以 `tables/local-engine-catalog.yaml` 为事实源：

- `localai`：`http://127.0.0.1:1234/v1`
- `nexa`：无默认端点，`endpoint` 必须显式提供。
- `nimi_media`：`http://127.0.0.1:8321/v1`
- `sidecar`：无默认端点，`endpoint` 必须显式提供。

当安装或启动时 `endpoint` 为空：

- `localai`：自动注入默认端点。
- `nexa`：返回 `INVALID_ARGUMENT` + `AI_LOCAL_ENDPOINT_REQUIRED`。
- `nimi_media`：仅当 host 满足 supervised 条件时允许把默认端点解释为 daemon-managed loopback；否则必须要求显式 attached endpoint，并返回 fail-close。
- `sidecar`：返回 `INVALID_ARGUMENT` + `AI_LOCAL_ENDPOINT_REQUIRED`。

## K-LENG-006 Local HTTP 协议基线

`localai` 与 `nexa` 遵循 OpenAI-compatible HTTP API：

- 文本生成：`POST /v1/chat/completions`（`stream=false`）
- 流式生成：`POST /v1/chat/completions`（`stream=true`）
- 嵌入：`POST /v1/embeddings`
- 模型列表：`GET /v1/models`
- 图像生成：`POST /v1/images/generations`
- 语音合成：`POST /v1/audio/speech`
- 语音识别：`POST /v1/audio/transcriptions`

`nimi_media` 使用 runtime 私有 canonical media HTTP API：

- 健康探测：`GET /healthz`、`GET /readyz`
- 目录探测：`GET /v1/catalog`
- 图像生成：`POST /v1/media/image/generate`
- 视频生成：`POST /v1/media/video/generate`

`/healthz` 与 `/readyz` 必须只在依赖导入、设备探测、默认 image/video 模型解析、以及默认 image/video 管线初始化全部成功后返回 `200 + ready=true`；否则必须返回非 `2xx` 或 `ready=false`，并包含结构化 `detail`。

`/v1/catalog` 必须只暴露真实 ready 的模型与 capability，不得伪造静态 model list，也不得把 `not_loaded` / `unconfigured` / `dependency_missing` 的模型伪装成可用目录项。

`nimi_media` 当前仅承诺 `image.generate` / `video.generate` 两类 capability；不承诺 `chat` / `embeddings` / `audio` 路径，也不承诺任意 DAG、custom nodes、LoRA/ControlNet 全生态兼容。

`sidecar` 使用 Nimi music canonical HTTP 协议，不属于 OpenAI-compatible 基线：

- `POST /v1/music/generate`
- 请求体字段与 `MusicGenerateScenarioSpec` canonical 字段对齐（`prompt` / `negative_prompt` / `lyrics` / `style` / `title` / `duration_seconds` / `instrumental`）
- Phase 1 只要求 prompt-only；是否支持 iteration 由 provider capability 与 runtime strategy 决定，不能假定 sidecar 默认支持
- 响应可直接返回音频 bytes，或返回 `audio_url` / `audio_base64` JSON 包装

引擎特有的非标 API（如 LocalAI 的 video backend、`nimi_media` 的 `diffusers` family driver、music sidecar 的 canonical music path）通过 `LocalProviderHints` 或 runtime adapter 描述，不作为通用 OpenAI-compatible 协议基线。

LocalAI 动态图片工作流补充：

- companion asset（如 `vae` / `llm` / `clip`）不要求静态注册进 `localai-models.yaml`。
- runtime 可在请求时基于主模型 `engine_config`、显式 artifact 选择与本次 profile override 渲染临时 profile，并通过 `POST /models/import` 动态导入。
- `components[]` 为 LocalAI dynamic image workflow 必填输入；缺失或空数组时，runtime 必须在 import 前 fail-close（`INVALID_ARGUMENT` + `AI_INPUT_INVALID`），不得猜测默认 `vae` / `llm` companion。
- `profile_overrides` 仅允许覆盖非路径字段；若只有 `profile_overrides` 而没有显式 companion 选择，runtime 不得继续生成动态 alias profile。
- LocalAI image 模型的健康判定不得仅依赖 `/v1/models` 静态列表。

LocalAI text-chat multimodal 补充：

- `localai` 必须支持通过 `POST /v1/chat/completions` 接收 text multimodal 输入
- runtime 对具备 `text.generate.vision` / `text.generate.audio` / `text.generate.video` 的 LocalAI 模型，必须优先使用 native chat mapper，而不是退回通用 image-only OpenAI-compatible mapper
- native mapper 必须支持：
  - `string_images`
  - `string_videos`
  - `string_audios`
  - `artifact_ref` 先解析为本地文件路径或可访问 URI 后再映射
- 对声明了多模态 text capability 的 LocalAI 模型，健康/预热链路至少需要一次最小 text chat probe；仅 `/v1/models` 健康不可视为充分 ready

## K-LENG-007 健康探测协议

> 本协议适用于 runtime 受管本地引擎健康探测。云端 provider 探测使用 K-PROV-003（探测路径与健康判定标准不同）。

LocalAI / Nexa 健康探测使用 `GET /v1/models`：

- HTTP 200 且响应包含有效模型列表 → 健康。
- HTTP 非 200 或连接失败 → 不健康。
- 探测超时：默认 5 秒，不可配置（Phase 1）。

`nimi_media` 健康探测使用 `GET /healthz` + `GET /v1/catalog`：

- `/healthz` 返回 `200 + ready=true` 且 `/v1/catalog` 返回至少一个 ready model → 健康。
- `/healthz` 非 200、`ready=false`、`/v1/catalog` 非 200，或目录为空/缺失目标 ready model → 不健康。
- `nimi_media` 的目录探测不得退回 `/v1/models`，也不得把静态默认 driver 信息当作 ready 证据。

Nexa capability probe 补充：

- 对声明 `tts` / `stt` 的 `nexa` local model，runtime 不得仅凭 endpoint 可达就视为 ready。
- `/v1/models` 探测成功后，runtime 还必须验证响应中存在与目标 `model_id` 可比对的 model entry；缺失时模型健康状态必须 fail-close，并在 node catalog 中标记 unavailable。

受管 LocalAI 文本模型补充：

- 对具备 `chat` / `text.generate` capability 的 `localai` 模型，`StartLocalModel` 与 `WarmLocalModel` 在 `SUPERVISED` 路径下成功返回前，必须在 `/v1/models` 探测通过后追加一次最小 `POST /v1/chat/completions` 预热执行。
- 设计原因：LocalAI HTTP 层可能早于内部 `llama-cpp` gRPC backend ready；仅凭 `/v1/models` 可能出现 false green。
- 若该最小执行失败，runtime 必须将启动视为失败并返回/记录 `UNHEALTHY`，不得把模型保留在 `ACTIVE`。

探测频率由调用方决定（daemon 默认 8 秒周期），本规则仅定义协议。

`sidecar` 当前不纳入该标准探测协议，也不进入 RuntimeLocalService 的 supervised engine 生命周期；其 attached endpoint 可用性由实际 music 请求在 runtime adapter 层 fail-close。

## K-LENG-008 引擎配置来源优先级

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数（`InstallLocalModel.endpoint` 等）
2. 环境变量（`NIMI_RUNTIME_LOCAL_AI_BASE_URL`、`NIMI_RUNTIME_LOCAL_NEXA_BASE_URL`、`NIMI_RUNTIME_LOCAL_NIMI_MEDIA_BASE_URL`、`NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL` 等，命名与 `K-PROV-002` 一致）
3. 配置文件（`K-DAEMON-009` 定义的配置路径，即 `~/.nimi/config.json` 的 provider 相关段）
4. 引擎默认值（`K-LENG-005`）

RPC 请求参数仅影响当次操作，不持久化覆盖配置文件值。

## K-LENG-009 凭据安全策略

- 配置文件中的 provider 凭据允许使用 inline `apiKey` 或 `apiKeyEnv`；二者互斥。
- 运行时先解析 `apiKeyEnv` 指向的环境变量值；若未配置 env 引用则回退到 inline `apiKey`。
- `apiKeyEnv` 引用的环境变量不存在或为空时：该 provider 视为未配置凭据（不影响不需要凭据的本地引擎），除非同时提供了 inline `apiKey` fallback。

## K-LENG-010 HTTP 错误 → gRPC 状态映射

本地引擎 HTTP 响应到 gRPC 状态码的映射：

| HTTP Status | gRPC Code | 说明 |
|---|---|---|
| 400 | `INVALID_ARGUMENT` | 请求格式错误 |
| 401 | `PERMISSION_DENIED` | 认证失败 |
| 403 | `PERMISSION_DENIED` | 权限不足 |
| 404 | `NOT_FOUND` | 模型或端点不存在 |
| 408 | `DEADLINE_EXCEEDED` | 请求超时 |
| 429 | `UNAVAILABLE` | 速率限制 |
| 500 | `INTERNAL` | 引擎内部错误 |
| 502/503/504 | `UNAVAILABLE` | 引擎不可达 |

未列出的 4xx 映射为 `INVALID_ARGUMENT`；未列出的 5xx 映射为 `UNAVAILABLE`。

## K-LENG-011 流式降级检测

当 `stream=true` 请求返回以下信号时，视为引擎不支持流式：

- HTTP 404/405/501
- 响应 Content-Type 非 `text/event-stream`
- 响应体特征匹配：包含 `"error"` 且状态码指示不支持

降级处理：

- 回退为非流式请求（`stream=false`）。
- 将完整响应按 24 字符分片（最后一片可短于 24 字符），模拟流式推送。24 字符 ≈ 6-8 个 CJK 字符或 4-5 个英文单词，是视觉上产生"逐步输出"感的最小粒度。此值为字符级（Unicode codepoint），与 K-STREAM-006 的 32 字节最小 chunk 是不同维度：K-STREAM-006 约束的是真实流式传输的 wire-level 最小帧大小（bytes），K-LENG-011 约束的是模拟流式时的文本分片大小（characters）。两者独立作用，不冲突。
- 终帧 metadata 必须标识 `stream_simulated=true`。
- 审计必须标记 `stream_fallback_simulated`。
- 分片模拟的事件语义仍需满足 `K-STREAM-002`（阶段边界）与 `K-STREAM-003`（文本流）。
