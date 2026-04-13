# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `speech`：本地语音引擎族，负责 `audio.transcribe`、`audio.synthesize`、`voice_workflow.tts_v2v`、`voice_workflow.tts_t2v`
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`media.diffusers` 仅允许作为 `media` 的 runtime 内部 fallback driver；不是 public engine target。若要把 `media.diffusers` 升格为 matrix-supported canonical backend family，必须在同一轮 cutover 中同步修订 `K-LENG-004`、`K-MMPROV-010`、`K-PROV-002` 的对应规则。
`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。

`engine=media` 可承载多个 `backend_class`：

- `native_binary`：原生二进制受管 backend（当前：`stablediffusion-ggml`）
- `python_pipeline`：受管 Python pipeline backend（候选：`diffusers`）

`backend_class` 与 public `engine` 正交；`backend_class` 不是 public engine target，也不是 provider alias。

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
- `media`：管理 image/video 执行 backend。`engine=media` 不能按引擎名整体决定 host support；必须结合 `asset_family`、`backend_class`、`backend_family` 与 `tables/local-image-supervised-backend-matrix.yaml` v2 matrix resolver 输出判断真实受管 backend。
- `speech`：管理 `whispercpp`、`kokoro` 与 `qwen3tts` 等 Phase 1 语音 driver，并负责语音基础能力与 voice workflow 探测。
- `media.diffusers`：只在 `media` 不支持 family / artifact completeness / pipeline variant 时作为内部 fallback 启动。当前 kernel 基线仍规定 `media.diffusers` 不得作为 public engine target，不得在未完成规范修订前直接升格为 matrix-supported canonical path。

资产级 supervised 规则：

- `tables/local-image-supervised-backend-matrix.yaml`（v2）是 canonical local image supervised backend matrix 的唯一事实源。
- canonical local image product path 固定为：
  - `kind=image`
  - `engine=media`
  - `engine_runtime_mode=SUPERVISED`
  - app-facing consume endpoint 为 `local-media`
  - `ATTACHED_ENDPOINT` 不作为 canonical local image product path 的合法 fallback
- v2 matrix 当前定义三类 image asset family topology：
  - `gguf_image`：GGUF 单文件主模型，`artifact_formats=[gguf]`，`profile_kind=single_binary_model`，`backend_family=stablediffusion-ggml`
  - `safetensors_native_image`：单文件 safetensors 主模型（不含 `model_index.json` 或 workflow bundle marker），`artifact_formats=[safetensors]`，`profile_kind=single_binary_model`，`backend_family=stablediffusion-ggml`
  - `workflow_safetensors_image`：由 `model_index.json` / workflow bundle 驱动的 pipeline bundle，`artifact_formats=[safetensors, json_config]`，`profile_kind=workflow_pipeline`，`backend_family=diffusers`
- `safetensors_native_image` 与 `workflow_safetensors_image` 的边界判据：`model_index.json` 存在或 workflow bundle completeness 满足时归入 `workflow_safetensors_image`；仅有单文件 `.safetensors` 且不满足 workflow bundle 判据时归入 `safetensors_native_image`。仅因 `artifact_roles` 非空不得自动升级为 workflow topology。
- v2 matrix 按 `entry_id` 索引，每个 entry 以 `platform + asset_family + backend_family + profile_kind` 组合标识一个 topology 槽位。
- `topology_state` 与 `product_state` 分离：
  - `topology_state=defined`：runtime 可解析该 topology
  - `topology_state=deprecated`：仍可识别，不再建议新安装
  - `topology_state=removed`：仅迁移/repair/audit，不参与 canonical resolution
  - `product_state=supported`：允许进入 install recommendation、activation、ready health success
  - `product_state=proposed`：命中后必须返回 recognized-but-not-admitted fail-close
  - `product_state=unsupported`：命中后必须返回 recognized-but-unsupported fail-close
- `engine=media` 且 runnable capability 为 `image.generate` / `image.edit` 时，`SUPERVISED` host support 必须由 v2 matrix resolver 输出的 `backend_class` / `backend_family` / `control_plane` / `execution_plane` 驱动，而不是复用整个 `media` 引擎的粗粒度 host 分类。
- 对 `backend_class=native_binary` + `backend_family=stablediffusion-ggml` + `control_plane=runtime` 的 entry：
  - image orchestration、profile/slot 解析、activation/health、错误投影全部由 runtime 自身负责。
  - `LocalAssetRecord.endpoint` 与本地 consume route 的真实执行 endpoint 仍必须指向 `media` canonical loopback（`local-media`）；runtime 不得额外暴露独立 image control-plane endpoint。
  - runtime 启动/探测时只要求满足 execution plane（`local-media`）与 daemon-managed image backend 的 supervised 生命周期；不得再要求 `llama` 作为 image control plane 参与启动。
- 对 `backend_class=python_pipeline` + `backend_family=diffusers` + `control_plane=runtime` 的 entry：
  - `control_plane` 仍由 runtime 承载，`execution_plane` 由 `media` 进程承载。
  - internal lifecycle 仍保持与双平面模型同一套状态字面量（见 K-LENG-013）。
  - Python runtime bootstrap、venv 管理、依赖安装必须统一走 `uv` 管道（见 K-LENG-016）。
- 对 daemon-managed `stablediffusion-ggml` backend：
  - `darwin/arm64` 属于正式支持的 canonical `gguf_image` supervised host tuple。
  - `windows/amd64 + nvidia + cuda_ready` 也属于正式支持的 canonical `gguf_image` supervised host tuple。
  - runtime 不得再附加独立于 v2 matrix 之外的 Apple 代际门槛；install plan / import / registration / health 统一以 canonical matrix selection 为准，不得额外要求 `M5+` / `A19+`。
- `engine=media` 的 `video.generate` / `i2v` 等其它能力仍可继续沿用 `media` 自身的 host support 规则，直到对应 supervised backend 明确实现。
- 同一规则必须统一驱动 install plan、runtime mode 解析、startup warnings、health warnings 与 attached-endpoint-required 判定；不得在不同入口各自重新推断。

禁止事项：

- 不得以 `LocalAI / Nexa` 作为 supervised 代理层。
- 不得把 `media.diffusers` 伪装成主引擎。
- 不得把 `backend_class`、`backend_family` 暴露给 app / mod 作为 public routing knob。
- 不得把 canonical local image path 降级为 `ATTACHED_ENDPOINT`。
- 不得把 `media.diffusers`、`stablediffusion-ggml` 等 backend 名称提升为 public engine target。

## K-LENG-012 Resolver 唯一匹配规则

v2 matrix resolver 必须满足以下不变式：

- 每个 image asset 在当前 host 上最多命中一个 canonical topology selection。
- canonical resolution 的匹配顺序固定为：
  1. `host_match` 精确约束命中
  2. `asset_family`
  3. `profile_kind`
  4. `artifact_formats`
  5. `supported_capabilities` / capability support
  6. `topology_state` 过滤
  7. `product_state` 过滤
  8. `admission_gate` 判定

过滤规则：

- `topology_state=removed` 不参与 canonical resolution。
- `topology_state=deprecated` 仅在无 `defined` 命中时参与 legacy migration / repair 判定，不得成为新安装默认路径。
- `product_state=supported` 才允许进入 install recommendation、activation、ready health success。
- `product_state=proposed` 命中后必须返回 recognized-but-not-admitted 的 fail-close 语义。
- `product_state=unsupported` 命中后必须返回 recognized-but-unsupported-on-current-product-surface 的 fail-close 语义。

冲突规则：

- 若多个 entry 在 canonical resolution 后仍同时命中，runtime 必须返回配置/规范冲突错误。
- runtime 不得自行任选其一。
- 该冲突必须进入 audit detail，并阻断 install / start / health success。

Resolver 输入分为两层：

- canonical inputs（驱动 canonical resolution）：host platform、asset manifest / runtime-native facts、`kind`、`capabilities`、`asset_family`、`artifact_formats`、`profile_kind`、bundle completeness、slot / materialization truth
- legacy hints（仅用于 migration normalization，不得主导 canonical resolution）：`engine_config.backend`、`preferred_engine`

Resolver 输出至少包含：`entry_id`、`product_state`、`backend_class`、`backend_family`、`control_plane`、`execution_plane`、`supported_capabilities`、catalog comparable identity、compatibility detail。

约束：

- canonical topology resolution 必须由 runtime-native asset facts 驱动，不得由 legacy routing hints 决定。
- `preferred_engine` 是公开摘要/展示字段，不是 topology fact。
- `engine_config.backend` 仅允许作为导入旧资产时的过渡线索；一旦 family / profile / materialization 已归一化，就必须失效。
- 若 canonical facts 缺失，resolver 必须 fail-close 或进入 migration-needed / repair-required 语义；不得把 legacy hint 直接提升为 truth。

Admission gate contract 注册：

- `admission_gate` 只允许出现在 `product_state=proposed` 的 entry。
- `admission_gate` token 的值域必须来自 kernel prose 的显式注册；table comment 或单独 table entry 不得成为唯一注册源。
- 本轮唯一注册的 admission contract 是 `apple-mps-image-poc`：
  - 仅用于 `workflow_safetensors_image -> diffusers -> python_pipeline` 的 Apple Silicon PoC admission。
  - 证据必须写入 local execution report route patterns（如 `.local/report/**`）。
  - gate 通过后，必须在同一 spec cutover 中把对应 entry 提升为 `product_state=supported` 并移除 `admission_gate`。
  - 历史证据保留在 local-only execution reports / audit（如 `.local/report/**`）；稳定 kernel table 不保留“已通过 gate 但仍挂着 gate token”的状态。

## K-LENG-013 单机单 Canonical Mode 仲裁

v1 每个 runtime state root（默认 `~/.nimi`）同时只能有一个 canonical `local-media` supervised active selection。

规则：

- 允许多个 image asset 安装存在，但只允许一个 selection 拥有 activation 权。
- 仲裁优先级固定为：`supported` active selection 优先；若无 `supported`，不得自动激活 `proposed` 或 `unsupported`。
- 当已存在 active `gguf_image` selection 时导入 `workflow_safetensors_image` 或 `safetensors_native_image`：可安装，不可自动接管 `local-media`，必须保持 inert / non-active。
- 当 active selection 被 remove 或 become unhealthy：runtime 可重新仲裁，但只能在 `supported` 集合内重选。
- repair 不得改变 active ownership，除非显式满足重新仲裁条件。
- v1 不支持同一 host 同时运行 GGUF `proxy_execution` 与 safetensors `pipeline_supervised` 两个 media 实例并共用 canonical product path。

## K-LENG-014 Image Supervised Mode 语义

`media_server.py` 必须区分两类 mode，由 `NIMI_MEDIA_MODE` 环境变量驱动：

1. `proxy_execution`：服务于 runtime-owned `native_binary` image 路径，health / catalog 暴露 runtime-owned proxy execution truth；稳定产品路径上不得再承担 image generation control-plane。
2. `pipeline_supervised`：服务于 runtime-owned `python_pipeline` image 路径，health / catalog 暴露真实 pipeline truth。

Mode 与 resolver 的映射固定：

| resolver output | `NIMI_MEDIA_MODE` 目标值 |
|---|---|
| `control_plane=runtime`, `execution_plane=media`, `backend_class=native_binary` | `proxy_execution` |
| `control_plane=runtime`, `execution_plane=media`, `backend_class=python_pipeline` | `pipeline_supervised` |

HTTP contract：

- `proxy_execution` 与 `pipeline_supervised` 共享同一 canonical HTTP surface：`GET /healthz`、`GET /v1/catalog`、`POST /v1/media/image/generate`。
- request body 与 artifact response envelope 在两种 mode 下保持同形；mode 差异只允许体现在 runtime-private detail / checks / catalog metadata。
- `proxy_execution` 下的 `POST /v1/media/image/generate` 若未连接到 runtime-owned direct execution contract，必须 fail-close；不得再通过 llama route、llama management route 或其它 legacy control-plane 伪造成功。
- `/models/import` 不属于 canonical image supervised contract；runtime-owned image path 不得依赖 llama model import API。

## K-LENG-015 Internal Lifecycle 状态机

无论是 runtime-owned native-binary path 还是 runtime-owned python-pipeline path，都必须复用同一 internal lifecycle：

1. `resolved` → 2. `materialized` → 3. `installed` → 4. `control_plane_ready` → 5. `execution_plane_ready` → 6. `active`

退化路径：`degraded`、`repair_required`。

重要约束：

- 以上状态机是 runtime-private internal lifecycle，不直接替换现有 public lifecycle。
- 对 app / mod / sdk 的稳定投影仍必须继续落在：`INSTALLED`、`ACTIVE`、`UNHEALTHY`、`REMOVED`。

状态 owner：

| internal lifecycle | owner |
|---|---|
| `resolved` | resolver |
| `materialized` | materializer |
| `installed` | local state |
| `control_plane_ready` | engine supervisor |
| `execution_plane_ready` | execution health aggregator |
| `active` / `degraded` / `repair_required` | runtime aggregator |

持久化边界：

- 持久化：`installed`、`repair_required`、active selection ownership
- 仅运行时聚合：`control_plane_ready`、`execution_plane_ready`、`degraded`
- 仅可审计 runtime-private detail：`resolved`、`materialized`

Internal lifecycle 到 public lifecycle 的投影：

| internal lifecycle | public lifecycle |
|---|---|
| `resolved` / `materialized` | 不得单独对外提升状态 |
| `installed` | `INSTALLED` |
| `control_plane_ready` 但 `execution_plane_ready=false` | `UNHEALTHY` |
| `execution_plane_ready` 但 control plane 未满足 | `UNHEALTHY` |
| `active` | `ACTIVE` |
| `degraded` | `UNHEALTHY` |
| `repair_required` | `UNHEALTHY` |

合法迁移路径（禁止跳过中间状态）：

- `resolved -> materialized -> installed -> control_plane_ready -> execution_plane_ready -> active`
- `active -> degraded`（任一平面失去 ready）
- `active -> repair_required`（完整性失真）
- `degraded -> active`（双平面重新同时满足 ready）
- `degraded -> repair_required`（降级原因被判定为完整性问题）
- `repair_required -> resolved`（topology truth 失配，必须重新进入 resolver）
- `repair_required -> materialized`（repair / rematerialization 成功）
- `repair_required -> installed`（仅需重建安装态）
- 不得从 `active` 直接跳回 `resolved`
- 不得从 `resolved` 直接跳到 `active`

双平面聚合规则（`llama/media`）：

| control plane | execution plane | internal lifecycle | execute/generate |
|---|---|---|---|
| ready | ready | `active` | 允许执行 |
| ready | not ready | `degraded` | fail-close |
| not ready | ready | `degraded` | fail-close |
| starting/restarting | any | `degraded` | fail-close |
| failed | any | `repair_required` 或 `degraded` | fail-close |

单平面聚合规则（`media/media`）：internal lifecycle 仍保持同一套状态字面量，不单独发明压缩版状态机。`installed -> control_plane_ready` 表示进程 bootstrap 完成；`control_plane_ready -> execution_plane_ready` 表示 `/healthz` ready + `/v1/catalog` ready + target catalog identity 可比较。

启动预算：

- `native_binary` image execution plane：180s（沿用当前 media supervised 基线）
- `python_pipeline` supervised：300s（pipeline load / warmup / 首次编译）
- Python 依赖准备与 venv 安装是独立 bootstrap 预算，不计入 300s pipeline ready 窗口
- 超过启动预算仍未形成 ready 证明，必须结束 starting / restarting，不得无限等待

## K-LENG-016 Python Runtime Management Contract

`python_pipeline` backend class 的 Python runtime 管理约束：

- v1 mandates `uv` 作为唯一 Python bootstrap 管道。不允许并存第二套 Python bootstrap 实现。
- v1 受管 Python 版本固定为 `3.12`。
- Python runtime 以 `engine=media` 的 supervised engine version 为作用域共享，不按 model 单独创建 venv。
- venv 路径固定在 `~/.nimi/engines/media/{version}/python/` 或等价 engine-root 私有目录。
- venv 必须绑定：engine version、Python version、package set / lock hash、host platform tuple、`backend_class=python_pipeline`。任一绑定因子变化都必须触发重建。
- 创建策略：staging dir -> verify -> atomic promote。校验失败必须进入重建或 fail-close。
- Python runtime 创建预算：120s。dependency install 预算：600s。pipeline warmup / ready 预算：300s。
- retry 只允许用于瞬时网络传输失败；不得把 ABI 不兼容、wheel 不存在、import 错误当作可重试成功路径。
- 不存在隐式离线 fallback；wheel source 必须由 engine bootstrap config 显式声明。
- venv 的 owner 是 runtime engine supervisor，不是单个 asset。清理只允许发生在 engine version 升级淘汰、显式 repair / maintenance、原子回收流程。

## K-LENG-017 错误归因模型

错误优先级链：compatibility > startup > health > execution。

v1 固定 internal reason key 集合（audit / health / structured error detail 共享同一组命名）：

| internal_reason_key | 场景 |
|---|---|
| `manifest_completeness_failure` | manifest schema invalid / required file-hash completeness failure / model_index.json 引用子模型缺失 |
| `bootstrap_failure` | bootstrap failed |
| `plane_not_ready` | control plane / execution plane not ready |
| `execution_failure` | runtime resolved but execution failed / pipeline 首次冷启动超时 |
| `python_version_incompatible` | Python version 不兼容 |
| `python_runtime_broken` | Python venv 损坏 / interpreter 不可用 |
| `python_dependency_install_failed` | torch wheel 安装失败 / ABI 不兼容 |
| `pipeline_load_timeout` | diffusers pipeline load 超时 |
| `catalog_identity_mismatch` | catalog ready 但 target identity 不可比较 |

入口级失败映射：

| 阶段 | 失败类型 | primary_reason_code |
|---|---|---|
| install | host unsupported | `AI_LOCAL_MODEL_UNAVAILABLE` |
| install | topology recognized but `product_state=unsupported` | `AI_LOCAL_MODEL_UNAVAILABLE` |
| install | topology recognized but `product_state=proposed` 且 admission 未通过 | `AI_LOCAL_MODEL_UNAVAILABLE` |
| profile/slot resolve | required slot 缺失或 slot asset UNHEALTHY | `AI_INPUT_INVALID` |
| import | manifest schema invalid | `AI_LOCAL_MANIFEST_SCHEMA_INVALID` |

强约束：

- canonical image path 永不返回 `AI_LOCAL_ENDPOINT_REQUIRED`。
- slot 缺失不得降级为"忽略该 slot"。
- catalog 静态列表不得当成 ready 证明。
- 双平面失败时只允许一个稳定主错误码；次级平面信息只能进入 `secondary_detail`。
- `repair_required -> resolved` 每次发生时，必须写入 audit event（至少包含 `old_entry_id`、重新解析原因、触发入口与时间戳）。

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
- `llama` 只承载文本与理解能力；`media` / `media.diffusers` 只承载图像/视频生成能力；`speech` 只承载语音与 voice workflow 能力。
- 用户层不得直接暴露 workflow、companion model 拼装或 pipeline DAG。

## K-LENG-007 健康探测协议

`llama` 健康探测：

- `GET /v1/models` 成功仅说明进程可达。
- 对 `text.generate` / `text.embed` 至少还需一次最小执行或等价 warmup 成功，才能视为 ready。
- supervised `llama` 在首次最小执行 / warmup 失败时，必须保留失败阶段、退出码或 stderr 摘要等结构化细节；不得仅因 `/v1/models` 可达就把模型提升为 ready。
- 对 supervised `llama`，`/v1/models` 缺失目标模型只说明“当前 resident worker 未加载该模型”；对非当前 resident 的已验证模型，不得仅据此投影为 `UNHEALTHY`。
- 对 `image.understand` / `audio.understand` 还必须验证 companion artifact（如 `mmproj`）完整。

`media` / `media.diffusers` 健康探测：

- `/healthz` 返回 ready 且 `/v1/catalog` 存在至少一个与目标 `logical_model_id` 可比对的 ready entry，才算健康。
- catalog 不得暴露静态伪 model list。
- `media.diffusers` 作为 fallback 时，必须在探测结果中暴露 fallback 原因，不得静默替换。
- `engine=media` 的 image 资产若 backend/profile 解析到 `stablediffusion-ggml` 或其它实际受管 native-binary image backend，则 health 归因、bootstrap 目标与 host support 判断必须跟随实际受管 backend；不得因为 public engine 仍是 `media` 就错误要求 attached endpoint。
- 若 host 不满足 daemon-managed image backend 的硬件前提，health / registration detail 必须直接暴露 canonical matrix compatibility 原因，不得仅返回 `managed diffusers backend unavailable` 或其它泛化 backend 缺失错误。

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

## K-LENG-018 Llama Engine Config 参数空间

`engine_config.llama` 命名空间定义 typed 参数，由 runtime 投影到受管 `llama-server` CLI。所有 key 均为可选。已知 key 的非法值必须在 registration 阶段 fail-close，不得静默丢弃。

| Key | 类型 | 约束 | CLI flag |
|---|---|---|---|
| `ctx_size` | integer | 512..1048576 | `--ctx-size` |
| `cache_type_k` | enum | f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1 | `--cache-type-k` |
| `cache_type_v` | enum | f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1 | `--cache-type-v` |
| `flash_attn` | tri-state | on/off/auto | `--flash-attn` |
| `mmproj` | string | 相对路径，.gguf，必须存在 | `--mmproj` |
| `n_gpu_layers` | integer | ≥0 | `--n-gpu-layers` |

语义规则：

- 已知 key + 非法值：fail-close，阻断 registration。
- `engine_config.llama` 内的未知 key：忽略（forward compat），但进入 audit detail。
- `ctx_size` 未设置时，runtime 不主动放大上下文窗口；`llama-server` 使用自身默认值。
- `mmproj` 路径相对 ModelsPath 解析，解析后不得逃逸 models root。
- 若 bundle 文件列表存在多个 mmproj 候选且 `engine_config.llama.mmproj` 未显式指定，registration 必须 fail-close。
- 当前参数空间基于 `llama.cpp` b8645 实证。升级 `llama.cpp` 版本时必须重新验证参数签名。

## K-LENG-019 Supervised Llama Residency 语义

supervised `llama` 的 public residency truth 固定投影到 `LocalWarmState`，不得平行发明另一套 public residency enum：

- `COLD`：模型已安装/可路由，但当前未驻留到 supervised llama worker
- `WARMING`：runtime 正在为目标模型执行加载、切换或 ready 建证
- `READY`：当前已有可服务的 resident worker 命中该模型
- `FAILED`：最近一次加载/切换/ready 建证失败

约束：

- `LocalAssetStatus.ACTIVE` 表示“可被路由选择”，不表示“当前 resident”。
- `evicting` 在 Phase 0/Step A 保持 runtime-private，不进入 public state。
- Step A 固定为 request-routed single-worker switch：
  - 每次 llama 请求都必须显式绑定目标模型
  - 同模型请求必须复用同一 resident worker
  - 不同模型请求若需要切换 resident worker，runtime 必须显式协调；无法安全切换时必须 fail-close
- Step A 不得依赖“全局当前模型 = llama-models.yaml 第一条 entry”作为 stable product semantics。若 runtime 使用 YAML 作为内部配置载体，选择结果也必须由请求显式驱动，而不是由静态清单顺序隐式决定。
- bounded multi-worker residency（Step B）需要后续 spec cutover，至少补齐：
  - 多 worker 并存时的 Service / Engine truth
  - residency budget / keep_alive / eviction policy 的 public contract
  - 多 worker 对 `K-LOCAL-008` 的放宽方式
## K-LENG-020 Managed Image Backend Package Source

- `tables/managed-image-backend-packages.yaml` is the single normative source for runtime-owned managed image backend package materialization.
- Runtime must not infer a `stablediffusion-ggml` package ref from ad hoc code branches or from `llama-server backends install ...`.
- A host tuple may carry multiple `package_source` entries in the table, but exactly one `product_state=supported` entry is canonical for default resolution on that tuple.
- `product_state=proposed` package entries are runtime-private experimental sources. They may be selected only by an explicit runtime-private package-source selector and must never be auto-selected, implicitly promoted, or used as a hidden fallback when the canonical source is unavailable or slow.
- Current package admission is:
  - `darwin/arm64 + apple + stablediffusion-ggml`: supported via canonical LocalAI-derived OCI payload; official `stable-diffusion.cpp` direct archive remains runtime-private experimental only
  - `windows/amd64 + nvidia + cuda_ready + stablediffusion-ggml`: supported via runtime-owned direct archive package + runtime wrapper launch path
  - `linux/amd64 + nvidia + cuda_ready + stablediffusion-ggml`: unsupported until a published runtime-owned package exists
- A topology may remain recognized in `tables/local-image-supervised-backend-matrix.yaml` while package admission remains unsupported in `tables/managed-image-backend-packages.yaml`; runtime must fail-close rather than silently promoting the host tuple.

## K-LENG-021 Native-Binary Execution Cut

- For `backend_class=native_binary`, canonical execution must use the managed image backend gRPC contract directly (`LoadModel`, `GenerateImage`, `Free`).
- `local-media` remains the canonical app-facing HTTP surface for image execution and health projection, but native-binary success may not depend on proxy import support.
- Runtime must not treat llama `/models/import` as part of the canonical native-binary image path on any supported host tuple.
