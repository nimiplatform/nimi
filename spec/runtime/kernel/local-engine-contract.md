# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 支持两种本地推理引擎：

- `localai`：LocalAI 引擎，OpenAI-compatible HTTP 服务。
- `nexa`：Nexa 引擎，OpenAI-compatible HTTP 服务。

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
- 健康探测协议见 `K-LENG-007`。
- `endpoint` 缺失或空字符串时，按 `K-LENG-005` 注入默认端点。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec 引擎二进制，传入端口与配置。
- 信号处理：`SIGTERM` 优雅关闭，超时（默认 10 秒）后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 进程退出码非零视为异常，写审计并触发状态迁移。

### 二进制管理

- 二进制存储路径：`~/.nimi/engines/{engine}/{version}/{binary_name}`。
- 注册表：`~/.nimi/engines/registry.json`，atomic write（temp→rename）。
- LocalAI：从 GitHub Releases 下载，SHA256 校验，支持 darwin/arm64、darwin/amd64、linux/amd64、linux/arm64。
- Nexa：系统安装（`exec.LookPath("nexa")`），不自动下载。未安装时返回 `FAILED_PRECONDITION` + 安装引导。

### 进程管理

- PID 文件：`~/.nimi/engines/{engine}/supervised.pid`，用于僵尸进程清理。
- 端口分配：优先使用配置端口，冲突时 port+1 递增尝试最多 10 次。
- 启动等待：LocalAI 默认 120 秒（首次下载 GPU backend 可能较慢），Nexa 默认 30 秒。
- 健康探测：LocalAI 使用 `GET /readyz`（HTTP 200=健康），Nexa 使用 `GET /`（body 含 "Nexa SDK is running"=健康）。

### env var 注入

引擎就绪后，runtime 自动设置以下环境变量供现有 AI provider 层自动接管：

- LocalAI：`NIMI_RUNTIME_LOCAL_AI_BASE_URL={endpoint}/v1`
- Nexa：`NIMI_RUNTIME_LOCAL_NEXA_BASE_URL={endpoint}/v1`

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
    "nexa":    { "enabled": false, "version": "", "port": 8000 }
  }
}
```

ENV 覆盖：`NIMI_RUNTIME_ENGINE_LOCALAI_ENABLED`、`NIMI_RUNTIME_ENGINE_LOCALAI_VERSION`、`NIMI_RUNTIME_ENGINE_LOCALAI_PORT`；Nexa 同理（`NEXA` 替代 `LOCALAI`）。

受管 LocalAI image backend 约束：

- `engines.localai.imageBackend.mode` 允许 `disabled|official|custom`。
- `official` 模式表示 runtime 负责供应并启动官方 `stablediffusion-ggml` external gRPC backend，再通过 `--external-grpc-backends` 接入 LocalAI。
- `custom` 模式表示 runtime 负责启动自定义 backend command，并以 `address` 作为 LocalAI gRPC 连接目标。
- 该 backend 必须作为 daemon-managed local service 对外可见；用户不得通过通用 service lifecycle RPC 直接 install/start/stop/remove 它。

自动托管推导（LocalAI）：

- 当 `providers.local.baseUrl`（等价 env：`NIMI_RUNTIME_LOCAL_AI_BASE_URL`）为回环地址（`localhost`/`127.0.0.1`/`::1`）且 `engines.localai.enabled` 未被显式设置（配置文件与环境变量均未给值）时，runtime MUST 推导 `engines.localai.enabled=true`，并进入 SUPERVISED 启动链路。
- 显式覆盖优先级：`engines.localai.enabled` 的显式配置（`true` 或 `false`）始终高于自动推导。
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

当安装或启动时 `endpoint` 为空：

- `localai`：自动注入默认端点。
- `nexa`：返回 `INVALID_ARGUMENT` + `AI_LOCAL_ENDPOINT_REQUIRED`。

## K-LENG-006 OpenAI-compatible HTTP 协议基线

所有 Phase 1 引擎均遵循 OpenAI-compatible HTTP API：

- 文本生成：`POST /v1/chat/completions`（`stream=false`）
- 流式生成：`POST /v1/chat/completions`（`stream=true`）
- 嵌入：`POST /v1/embeddings`
- 模型列表：`GET /v1/models`
- 图像生成：`POST /v1/images/generations`
- 语音合成：`POST /v1/audio/speech`
- 语音识别：`POST /v1/audio/transcriptions`

引擎特有的非标 API（如 LocalAI 的 video backend）通过 `LocalProviderHints` 描述，不作为通用协议基线。

LocalAI 动态图片工作流补充：

- companion asset（如 `vae` / `llm` / `clip`）不要求静态注册进 `localai-models.yaml`。
- runtime 可在请求时基于主模型 `engine_config`、显式 artifact 选择与本次 profile override 渲染临时 profile，并通过 `POST /models/import` 动态导入。
- `components[]` 为 LocalAI dynamic image workflow 必填输入；缺失或空数组时，runtime 必须在 import 前 fail-close（`INVALID_ARGUMENT` + `AI_INPUT_INVALID`），不得猜测默认 `vae` / `llm` companion。
- `profile_overrides` 仅允许覆盖非路径字段；若只有 `profile_overrides` 而没有显式 companion 选择，runtime 不得继续生成动态 alias profile。
- LocalAI image 模型的健康判定不得仅依赖 `/v1/models` 静态列表。

## K-LENG-007 健康探测协议

> 本协议适用于本地引擎健康探测。云端 provider 探测使用 K-PROV-003（探测路径与健康判定标准不同）。

健康探测使用 `GET /v1/models`：

- HTTP 200 且响应包含有效模型列表 → 健康。
- HTTP 非 200 或连接失败 → 不健康。
- 探测超时：默认 5 秒，不可配置（Phase 1）。

探测频率由调用方决定（daemon 默认 8 秒周期），本规则仅定义协议。

## K-LENG-008 引擎配置来源优先级

引擎相关配置项（endpoint、api_key 等）的来源按以下优先级合并（高优先覆盖低优先）：

1. RPC 请求参数（`InstallLocalModel.endpoint` 等）
2. 环境变量（`NIMI_RUNTIME_LOCAL_AI_BASE_URL`、`NIMI_RUNTIME_LOCAL_NEXA_BASE_URL` 等，命名与 `K-PROV-002` 一致）
3. 配置文件（`K-DAEMON-009` 定义的配置路径，即 `~/.nimi/config.json` 的 provider 相关段）
4. 引擎默认值（`K-LENG-005`）

RPC 请求参数仅影响当次操作，不持久化覆盖配置文件值。

## K-LENG-009 凭据安全策略

- 配置文件中禁止明文 `apiKey` 字段；仅允许 `apiKeyEnv` 引用环境变量名。
- 运行时读取 `apiKeyEnv` 指向的环境变量值作为实际凭据。
- `apiKeyEnv` 引用的环境变量不存在或为空时：该 provider 视为未配置凭据（不影响不需要凭据的本地引擎）。

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
