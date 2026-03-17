# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `media.diffusers`：`media` 的 fallback driver，只在 `media` 无法证明当前 logical model 可执行时启用
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

## K-LENG-002 运行模式

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`
- `SUPERVISED`

`sidecar` 当前只允许 `ATTACHED_ENDPOINT`；`llama`、`media` 与 `media.diffusers` 允许 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。

## K-LENG-003 ATTACHED_ENDPOINT 约束

当 `engine_runtime_mode=ATTACHED_ENDPOINT` 时：

- `endpoint` 必须显式提供且合法；runtime 不得偷偷补回 loopback 默认值。
- runtime 不负责启动、停止或重启外部进程。
- `llama` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical API。
- `media` / `media.diffusers` 的 attached endpoint 必须暴露 `GET /healthz` 与 `GET /v1/catalog`；不得回退 `OpenAI-compatible /v1/models`。
- 当 runtime 不能证明 attached endpoint 可执行当前 logical model 时，必须 fail-close。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec、监控与回收引擎进程。
- 信号处理：`SIGTERM` 优雅关闭，超时后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 二进制/运行时目录：`~/.nimi/engines/{engine}/{version}/...`。
- 注册表：`~/.nimi/engines/registry.json`，必须原子写入。

受管引擎职责：

- `llama`：管理 `llama.cpp` / `llama-server`、GPU layers、context/batch policy、warmup。
- `media`：优先管理 `stable-diffusion.cpp`。
- `media.diffusers`：只在 `media` 不支持 family / artifact completeness / pipeline variant 时作为 fallback 启动。

禁止事项：

- 不得以 `LocalAI / Nexa` 作为 supervised 代理层。
- 不得把 `media.diffusers` 伪装成主引擎。

## K-LENG-005 引擎默认端点

引擎默认端点以 `tables/local-engine-catalog.yaml` 为事实源：

- `llama`：`SUPERVISED` 允许默认 loopback 端口；`ATTACHED_ENDPOINT` 无默认端点。
- `media`：`SUPERVISED` 允许默认 loopback 端口；`ATTACHED_ENDPOINT` 无默认端点。
- `media.diffusers`：只在 fallback 触发后允许 runtime 分配 supervised loopback；`ATTACHED_ENDPOINT` 无默认端点。
- `sidecar`：无默认端点。

当安装或启动时 `endpoint` 为空：

- `ATTACHED_ENDPOINT`：一律 fail-close，reason code 使用 `AI_LOCAL_ENDPOINT_REQUIRED`。
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

`sidecar` 使用 Nimi music canonical HTTP API：

- `POST /v1/music/generate`

协议约束：

- `media` / `media.diffusers` 不得再通过 OpenAI-compatible provider 语义暴露给上层。
- `llama` 只承载文本与理解能力；`media` / `media.diffusers` 只承载图像/视频生成能力。
- 用户层不得直接暴露 workflow、companion model 拼装或 pipeline DAG。

## K-LENG-007 健康探测协议

`llama` 健康探测：

- `GET /v1/models` 成功仅说明进程可达。
- 对 `text.generate` / `text.embed` 至少还需一次最小执行或等价 warmup 成功，才能视为 ready。
- 对 `image.understand` / `audio.understand` 还必须验证 companion artifact（如 `mmproj`）完整。

`media` / `media.diffusers` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 存在至少一个与目标 `logical_model_id` 可比对的 ready entry，才算健康。
- catalog 不得暴露静态伪 model list。
- `media.diffusers` 作为 fallback 时，必须在探测结果中暴露 fallback 原因，不得静默替换。

`sidecar` 当前不进入标准 supervised 健康探测，attached endpoint 的可用性由实际 music 请求 fail-close。

## K-LENG-008 配置来源优先级

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数
2. 环境变量
3. 配置文件
4. 引擎默认值

配置结构必须围绕 `llama` / `media` / `sidecar` 组织，不得继续保留 `localai` / `nexa` 为 public 配置入口。

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
