# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `speech`：本地语音引擎族，负责 `audio.transcribe`、`audio.synthesize`、`voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`media.diffusers` 仅允许作为 `media` 的 runtime 内部 fallback driver；不是 public engine target。
`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

## K-LENG-002 运行模式

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`
- `SUPERVISED`

`sidecar` 当前只允许 `ATTACHED_ENDPOINT`；`llama`、`media` 与 `speech` 允许 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。

## K-LENG-003 ATTACHED_ENDPOINT 约束

当 `engine_runtime_mode=ATTACHED_ENDPOINT` 时：

- `endpoint` 必须显式提供且合法；runtime 不得偷偷补回 loopback 默认值。
- runtime 不负责启动、停止或重启外部进程。
- `llama` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical API。
- `media` 的 attached endpoint 必须暴露 `GET /healthz` 与 `GET /v1/catalog`。
- `speech` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical speech API。
- 当 runtime 不能证明 attached endpoint 可执行当前 logical model 时，必须 fail-close。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec、监控与回收引擎进程。
- 信号处理：`SIGTERM` 优雅关闭，超时后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 二进制/运行时目录：`~/.nimi/engines/{engine}/{version}/...`。
- 注册表：`~/.nimi/engines/registry.json`，必须原子写入。
- stale pid 清理只能在 runtime 能证明该 pid 仍属于当前 supervised engine binary 时执行；缺少身份元数据或无法完成身份校验时，runtime 必须只清理跟踪文件，不得终止该进程。
- supervised engine bootstrap 下载只允许 `https -> https` redirect；同 host redirect 允许，`github.com` release 资产仅允许跳到显式 GitHub release-chain host（`github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`），其它 redirect 一律 fail-close。
- `llama` supervised bootstrap 必须使用官方 `ggml-org/llama.cpp` release pack，并落地 `llama-server` 二进制。

受管引擎职责：

- `llama`：管理 `llama.cpp` / `llama-server`、GPU layers、context/batch policy、warmup。
- `media`：优先管理 `stable-diffusion.cpp`。但 `engine=media` 不能按引擎名整体决定 host support；必须结合资产 capability、`engine_config.backend` 与 `preferred_engine` 判断真实受管 backend。
- `speech`：管理 `whispercpp`、`kokoro` 与 `qwen3tts` 等 Phase 1 语音 driver，并负责语音基础能力与 voice workflow 探测。
- `media.diffusers`：只在 `media` 不支持 family / artifact completeness / pipeline variant 时作为内部 fallback 启动。

资产级 supervised 规则：

- `tables/local-image-supervised-backend-matrix.yaml` 是 canonical local image supervised backend matrix 的唯一事实源。
- canonical local image product path 固定为：
  - `kind=image`
  - `engine=media`
  - `engine_runtime_mode=SUPERVISED`
  - app-facing consume endpoint 为 `local-media`
  - `ATTACHED_ENDPOINT` 不作为 canonical local image product path 的合法 fallback
- `engine=media` 且 runnable capability 为 `image.generate` / `image.edit`，并且 backend/profile 解析到 `stablediffusion-ggml` 或 llama-backed image backend 时，`SUPERVISED` host support 必须跟随**真实 llama-backed image backend**的支持面，而不是复用整个 `media` 引擎的粗粒度 host 分类，也不得粗暴等同于通用 `llama` text supervised 支持面。
- 对上述 llama-backed image 资产：
  - `managed engine ownership` 由 `llama` control plane 与 daemon-managed llama image backend 负责。
  - `LocalAssetRecord.endpoint` 与本地 consume route 的真实执行 endpoint 仍必须指向 `media` canonical loopback（`local-media`），不得把 `llama` control-plane endpoint 当作 image 执行 endpoint 对外暴露。
  - runtime 启动/探测时必须同时满足 control plane（`llama`）与 execution plane（`local-media`）的 supervised 生命周期；不得只启动其一。
- 对 daemon-managed `stablediffusion-ggml` backend：
  - `darwin/arm64` 仅当 host 能提供 Apple Metal tensor API（当前最小门槛：Apple `M5+` 或 `A19+`）时，才允许判定为 `SUPERVISED supported`。
  - 不满足该门槛时，runtime 必须在 install plan / import / registration / health 路径上统一返回明确兼容性原因，并以 `AI_LOCAL_MODEL_UNAVAILABLE` fail-close；不得再把 canonical image 路径改写成 `ATTACHED_ENDPOINT` 或 `AI_LOCAL_ENDPOINT_REQUIRED`。
- `engine=media` 的 `video.generate` / `i2v` 等其它能力仍可继续沿用 `media` 自身的 host support 规则，直到对应 supervised backend 明确实现。
- 同一规则必须统一驱动 install plan、runtime mode 解析、startup warnings、health warnings 与 attached-endpoint-required 判定；不得在不同入口各自重新推断。

禁止事项：

- 不得以 `LocalAI / Nexa` 作为 supervised 代理层。
- 不得把 `media.diffusers` 伪装成主引擎。

## K-LENG-005 引擎默认端点

引擎默认端点以 `tables/local-engine-catalog.yaml` 为事实源：

- `llama`：`SUPERVISED` 允许默认 loopback 端口；`ATTACHED_ENDPOINT` 无默认端点。
- `media`：只有当资产级 host support 判定允许 `SUPERVISED` 时，才允许使用默认 loopback 端口；`ATTACHED_ENDPOINT` 无默认端点。
- `speech`：`SUPERVISED` 允许默认 loopback 端口；`ATTACHED_ENDPOINT` 无默认端点。
- `sidecar`：无默认端点。
- `SUPERVISED` 的默认 loopback 端口是固定绑定；端口冲突必须显式失败，不得静默漂移到邻近端口，也不得在当前 contract 下偷偷切到动态端口模式。

当安装或启动时 `endpoint` 为空：

- `ATTACHED_ENDPOINT`：一律 fail-close，reason code 使用 `AI_LOCAL_ENDPOINT_REQUIRED`。
- 对 canonical local image product path，若当前 host 不满足 `tables/local-image-supervised-backend-matrix.yaml`，必须使用 `AI_LOCAL_MODEL_UNAVAILABLE` fail-close；不得要求用户补 `endpoint`。
- `SUPERVISED`：runtime 可在 engine manager 产出真实 endpoint 前临时保持空值，但不得把空 endpoint 当作 ready。

## K-LENG-006 Local 协议基线

`llama` 使用 canonical text/understanding API：

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

`media` 与 `media.diffusers` 使用 runtime 私有 canonical media HTTP API：

- `GET /healthz`
- `GET /v1/catalog`
- `POST /v1/media/image/generate`
- `POST /v1/media/video/generate`

补充：

- 对 llama-backed supervised image 路径，`local-media` 是唯一 app-facing execution endpoint；runtime / sdk / desktop 不得直接把该路径投射成 `llama` provider HTTP consume surface。
- runtime 允许在 `local-media` 内部执行 dynamic managed-image profile materialization；若需要额外内部导入步骤，必须保持为 runtime 私有实现，不得改变 app-facing canonical media consume path。

`speech` 使用 runtime 私有 canonical speech HTTP API：

- `GET /healthz`
- `GET /v1/catalog`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`
- `POST /v1/voice/clone`
- `POST /v1/voice/design`

`sidecar` 使用 Nimi music canonical HTTP API：

- `POST /v1/music/generate`

协议约束：

- `media` / `media.diffusers` 不得再通过 OpenAI-compatible provider 语义暴露给上层。
- `speech` 不得把 voice workflow 伪装为 OpenAI-compatible TTS 成功语义。
- `llama` 只承载文本与理解能力；`media` / `media.diffusers` 只承载图像/视频生成能力；`speech` 只承载语音与 voice workflow 能力。
- 用户层不得直接暴露 workflow、companion model 拼装或 pipeline DAG。

## K-LENG-007 健康探测协议

`llama` 健康探测：

- `GET /v1/models` 成功仅说明进程可达。
- 对 `text.generate` / `text.embed` 至少还需一次最小执行或等价 warmup 成功，才能视为 ready。
- supervised `llama` 在首次最小执行 / warmup 失败时，必须保留失败阶段、退出码或 stderr 摘要等结构化细节；不得仅因 `/v1/models` 可达就把模型提升为 ready。
- 对 `image.understand` / `audio.understand` 还必须验证 companion artifact（如 `mmproj`）完整。

`media` / `media.diffusers` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 存在至少一个与目标 `logical_model_id` 可比对的 ready entry，才算健康。
- catalog 不得暴露静态伪 model list。
- `media.diffusers` 作为 fallback 时，必须在探测结果中暴露 fallback 原因，不得静默替换。
- `engine=media` 的 image 资产若 backend/profile 解析到 `stablediffusion-ggml` 或其它 llama-backed image backend，则 health 归因、bootstrap 目标与 host support 判断必须跟随实际受管 backend；不得因为 public engine 仍是 `media` 就错误要求 attached endpoint。
- 若 host 不满足 daemon-managed image backend 的硬件前提，health / registration detail 必须直接暴露兼容性原因（例如 Apple `M5+` / `A19+` 要求），不得仅返回 `managed diffusers backend unavailable` 或其它泛化 backend 缺失错误。

`speech` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 暴露目标 `logical_model_id` 的 ready entry，才算健康。
- `audio.transcribe` 必须至少验证 STT driver 与主 artifact 完整。
- `audio.synthesize` 必须至少验证 TTS driver 与主 artifact 完整。
- `voice_workflow.tts_v2v` / `voice_workflow.tts_t2v` 必须验证 workflow driver 可用；缺失 `qwen3tts` 等必要 bundle 时必须 fail-close。

`sidecar` 当前不进入标准 supervised 健康探测，attached endpoint 的可用性由实际 music 请求 fail-close。

`llama` daemon-managed image backend 名称当前固定只允许：

- `llama-cpp`
- `whisper-ggml`
- `stablediffusion-ggml`

runtime 不得把任意 backend 名称直接透传给受管 `llama` 引擎 CLI。

## K-LENG-008 配置来源优先级

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数
2. 环境变量
3. 配置文件
4. 引擎默认值

配置结构必须围绕 `llama` / `media` / `speech` / `sidecar` 组织，不得继续保留 `localai` / `nexa` / `nimi_media` 为 public 配置入口。

## K-LENG-009 凭据安全策略

- attached endpoint 如需凭据，允许使用 inline `apiKey` 或 `apiKeyEnv`；二者互斥。
- 本地 supervised 引擎默认不要求 API key；如上游宿主要求，凭据解析仍遵循 `apiKeyEnv` 优先。
- 不需要凭据的本地引擎不得因空 `apiKey` 被判定为未配置。

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
- 将完整响应按 24 字符分片（最后一片可短于 24 字符），模拟流式推送。
- 终帧 metadata 必须标识 `stream_simulated=true`。
- 审计必须标记 `stream_fallback_simulated`。
- 分片模拟的事件语义仍需满足 `K-STREAM-002` 与 `K-STREAM-003`。
