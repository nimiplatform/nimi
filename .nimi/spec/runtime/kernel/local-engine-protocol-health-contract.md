# Local Engine Protocol Health Contract

> Owner Domain: `K-LENG-*`

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

- 对 runtime-owned managed image backend supervised 路径，`local-media` 是唯一 app-facing execution endpoint；runtime / sdk / desktop 不得直接把该路径投射成 `llama` provider HTTP consume surface。
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
- `llama` 只承载文本与理解能力；`media` / `media.diffusers` 只承载图像/视频生成能力；`speech` 当前 canonical local truth 只承载 `audio.transcribe` / `audio.synthesize`，workflow 仍需等待显式 admission。
- 用户层不得直接暴露 workflow、companion model 拼装或 pipeline DAG。

## K-LENG-007 健康探测协议

`llama` 健康探测：

- `GET /v1/models` 成功仅说明进程可达。
- endpoint 无响应、连接失败、probe timeout、engine bootstrap 失败或无法证明 target execution plane 可达时，runtime 必须 fail-close，并保留结构化 detail；不得把该结果投影为 `ACTIVE`、`READY` 或可路由成功。
- 对 `text.generate` / `text.embed` 至少还需一次最小执行或等价 warmup 成功，才能视为 ready。
- supervised `llama` 在首次最小执行 / warmup 失败时，必须保留失败阶段、退出码或 stderr 摘要等结构化细节；不得仅因 `/v1/models` 可达就把模型提升为 ready。
- 对 supervised `llama`，`/v1/models` 缺失目标模型只说明“当前 resident worker 未加载该模型”；对非当前 resident 的已验证模型，不得仅据此投影为 `UNHEALTHY`。
- 对 supervised `llama`，`responded=true` 且 engine/catalog 可达但目标模型非 resident 时，可投影为 `LocalAssetStatus.ACTIVE` + `LocalWarmState.COLD`；`responded=false` 或 bootstrap/probe 不可达不得使用该 cold projection。
- 对 `image.understand` / `audio.understand` 还必须验证 companion artifact（如 `mmproj`）完整。

`media` / `media.diffusers` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 存在至少一个与目标 `logical_model_id` 可比对的 ready entry，才算健康。
- catalog 不得暴露静态伪 model list。
- `media.diffusers` 作为 runtime-private implementation detail 时，必须在探测结果
  中暴露 selected backend/family support reason，不得静默替换
  descriptor-authored `execution.backend` / `model.family`。Under
  profile-declared constraints, backend mismatch, model-family mismatch,
  unsupported product_state, or missing environment readiness is fail-closed
  readiness, not fallback success.
- `engine=media` 的 image 资产若 backend/profile 解析到 `stablediffusion-ggml` 或其它实际受管 native-binary image backend，则 health 归因、bootstrap 目标与 host support 判断必须跟随实际受管 backend；不得因为 public engine 仍是 `media` 就错误要求 attached endpoint。
- 若 host 不满足 daemon-managed image backend 的硬件前提，health / registration detail 必须直接暴露 canonical matrix compatibility 原因，不得仅返回 `managed diffusers backend unavailable` 或其它泛化 backend 缺失错误。

`speech` 健康探测：

- `speech` 的 local plain-speech truth 至少区分四层：`provider_reachability`、`engine_readiness`、`bundle_readiness`、`capability_route_readiness`。上层 truth 不得自动推出下一层 truth；`K-PROV-*` provider health 只回答 `provider_reachability`，不得直接提升为 plain-speech admitted success。
- ordinary-user `bundle_readiness` 只证明 env/bootstrap + host 前置条件已经满足；它不得隐含所有 speech capability slices 已 materialize。
- ordinary-user 缺失 capability slice 时，runtime/desktop 必须先投影为“需要显式 Download 确认”的 fail-closed 状态；单纯 capability 选择、route 尝试或后台 probe 不得静默启动 env/bootstrap、host init 或 model download。
- desktop 可以把 runtime-owned speech asset/service truth 投影为 bundle-aware partial readiness，但 `/healthz`、`/v1/catalog` 或单个 helper IPC 结果都不得被升格为 Desktop-owned install truth。
- `/healthz` 返回 ready 只证明 `engine_readiness`；`/v1/catalog` 暴露 target `logical_model_id` 的 ready entry 只在与 bundle / capability proof 共同成立时，才允许提升到 `capability_route_readiness`。
- `audio.transcribe` 必须至少验证 STT driver 与主 artifact 完整；只有 target logical model 已 admitted 且投影一致、catalog 顶层 `ready=true`、target row `ready=true`、row capability 命中 `audio.transcribe` 时，才允许投影为 admitted local ready。
- `audio.synthesize` 必须至少验证 TTS driver 与主 artifact 完整；只有 target logical model 已 admitted 且投影一致、catalog 顶层 `ready=true`、target row `ready=true`、row capability 命中 `audio.synthesize`，且 supervised path 下 target endpoint 与 managed speech endpoint 一致时，才允许投影为 admitted local ready。
- placeholder host 与 admitted plain-speech host 必须显式分离：在 admitted local plain-speech execution plane 尚未 materialize 前，speech canonical HTTP surface 可以存在，但必须保持 non-ready / fail-close；不得借 `ACTIVE`、`READY`、generic health 或静态 catalog 投影成 admitted success。
- speech supervised data-boundary minimum 属于 admitted contract：temp files 必须有 bounded lifecycle；public detail 不得暴露 raw bootstrap path、raw probe URL 或 raw request payload；reference audio、transcription text、voice design prompt 不得因 generic logging 默认进入长期保留路径。
- 当未来 local workflow 被 admission 时，`voice_workflow.voice_clone` / `voice_workflow.voice_design` 必须验证 workflow driver 可用；在 admission 之前，缺失独立 workflow readiness truth 时必须 fail-close，不得投影为 local admitted success。
- 对 baseline admitted local workflow，workflow driver/readiness truth 也必须保持 family-scoped：当前只允许 `qwen3_tts` 进入 admitted execution proof，其成功不得隐式放宽到其它 local workflow family。

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
- 当降级发生在 SPEECH_SYNTHESIZE 场景时，必须同时正向投影
  `voice_output_mode=simulated_stream`（`K-STREAM-004`、`K-VOICE-019`）。
  `stream_simulated=true` 与 `stream_fallback_simulated` 只是 compatibility
  metadata / audit tag，是本节唯一一份 stream 降级词汇，绝不能被当作 native
  realtime 的主验收真相；分片模拟的语音流不满足 `native_stream` 验收。
