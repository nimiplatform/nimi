# Provider Health Contract

> Owner Domain: `K-PROV-*`

## K-PROV-001 Provider 健康状态机

每个 AI Provider 维护独立健康状态：

| 状态 | 含义 |
|---|---|
| `unknown` | 初始态，从未探测 |
| `healthy` | 最近一次探测成功 |
| `unhealthy` | 最近一次探测失败 |

状态迁移规则：
- `unknown → healthy`：首次探测成功。
- `unknown → unhealthy`：首次探测失败。
- `healthy → unhealthy`：探测失败。连续失败计数从 0 开始递增。
- `unhealthy → healthy`：探测成功。连续失败计数归零。
- 状态变更时更新 `lastChangedAt`；每次探测更新 `lastCheckedAt`。

快照字段：`name`、`state`、`lastReason`、`consecutiveFailures`、`lastChangedAt`、`lastCheckedAt`。

## K-PROV-002 探测目标

Provider 探测目标从配置（`K-DAEMON-009`）与环境变量解析，固定为：

| 探测名称 | Base URL 环境变量 | API Key 环境变量 |
|---|---|---|
| `local` | `NIMI_RUNTIME_LOCAL_LLAMA_BASE_URL` | `NIMI_RUNTIME_LOCAL_LLAMA_API_KEY` |
| `local-image` | daemon-managed image backend (internal attribution only) | n/a |
| `local-media` | `NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL` | `NIMI_RUNTIME_LOCAL_MEDIA_API_KEY` |
| `local-speech` | `NIMI_RUNTIME_LOCAL_SPEECH_BASE_URL` | `NIMI_RUNTIME_LOCAL_SPEECH_API_KEY` |
| `local-sidecar` | `NIMI_RUNTIME_LOCAL_SIDECAR_BASE_URL` | `NIMI_RUNTIME_LOCAL_SIDECAR_API_KEY` |
| `cloud-nimillm` | `NIMI_RUNTIME_CLOUD_NIMILLM_BASE_URL` | `NIMI_RUNTIME_CLOUD_NIMILLM_API_KEY` |
| `cloud-dashscope` | `NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL` | `NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY` |
| `cloud-volcengine` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_BASE_URL` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_API_KEY` |
| `cloud-volcengine-openspeech` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_BASE_URL` | `NIMI_RUNTIME_CLOUD_VOLCENGINE_OPENSPEECH_API_KEY` |
| `cloud-gemini` | `NIMI_RUNTIME_CLOUD_GEMINI_BASE_URL` | `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY` |
| `cloud-minimax` | `NIMI_RUNTIME_CLOUD_MINIMAX_BASE_URL` | `NIMI_RUNTIME_CLOUD_MINIMAX_API_KEY` |
| `cloud-kimi` | `NIMI_RUNTIME_CLOUD_KIMI_BASE_URL` | `NIMI_RUNTIME_CLOUD_KIMI_API_KEY` |
| `cloud-glm` | `NIMI_RUNTIME_CLOUD_GLM_BASE_URL` | `NIMI_RUNTIME_CLOUD_GLM_API_KEY` |
| `cloud-deepseek` | `NIMI_RUNTIME_CLOUD_DEEPSEEK_BASE_URL` | `NIMI_RUNTIME_CLOUD_DEEPSEEK_API_KEY` |
| `cloud-openrouter` | `NIMI_RUNTIME_CLOUD_OPENROUTER_BASE_URL` | `NIMI_RUNTIME_CLOUD_OPENROUTER_API_KEY` |

仅 Base URL 非空的目标参与探测。

本地 provider 补充：

- `local-image` 仅用于 daemon-managed image backend 的健康归因与审计，不从环境变量装配独立 probe target。
- `local-media` 在 `supported_supervised` host 之外不得由 runtime 自动注入默认 loopback probe target。
- 当 host 仅支持 `attached_only` 时，只有调用方显式配置的 `NIMI_RUNTIME_LOCAL_MEDIA_BASE_URL` 才参与 provider health 探测。
- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised health 归因的唯一平台事实源。health attribution 必须消费 v2 matrix resolver 输出的 `entry_id`、`backend_family`、`backend_class`、`product_state`；不得各自推断。
- `local-media` 的 host support 判断不得只按 public engine=`media` 一刀切；必须由 v2 matrix resolver 输出的 `backend_class` / `backend_family` / `control_plane` / `execution_plane` 驱动。
- `product_state=unsupported` 的 entry 命中时，health 必须返回 recognized-but-unsupported 归因并以 `AI_LOCAL_MODEL_UNAVAILABLE` fail-close。`product_state=proposed` 且 admission 未通过时同理。
- `darwin/arm64` 与 `windows/amd64 + nvidia + cuda_ready` 上的 daemon-managed `stablediffusion-ggml` supervised probe target 属于正式支持的 canonical image path；provider health 必须直接消费 v2 matrix selection，不得再附加独立的 host-generation 门槛。
- 当 image 资产被 v2 matrix resolver 判定为 `backend_class=native_binary` + `control_plane=runtime` 时，provider health 归因必须落到 runtime-owned image control plane 与其真实受管 backend，不得继续把它视为 attached-only `local-media` 资产并要求外部 endpoint。
- 对 runtime-owned supervised image 资产（`control_plane=runtime`, `execution_plane=media`）：
  - `local-media` probe target仍是 app-facing execution health 的唯一 loopback 事实源。
  - `local-image` 仅用于 daemon-managed image backend 的内部健康归因，不得替代 `local-media` execution probe。
  - health attribution detail 必须带上 `backend_family`、`entry_id`、`internal_reason_key`（K-LENG-017）。
- 对 `backend_class=python_pipeline` 的 runtime-owned image 资产：
  - `local-media` 承担 execution health，runtime 负责 control-plane 归因与状态投影。
  - health attribution detail 必须包含 `backend_family=diffusers`、`entry_id`、`internal_reason_key`。
  - Python runtime / venv 损坏、依赖安装失败等必须以对应 `internal_reason_key` 归因，不得泛化为 generic provider unavailable。
- `local-speech` 作为完整 supervised engine，与 `local` / `local-media` 一样按显式 Base URL 配置参与 provider health 探测。
- `local-media` 的 `/healthz` 必须只在依赖、设备、默认模型与默认管线全部 ready 后返回 `2xx`；不得使用静态 `"ok"` 健康响应伪装就绪。
- v2 观测字段（`backend_family`、`backend_class`、`product_state`、`control_plane`、`execution_plane`）本轮只允许落在 runtime-private resolved detail、provider hints `extra`、audit detail；不新增 `AIProviderHealthSnapshot` typed 字段。

## K-PROV-003 探测间隔与策略

> 本协议适用于云端 provider 探测目标（K-PROV-002）。本地引擎健康探测使用 K-LENG-007。

- **基础探测间隔**：默认 8s（`NIMI_RUNTIME_AI_HEALTH_INTERVAL` 可覆盖）。
- **HTTP 超时**：默认 30s（`NIMI_RUNTIME_AI_HTTP_TIMEOUT` 可覆盖）。
- **探测路径**：按序尝试 `/healthz` → `/v1/models`，任一路径返回 `2xx` 即视为健康；`401`/`403`/`429`（server 可达但配置/限流问题）亦视为健康；`404` 触发下一探测路径；其余 `4xx` 与 `5xx` 视为不健康。
- `local-media` 为例外：canonical provider probe 固定为 `/healthz` → `/v1/catalog`。
  - **设计取舍（K-PROV-003）**：`401`/`403` 标记为 healthy 意味着 API key 无效或权限不足的 provider 在健康面板显示"健康"，但该 provider 的所有 AI consume 请求会失败并返回 `UNAVAILABLE + AI_PROVIDER_UNAVAILABLE`（K-ERR-005）。此为有意设计：健康探测回答的是"server 是否可达"，而非"凭据是否有效"。两个信号服务不同用途——健康面板用于网络连通性诊断，consume 错误用于凭据配置诊断。Desktop UI 应在 provider 显示 healthy 但 consume 持续返回 `AI_PROVIDER_UNAVAILABLE` 时，引导用户检查 API key 配置而非网络连通性。
- **探测时机**：daemon 启动后立即执行首次探测，之后按间隔周期性执行。
- **暂停条件**：daemon 处于 `STOPPING`/`STOPPED` 时跳过探测。

## K-PROV-004 Provider 健康与 Runtime 状态联动

- 所有探测目标均不健康时：Runtime 健康降级为 `DEGRADED`（reason: `ai-provider:<name> unavailable`）。
- 任一探测目标恢复健康时：若当前为 AI Provider 原因的 `DEGRADED`，恢复为 `READY`。
- 状态变更时写入审计事件（domain: `runtime.ai`, operation: `provider.health`）。

## K-PROV-005 Provider 名称归一化

配置文件中的 provider 名称仅允许 canonical 值：

- `local`、`llama`、`media`、`sidecar`
- `nimillm`
- `dashscope`
- `volcengine`、`volcengine_openspeech`
- `gemini`
- `minimax`
- `kimi`
- `glm`
- `deepseek`
- `openrouter`
- `openai`
- `anthropic`
- `openai_compatible`

非 canonical 名称（包含历史 alias 与 legacy 名称）在配置校验时拒绝。

执行命令：

- `pnpm check:runtime-provider-alias-hardcut`

**约束点**：`CreateConnector` / `TestConnector` / `ListConnectorModels` 的 provider 输入必须是 canonical 值；ConnectorService 入口统一校验并拒绝 alias。

Gemini 默认：当配置了 `NIMI_RUNTIME_CLOUD_GEMINI_API_KEY` 且未配置 Base URL 时，自动填充 `https://generativelanguage.googleapis.com/v1beta/openai`。不支持 `GEMINI_API_KEY` fallback。

## K-PROV-006 探测目标与 Provider 类型映射

探测目标（K-PROV-002）与 `provider-capabilities.yaml` 中 provider 类型的对应关系：

| 探测目标 | Provider Type | 说明 |
|---|---|---|
| `local` | `local` | llama 引擎 |
| `local-image` | `local` | daemon-managed image backend attribution target |
| `local-media` | `local` | media 引擎 |
| `local-speech` | `local` | speech 引擎 |
| `local-sidecar` | `local` | Attached music sidecar |
| `cloud-nimillm` | `nimillm` | NimiLLM 代理层 |
| `cloud-dashscope` | `dashscope` | 阿里云 DashScope |
| `cloud-volcengine` | `volcengine` | 字节跳动火山引擎 |
| `cloud-volcengine-openspeech` | `volcengine_openspeech` | 字节跳动开放语音 |
| `cloud-gemini` | `gemini` | Google Gemini |
| `cloud-minimax` | `minimax` | MiniMax |
| `cloud-kimi` | `kimi` | Moonshot Kimi |
| `cloud-glm` | `glm` | 智谱 GLM |
| `cloud-deepseek` | `deepseek` | DeepSeek |
| `cloud-openrouter` | `openrouter` | OpenRouter |

`openai`/`anthropic` 为直连 provider，不经过 Nimi 适配层，无独立探测目标。
## K-PROV-007 Managed Image Health Admission

- `tables/managed-image-backend-packages.yaml` gates whether a recognized `native_binary + stablediffusion-ggml` tuple may ever become healthy.
- When multiple package sources exist for one host tuple, provider health must use the tuple's canonical `product_state=supported` package source by default. Runtime-private experimental package sources must not affect health unless that source was explicitly selected inside runtime configuration.
- If the matrix recognizes the topology but the managed image backend package table marks the tuple unsupported, provider health must report recognized-but-unsupported detail and keep the asset unavailable.
- Health attribution for supported native-binary tuples must be based on the managed image backend gRPC target plus `local-media` execution readiness, not on llama management routes.
