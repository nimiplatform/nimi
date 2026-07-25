# Runtime Local Compute - Rationale

> 本文为 rationale/历史散文,非规范权威;规范 = `.nimi/spec/runtime/local-compute.authority.yaml`。

---

<!-- source: .nimi/spec/runtime/kernel/device-profile-contract.md -->

# Device Profile Contract

> Owner Domain: `K-DEV-*`

## K-DEV-001 设备画像结构

设备画像（`LocalDeviceProfile`）包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `os` | string | 操作系统标识（`linux`/`darwin`/`windows`） |
| `arch` | string | CPU 架构（`amd64`/`arm64`） |
| `total_ram_bytes` | int64 | 主机总内存（字节） |
| `available_ram_bytes` | int64 | 主机当前可用内存（字节） |
| `gpu` | `LocalGpuProfile` | GPU 信息（available/vendor/model/VRAM/memory_model） |
| `python` | `LocalPythonProfile` | Python 运行时（available/version） |
| `npu` | `LocalNpuProfile` | NPU 信息（available/ready/vendor/runtime/detail） |
| `disk_free_bytes` | int64 | 可用磁盘空间（字节） |
| `ports` | `[]LocalPortAvailability` | 端口可用性列表 |

`CollectDeviceProfile` RPC 返回当前设备的完整画像快照。

`LocalGpuProfile` 追加以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `total_vram_bytes` | int64? | GPU 总显存（字节）；无法可靠探测时为空 |
| `available_vram_bytes` | int64? | GPU 当前可用显存（字节）；无法可靠探测时为空 |
| `memory_model` | enum | `discrete | unified | unknown` |

## K-DEV-002 GPU 检测策略

GPU 检测按以下优先级执行（首个成功即返回）：

1. NVIDIA 命令行探测：`nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits` 成功
   - `available=true`
   - `vendor=nvidia`
   - `memory_model=discrete`
   - `model/total_vram_bytes/available_vram_bytes` 按返回值填充
2. Apple Silicon / unified memory 主机：
   - `vendor=apple`
   - `model` 必须尽量填充 Apple 芯片型号（如 `Apple M4 Max`），当前允许通过 `sysctl machdep.cpu.brand_string` 或等价 OS probe 获取
   - `memory_model=unified`
   - `total_vram_bytes/available_vram_bytes` 允许复用 host RAM 指标
3. 以上均未命中：
   - `available=false`
   - `memory_model=unknown`
   - `total_vram_bytes/available_vram_bytes` 为空

## K-DEV-003 GPU 检测覆盖范围

Phase 1 的显存探测以 NVIDIA `nvidia-smi` 与 Apple unified memory 为主。以下供应商/运行时仍标记为 deferred：

- AMD（ROCm）
- Intel（oneAPI）

当 host 无法可靠给出 VRAM/unified memory 数值时，`CollectDeviceProfile` 不得报错；调用方必须将此视为“低置信度硬件画像”，而不是缺省为 0。

## K-DEV-004 NPU 检测策略

Phase 1 的 NPU 检测完全由环境变量驱动，不执行 OS 级硬件探测：

- `NIMI_NPU_AVAILABLE=true` → `available=true`
- `NIMI_NPU_READY=true` → `ready=true`（仅当 `available=true`）
- `NIMI_NPU_VENDOR` → `vendor`
- `NIMI_NPU_RUNTIME` → `runtime`

所有环境变量缺失时：`available=false, ready=false`。

## K-DEV-005 Python 运行时检测

Python 检测按以下顺序尝试：

1. `python3 --version` → 解析版本号。
2. `python --version` → 解析版本号（fallback）。
3. 以上均失败 → `available=false`。

成功时 `available=true, version=<major>.<minor>.<patch>`。

## K-DEV-006 端口可用性探测

端口空闲判定使用 Runtime managed engines 的本机 loopback 暴露面尝试绑定：
`net.Listen("tcp", "127.0.0.1:<port>")`。

- 绑定成功（立即释放）→ `available=true`
- 绑定失败（`EADDRINUSE` 或其他）→ `available=false`

`CollectDeviceProfile` 默认探测端口列表：引擎默认端口（`K-LENG-005` 中各引擎的默认端口）。调用方可通过请求参数指定额外端口。

## K-DEV-007 硬件-引擎兼容性判定

安装计划解析（`ResolveModelInstallPlan`）根据以下规则生成 warnings：

| 引擎名特征 | 硬件要求 | 不满足时 warning |
|---|---|---|
| 包含 `cuda`/`nvidia`/`gpu` | `gpu.available=true` | `WARN_GPU_REQUIRED` |
| 包含 `python`/`py` | `python.available=true` | `WARN_PYTHON_REQUIRED` |
| 包含 `npu` | `npu.available=true && npu.ready=true` | `WARN_NPU_REQUIRED` |

warning 不阻止安装，仅在 `InstallPlanDescriptor.warnings` 中输出。

## K-DEV-008 设备画像缓存策略

Phase 1 不缓存设备画像：每次 `CollectDeviceProfile` 调用都实时采集所有字段。

> **触发点枚举**：daemon 不主动周期性采集。画像仅在以下时机刷新：(1) `CollectDeviceProfile` RPC，(2) `ResolveModelInstallPlan`/`ResolveProfile` 执行面归一化流程内，(3) `StartLocalAsset`/`StartLocalService` 流程内（`K-DEV-009`）。

未来可按需引入 TTL 缓存（不超过 60 秒），但必须保证以下场景强制刷新：

- `ResolveModelInstallPlan` 调用时
- `ResolveProfile` 调用时
- 用户显式请求设备画像时

推荐、profile requirement 展示与 install preflight 必须共享同一份 `LocalDeviceProfile` 真相源，不得为 recommendation 额外维护第二套私有硬件探测。

## K-DEV-009 运行时设备画像重校验

`StartLocalAsset` / `StartLocalService` 在执行启动流程前，必须重新采集设备画像并校验硬件兼容性（复用 `K-DEV-007` 规则）：

- 不通过时返回 warning（附加在响应中），但不阻断启动流程（Phase 1）。
- Phase 2 可升级为阻断策略（需新增配置开关）。

---

<!-- source: .nimi/spec/runtime/kernel/local-asset-storage-manifest-contract.md -->

# Local Asset Storage Manifest Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-025 资产存储布局

- 资产根目录: `~/.nimi/models/`
- 结构化目录固定为：
  - `objects/`
  - `sources/`
  - `recipes/`
  - `resolved/<local-asset-id>/asset.manifest.json`
  - `cache/{llama,media,diffusers}`
- **保留原始文件名**（非 content-addressable hash），理由：调试可读、生态工具兼容（vLLM/SGLang 等可直接引用）。
- `resolved/` 下的 `asset.manifest.json` 是本地 bundle 的统一规范入口（schema 见 `K-LOCAL-026`），适用于所有 asset kind（chat、image、video、tts、stt、vae、clip、lora、controlnet、auxiliary）。
- 嵌套目录保留原始结构（如 `speech_tokenizer/model.safetensors`）。
- `local-import/*` 是本地导入 asset id 命名空间，不是 `source.repo`、Hugging Face repo slug、`logical_model_id` 或 resolved path namespace。实现必须拒绝把 `local-import/*` source repo 当成文件位置；需要导入/重绑时必须使用 `file://.../asset.manifest.json`。

`~/.nimi/` 统一数据根布局：

```
~/.nimi/
├── runtime/
│   └── local-state.json
└── models/
    ├── objects/
    ├── sources/
    ├── recipes/
    ├── resolved/
    │   └── <local-asset-id>/
    │       └── asset.manifest.json
    └── cache/
        ├── llama/
        ├── media/
        └── diffusers/
```

Desktop/Tauri 面向用户与 App 的统一资产 manifest public contract 固定为 `resolved/<local-asset-id>/asset.manifest.json`。旧 `manifest.json`、`model.manifest.json`、`artifact.manifest.json` 不再是合法 public import/install 入口，实现必须 reject。

`resolved/` 是统一资产管理根目录；裸文件 intake 不得将 `resolved/` 视作 orphan/unregistered 候选。

## K-LOCAL-026 模型 Manifest Schema

`resolved/<local-asset-id>/asset.manifest.json` 结构定义；passive asset 与 runnable asset 共用该入口，但 `capabilities` 对 passive asset 必须为空，`logical_model_id` 对 passive asset 可省略：

```yaml
schema_version: "1.0.0"      # 必填
model_id: "org/model-name"    # 必填
capabilities: ["chat"]        # 必填，1+ 有效值
engine: "llama"               # 必填
entry: "model.safetensors"    # 必填，须在 files 中存在
files: [...]                  # 必填，entry 在首位
license: "apache-2.0"         # 必填
source:
  repo: "org/model-name"      # 必填
  revision: "main"            # 必填
hashes:                        # 必填，所有文件须有对应 hash
  "model.safetensors": "sha256:abc..."
```

校验规则：

- 所有必填字段非空。
- `entry` 须存在于 `files` 列表中。
- runnable asset 的 `capabilities` 每项须为有效值（`chat` | `image` | `video` | `tts` | `stt` | `embedding`）；passive asset 的 `capabilities` 必须为空，其 workflow 用途由 profile entry 的 `engineSlot` 决定。
- `hashes` 的所有 key 须指向存在的文件，value 非空。
- 文件路径规范化：拒绝绝对路径、拒绝 `..` 遍历、反斜杠转正斜杠。
- 导入态 manifest 的 `source.repo` 必须是当前 `asset.manifest.json` 的 `file://` URL。任何 `local-import/*` source repo 必须 fail-close；不得通过 slug、symlink、复制或 fallback 目录修复。

## K-LOCAL-027 格式支持策略

- **GGUF**: 量化格式，llama 引擎首选。
- **SafeTensors**: 全精度 / 多文件格式，未来主方向。
- 不锁定单一格式：新架构模型可能仅有 SafeTensors 版本。
- Entry 选择优先级（llama 引擎）：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

## K-LOCAL-028 Runtime 获取与执行所有权

- local asset（含所有 kind：chat、image、video、tts、stt、vae、clip、lora、controlnet、auxiliary）的搜索、下载、安装、导入、orphan scaffold/adopt、health/readiness、audit 与 transfer/progress 全部由 runtime 执行并持久化。
- desktop 不得再持有并回写第二套本地资产状态，不得通过 host-local state 推断安装成功、下载完成或资产可启动。
- desktop / web / apps 对本地资产的产品访问必须经 `RuntimeLocalService` typed surface；desktop host 仅保留 picker、reveal、notification 与等价 shell-native/helper 能力。
- future CLI / Web 路径扩展时必须继续复用 runtime 作为统一本地资产控制面，不得复制第二套执行面。
- passive asset 的生命周期（install / remove / transfer）与 runnable asset 共享同一执行管道与状态机（`K-LOCAL-005`），但 passive asset 不参与 Service 绑定与 Node 生成。
- `ListLocalAssets` 是 runtime-owned local inventory 的快照视图；它不得触发 endpoint probe、engine bootstrap、warm execution、recovery accounting、状态迁移或持久化写入。
- local asset health probe 的执行权只属于 `CheckLocalAssetHealth`、`StartLocalAsset`、`WarmLocalAsset`、真实 consume 前的 runtime-owned readiness 路径，以及 runtime-owned background health maintainer。SDK、Desktop、Web 与 apps 不得以 poll list、host cache、renderer-local probe 或 app-local retry state 形成第二套 health truth。
- runtime-owned background health maintainer 可以维护 supervised asset 的 health/readiness projection，但必须遵循 per-asset due gating、recovery interval 与 in-flight 合并；不得因多个 list/poll caller 放大为 N callers × M assets 的 endpoint probe。

## K-LOCAL-029 LocalAuditEvent 扩展字段契约

`LocalAuditEvent` 在 V1 扩展如下字段，并要求关键路径可观测：

- `trace_id`: 请求链路追踪 ID（优先取入站 metadata；缺失时服务端生成）。
- `app_id`: 调用方应用 ID（优先取入站 metadata；缺失可为空）。
- `domain`: 审计域（默认 `runtime.local_runtime`）。
- `operation`: 操作名（RPC 操作或事件类型，禁止空值）。
- `subject_user_id`: 调用主体（优先取认证身份；缺失可为空）。

`ListLocalAudits` 的过滤参数 `app_id` 与 `subject_user_id` 必须作用于上述字段，不得仅用于 token 摘要。

## K-LOCAL-030 Local Runtime 列表/搜索分页边界

以下 RPC 的分页边界遵循统一规则（与 `K-PAGE-005` 对齐）：

- `ListLocalAssets`（统一取代 `ListLocalAssets` 与 `ListLocalAssets`；支持 `kind` 过滤参数按 asset kind 筛选）
- `ListVerifiedAssets`（统一取代 `ListVerifiedAssets` 与 `ListVerifiedAssets`；支持 `kind` 过滤）
- `SearchCatalogModels`
- `ListLocalTransfers`
- `ListLocalServices`
- `ListNodeCatalog`
- `ListLocalAudits`

统一约束：

- 默认 `page_size=50`；
- 最大 `page_size=200`；
- `page_size>200` 必须裁剪为 `200`，不得回退为默认值；
- `page_token` 为空表示首页；
- 非法 `page_token` 返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。
- 所有 list/search RPC 必须保持 read-snapshot 语义。特别是 `ListLocalAssets` 只能读取 runtime 已持久化或内存中已承认的 local asset inventory projection；它不得为了“normalize”或“freshen”结果同步执行 health probe、engine bootstrap、warm、status mutation 或 persistence side effect。
- 需要 fresh health truth 的 caller 必须使用显式 health/warm/start RPC 或等待 runtime-owned background health maintainer 的投影更新；不得把 `ListLocalAssets` 作为隐式 health refresh API。

---

<!-- source: .nimi/spec/runtime/kernel/local-catalog-recommendation-contract.md -->

# Local Catalog Recommendation Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-021 SearchCatalogModels 结果排序

`SearchCatalogModels` 结果固定排序：

1. `verified=true` 在前，`verified=false` 在后。
2. 同组内按 `title ASC`（大小写不敏感）。

recommendation 可以作为结果元数据附带返回，但不得改写该排序规则。

## K-LOCAL-021a Catalog recommendation surface

`SearchCatalogModels`、`ListCatalogVariants` 与 `ResolveModelInstallPlan` 允许返回统一的可选 `recommendation` payload。该 payload 的语义固定为：

- `tier`：主模型适配度（main-model fit），不是端到端 workflow readiness
- `host_support_class`：`supported_supervised | attached_only | unsupported`
- `confidence`：`high | medium | low`

`recommendation` 不得覆盖 `install_available`、`engine_runtime_mode` 或现有 warning / reason_code 语义。

## K-LOCAL-021b Variant descriptor contract

`ListCatalogVariants` 返回的 variant descriptor 必须是格式感知结构，而不是 GGUF-only：

- `filename`
- `entry`
- `files[]`
- `format`
- `size_bytes?`
- `sha256?`
- `recommendation?`

GGUF v1 支持精确 entry 级 recommendation；SafeTensors v1 允许只做保守 repo/artifact 级 recommendation，并通过 `confidence=low` 暴露不确定性。

## K-LOCAL-021c Media recommendation v1

v1 `media-fit` 仅适用于 `image / video` 主模型，不评完整 workflow。规则固定为：

- 基于主模型文件大小 / 已知总大小、设备画像中的 RAM/VRAM/unified memory、以及 engine-specific conservative overhead profile 估算内存占用
- hard prerequisites（如 VAE / text encoder）计入估算与 note，但不直接决定主 tier
- baseline 固定：
  - `image-default-v1` = `1024x1024 text-to-image`
  - `video-default-v1` = `720p / 4s / 16fps / text-to-video / no audio`
- 头寸阈值固定：
  - `estimated_mem <= 70% budget` → `recommended`
  - `estimated_mem <= 85% budget` → `runnable`
  - `estimated_mem <= 100% budget` → `tight`
  - `estimated_mem > budget` → `not_recommended`

当 metadata 或设备画像不完整时，系统应降低 `confidence` 并附带 reason / note，而不是静默回退为高置信度结果。

## K-LOCAL-021d LLM recommendation via llmfit

`llmfit` recommendation 适用于 `LLM / vision-LLM` 主模型，并复用同一 `recommendation` payload：

- Runtime 必须将共享的 `LocalDeviceProfile` 映射到 `llmfit`/等价 Runtime-owned fit evaluator 所需的 system spec；不得绕过 `K-DEV` 另起一套私有硬件真相源
- v1 在无 `model-index` 前提下，允许基于 repo/title/tag、entry quant filename、以及 artifact size 对参数量 / context 做保守推断
- `fit_level` 映射固定为：
  - `Perfect -> recommended`
  - `Good -> runnable`
  - `Marginal -> tight`
  - `TooTight -> not_recommended`
- `recommended_entry` 可以指向与当前默认 entry 不同的更合适 quant 变体；其余变体进入 `fallback_entries`
- 当参数量、context 或 quant 只能从 filename/size 推断时，系统必须降低 `confidence` 或通过 reason / note 暴露推断来源

## K-LOCAL-021e Recommendation candidate feed

Runtime 允许在 catalog surface 之外暴露 capability-scoped `GetRecommendationFeed` read surface，用于 recommendation page：

- feed 的候选池可以来自 worker/index、verified corpus 或等价的 capability-first catalog，但必须输出 install-bridge-ready entry metadata
- model-index/cache、installed-state projection、device-profile fit evaluation、最终 `tier / host_support_class / confidence` 排序全部由 RuntimeLocalService 持有；Desktop/Tauri 只能消费 SDK projection 并渲染
- worker/index 只负责原始候选与 install-ready metadata；不得成为 host-fit、readiness 或 install action truth
- feed item 必须复用与 catalog 相同的 `recommendation` payload 语义，不得定义第二套 recommendation contract
- 引入 feed surface 不得改写 `SearchCatalogModels` 的固定排序规则；catalog 搜索仍遵循 `K-LOCAL-021`

## K-LOCAL-022 unhealthy 状态恢复策略

处于 `UNHEALTHY` 状态的 local model/service 执行定期探活恢复：

- **探活间隔**：与 `K-PROV-003` 一致，默认 8s。
- **恢复判定**：连续 3 次探活成功后迁移至 `ACTIVE`。
- **无最大重试限制**：保持持续恢复尝试，直到用户显式执行 `stop` 或 `remove`。设计理由：本地引擎通常因临时资源耗尽或进程崩溃而不可用，用户重启引擎后应自动恢复连接，无需手动干预。
- **探活降级策略**（限制长期不可用时的资源消耗）：
  - 连续失败 720 次（约 96 分钟 @ 8s 间隔）→ 探活间隔降级至 60s。
  - 自首次连续失败起累计 24h → 探活间隔降级至 5min。
  - 任一探活成功 → 重置至默认 8s 间隔。
- **探活失败**：重置连续成功计数，继续按间隔重试。

## K-LOCAL-023 HuggingFace 获取策略

在线模型来源唯一为 HuggingFace：

- 采用**直接 REST API 调用**（reqwest HTTP 客户端），**不引入** `hf-hub` crate 或 `@huggingface/hub` SDK。理由：最小化二进制体积与供应链风险。
- HF repo 标识规范化：接受 `hf://org/model`、`https://huggingface.co/org/model`、`org/model` 三种格式，内部统一为 `org/model`。
- 下载 URL 构造：`https://huggingface.co/{repo}/resolve/{revision}/{file_path}`
- AIProfile asset source binding may declare exactly one Hugging Face source
  object with repo id, repo type, revision, file/directory/manifest entries,
  access policy (`public | requires_auth | gated | unknown`), format/variant
  hints, and optional expected integrity. It is a portable source requirement,
  not runtime selected-source evidence.
- Runtime owns HF access/readiness. Auth token custody, gated repository access,
  terms/access approval, selected-source records, observed integrity, transfer
  state, and access-denied evidence are Runtime facts and must not be stored in
  AIProfile or AIConfig.
- A profile-owned downloader is forbidden. Descriptor prepare must route HF
  source readiness through Runtime local asset/materializer/source surfaces and
  fail closed when the Runtime cannot satisfy auth/gated/terms requirements.
- 401/403 or provider-equivalent auth/access denial must be classified as
  `source.hf_auth_required`, `source.hf_gated_unaccepted`, or
  `source.hf_access_denied` readiness, not generic download success/failure and
  not asset-health poisoning.
- Declared `expected_integrity` is a hard verification requirement. Absent
  `expected_integrity` is risk context only; it does not become
  provenance-verified evidence by implication.
- Manual import association may satisfy a source binding only as user-selected
  local association evidence. It must not imply HF provenance verification
  unless expected integrity or equivalent Runtime verification succeeds.
- 能力推断映射（`pipeline_tag` / `tags` → capability）：

| pipeline_tag | capability |
|---|---|
| `text-generation` | `chat` |
| `text2text-generation` | `chat` |
| `text-to-image` | `image` |
| `text-to-video` | `video` |
| `text-to-speech` / `text-to-audio` | `tts` |
| `automatic-speech-recognition` | `stt` |
| `feature-extraction` / `sentence-similarity` | `embedding` |

未匹配的 `pipeline_tag` / `tags` 不得回退为 `chat`。runtime 必须将其视为缺失 capability evidence，并 fail-close：该 HuggingFace row 不得进入可安装 / 可执行 catalog projection。

## K-LOCAL-024 下载管线契约

- **可恢复下载**: 使用 HTTP `Range` headers 实现断点续传。已下载的部分文件在重试时跳过已完成的字节范围。
- **重试策略**: 指数退避，最多 8 次（300ms → 1s → 5s → 15s → 30s → 60s → 120s → 180s）。
- **会话状态机**: `queued → running → paused|failed|completed|cancelled`。`pause/resume/cancel` 必须通过显式控制命令驱动，不允许 UI 侧“假暂停”。
- **重启恢复策略**: 进程重启后，残留 `running/queued` 会话必须转为 `paused` 并附带“下载被中断、需手动恢复”的 reason/detail；系统不得自动续传，必须由用户手动 `resume`。
- **逐文件 SHA256 校验**: hash 格式 `sha256:{hex}`，`sha256:` 前缀可选（兼容纯 hex 输入）。校验失败返回 `AI_LOCAL_DOWNLOAD_HASH_MISMATCH`。
- **原子提交**: staging → backup → commit（rename），失败 rollback：
  - staging 目录: `{models_dir}/{local_asset_id}-staging/`
  - 全部文件下载 + 校验通过后，原子 rename 为最终目录
  - 失败时 rollback：删除 staging，恢复 backup（如有）
- **进度上报**: 通过事件通道推送，结构包含 `install_session_id`/`phase`/`bytes_received`/`bytes_total`/`speed`/`eta`/`message`/`state`/`reason_code?`/`retryable?`/`done`/`success` 字段。
- **失败分级**:
  - 网络/超时/磁盘不足：`failed + retryable=true`，保留 partial staging，允许 `resume`。
  - hash mismatch：`failed + retryable=false`，清理 staging，禁止 `resume`。
  - cancel：`cancelled`，清理 staging。

## K-LOCAL-033 Gemma Family 与能力推断

family 推断：

- model ID 包含 "gemma" 时推断 family 为 `gemma`。

capability heuristic（仅在 manifest 未给出更强事实时生效）：

- model ID 包含 "gemma-4" 或 "gemma4" 时追加 `text.generate.vision`。
- "e2b" / "e4b" 变体是否追加 `text.generate.audio` 受 `llama.cpp` version gate 约束：当前 runtime 目标版本 `b8645` 已包含 `LLM_ARCH_GEMMA4` 与 Gemma 4 vision path，但公开源码中的 `libmtmd` `init_audio()` 仍未接入 `GEMMA4A` projector，因此 `text.generate.audio` 继续禁用，直到 Gemma 4 音频输入支持被上游公开实证。

companion 约束：

- 模型声明 `text.generate.vision` 能力但无可用 mmproj artifact 时，registration 必须 fail-close。

---

<!-- source: .nimi/spec/runtime/kernel/local-category-capability.md -->

# Local Category & Capability Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-000 Runtime Target Identity v2 Hard Cut

Local connector identity is retired by `K-RTARGET-006`. Local authorization and
execution target identity are owned by local asset/profile readiness and v2
local durable refs. Any older local connector category enum or raw local
`model_id` execution routing text in this file is retired as durable target
identity.

## K-LOCAL-001 固定 category（Phase 1）

Retired local connector capability families are historical vocabulary only.
They may describe imported local assets, but they are not connector kinds,
connector records, or durable execution target identity:

1. `LLM`
2. `VISION`
3. `IMAGE`
4. `TTS`
5. `STT`
6. `CUSTOM`

## K-LOCAL-002 capability 映射（Phase 1）

- `LLM` 承载 `CHAT` 与 `EMBEDDING`。
- `VISION` 表示“可接受视觉输入”的能力标记，不是独立执行模态。
- `IMAGE/TTS/STT` 与同名执行模态映射。
- `CUSTOM` 的 capability 来自模型元数据声明。
- `TTS` / `STT` 只映射 plain speech capability；不得把 `voice_workflow.voice_clone`、`voice_workflow.voice_design` 视为由 `TTS` category 自动隐含。
- baseline local `Qwen3-TTS` workflow line 不改变上述规则；即使 `Qwen3-TTS`
  同时承担 plain synth / clone / design，workflow capability 仍必须显式声明为
  `voice_workflow.*`，不得通过 `TTS` category 自动推导。

local category / local manifest token 到 canonical capability token 的正式映射以 `tables/capability-vocabulary-mapping.yaml` 为唯一事实源；本规则只定义语义边界，不复制第二套映射表。

## K-LOCAL-003 CUSTOM 可用性门槛

`local_invoke_profile_id` 是 `LocalAssetRecord` 的可选 string 字段，由 `InstallLocalAsset` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

## K-LOCAL-004 category 与路由解耦

connector 层是薄描述，不承载用户路由策略。具体执行路由由模型级元数据与执行模块决定。

Phase 1 的 6 个 system local connector 仅作为固定 category 的目录 / probe facade：

- 可用于 `ListConnectors`、`TestConnector`、`ListConnectorModels` 等能力发现与聚合探测场景
- 不得作为 AI consume 的 `connector_id` 执行入口
- 本地执行必须走 local 模型路由（见 `K-LOCAL-020`），而不是 local connector

## K-LOCAL-005 Local 生命周期状态机锚点

`local_model_lifecycle` 与 `local_service_lifecycle` 的状态与迁移来源由 `tables/state-transitions.yaml` 固定：

- 状态集合：`INSTALLED` `ACTIVE` `UNHEALTHY` `REMOVED`
- 对 `local_model_lifecycle`，语义固定为“可用性状态”而不是“用户手动运行态”：
  - `INSTALLED`：导入/安装后的短暂待验证态，不应作为长期产品展示目标
  - `ACTIVE`：runtime 已验证 bundle/registration/host 前置条件满足，可被路由选择；不要求进程常驻
  - `UNHEALTHY`：bundle、registration、warm/start 或真实运行探测失败，当前不可选
  - `REMOVED`：已移除
- `ACTIVE` 明确不等于“当前已加载到 worker / engine process 中”。
- `LocalWarmState` 是 public residency / warmth truth 的首要承载层：
  - `COLD`：当前未驻留/未加载，但仍可处于 `ACTIVE`
  - `WARMING`：正在加载、切换或建立 ready 证明
  - `READY`：当前已有可服务 residency
  - `FAILED`：最近一次加载/驻留尝试失败
- `local_model_lifecycle` 与 `warm_state` 必须并行表达，不得互相覆盖：
  - `ACTIVE + COLD` 是合法且稳定的 public 组合，表示“可路由但当前未驻留”
  - 不得仅因 `/v1/models` 未出现目标模型，就把该 asset 从 `ACTIVE/INSTALLED` 直接压成 `UNHEALTHY`
- 对 `local_service_lifecycle`，仍表示底层执行实例的运行/探测状态；它不等价于 Local Model Center 的用户可见 readiness badge。
- `local_model_lifecycle` 的典型迁移触发为 `install/register`、`background_validation`、`warm_or_runtime_failure`、`maintenance_stop`、`remove`；细粒度迁移表仍以 `tables/state-transitions.yaml` 为准。

任何 local 生命周期文档必须引用本 Rule ID，不得使用章节号样式来源（例如 `local-model_5.1`）。

## K-LOCAL-006 Local 不可用错误映射

当 local category 无可用模型（例如探活失败或无可执行实例）时：

- 探测路径：`ok=false` + `AI_LOCAL_MODEL_UNAVAILABLE`
- 执行路径：`FAILED_PRECONDITION` + `AI_LOCAL_MODEL_UNAVAILABLE`
- service 生命周期与探测路径必须使用 service 专属 sibling codes：`AI_LOCAL_SERVICE_UNAVAILABLE`、`AI_LOCAL_SERVICE_ALREADY_INSTALLED`、`AI_LOCAL_SERVICE_INVALID_TRANSITION`

## K-LOCAL-007 资产三层抽象

本地资产系统采用三层抽象：

- **Asset**（`LocalAssetRecord`）：用户与 App 可见的统一资产抽象。每条记录携带 `local_asset_id`（ULID）、`kind`（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`）、`logical_model_id`、`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements` 。passive asset（如 `vae`、`clip`、`lora`、`controlnet`）不需要独立 Service 或 Node；其 workflow 槽位由 profile entry 的 `engineSlot` 声明，不属于 asset record 自身。
- 本地导入资产的文件路径真相只来自 `source.repo=file://.../asset.manifest.json` 所在目录加 `entry`；`asset_id`、`logical_model_id`、`local-import/*` 字符串不得作为 resolved 目录真相或二次路径推导输入。passive asset 的 `logical_model_id` 可为空；即使存在，也只是语义元数据，不得覆盖 manifest parent 路径。
- **Service**（`LocalServiceDescriptor`）：某个 runnable asset 当前绑定的执行实例。一个 Service 代表一个可访问 endpoint，可以是 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。仅 runnable asset（chat/image/video/tts/stt）需要 Service 绑定。
- **Node**（`LocalNodeDescriptor`）：能力投影视图。从 Service × capabilities 生成，携带 adapter/engine/policy_gate 等运行时路由信息。Node 是能力发现入口，不是规范真相源。passive asset 不参与 Node 生成。

## K-LOCAL-008 Phase 1 绑定约束

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。
- Step A（request-routed single-worker switch）在当前约束下是合法的：
  - 请求必须显式绑定目标 model / local asset
  - 同一 runtime state root 下，supervised llama 可在一次请求前把唯一 resident worker 切换到目标 Model
  - 该切换不放宽 `Model:Service = 1:1`；它只改变当前 resident worker 绑定到哪一个 Model
- Step B（bounded multi-worker residency）当前不在本规则许可范围内：
  - 若同一 runtime state root 允许多个 supervised llama worker 并存，必须先完成新的 spec cutover，明确 Service 拓扑、Engine truth、residency budget 与 eviction 语义
  - 在完成 cutover 前，runtime 不得把“多 worker 并驻”当作默认合法能力启用

## K-LOCAL-008a Ordinary-user Local Speech Bundle Projection

ordinary-user desktop local speech 可以投影为 canonical product object `Local Speech`，但该投影边界固定如下：

- 它是 runtime-owned speech asset truth + service truth 上的 product projection，不是第二套 asset registry、service registry 或 catalog owner。
- `bootstrap/env`、`host readiness`、`capability materialization` 必须保持分层：
  - `bootstrap/env`：`qwen3_tts` / `qwen3_asr` env roots、cache root、launcher prerequisites
  - `host readiness`：managed speech endpoint 已有受管 health/catalog proof
  - `capability materialization`：仅当前被请求的 `audio.transcribe`、`audio.synthesize` 或 future-admitted `voice_workflow.*` slice 已 materialize
- `bootstrap/env` 与 `host readiness` 不是独立 ordinary-user install object；它们属于同一 bundle download/init flow 的内部层。
- 缺失 speech bundle slice 时，desktop 必须先要求显式 `Download` 用户确认；在确认前，desktop/Tauri 不得因 capability 选择、route 尝试或被动探测而静默触发 env/bootstrap、host init 或 capability download。
- runtime 可以复用既有 env/cache/materialized slice；除非 repair/remove 明确要求，否则不得默认重下载或重 bootstrap。
- capability materialization 必须保持按 capability 懒加载；满足一个 speech capability 不得自动预取全部 speech slices。
- bundle projection 可以暴露 `awaiting_download_confirmation`、`initialized_but_incomplete`、`ready_partial`、`degraded` 等产品态，但这些都只是 projection label；canonical persistent lifecycle owner 仍固定为 `K-LOCAL-005`、`K-LOCAL-009`、`K-LOCAL-016` 下的 runtime truth。

## K-LOCAL-009 Install 语义

`InstallVerifiedAsset`、`InstallModelFromPlan` 与 `ImportLocalAsset` 的语义是注册 + 状态持久化（统一取代旧 `InstallVerifiedModel` / `InstallVerifiedArtifact` 与 `ImportLocalModel` / `ImportLocalArtifact`）：

- 将 asset_id/kind/capabilities/engine/source/endpoint 等字段写入本地状态存储。
- runtime 必须同时写出 runtime-native 本地资产元数据：`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements`、`kind`；runnable asset 必须写出 `logical_model_id`，passive asset 不得从 `asset_id` 自动合成 `logical_model_id`。
- runtime 内部必须同时持久化 asset 的 `engine_runtime_mode`，用于区分显式 `ATTACHED_ENDPOINT` 与自动选择的 `SUPERVISED` 生命周期语义；该内部状态当前不要求经现有 RPC 直接暴露。
- 生成唯一 `local_asset_id`（ULID 格式）。
- 初始状态为 `INSTALLED`（`K-LOCAL-005` 状态机锚点）。
- runtime 既是注册真源，也是本地资产获取、导入、orphan scaffold/adopt、transfer/progress 与生命周期的唯一执行面；desktop 仅负责 shell-native/helper 能力。
- ordinary-user speech bundle flow 若调用这些安装/注册 primitive，也只能作为 runtime-owned bundle projection 的底层执行步骤；desktop 不得把 primitive 调用面直接投影成第二套 speech install owner。
- User file imports always mint a new installed `local_asset_id`, even when
  filename, digest, `asset_id`, `engine`, and `kind` match an existing record.
  Verified catalog/template install may still fail closed on exact catalog
  duplicate only when the requested operation is explicitly catalog install,
  not user file import.

## K-LOCAL-010 Verified 资产目录结构

verified 资产元数据的 SSOT 是 K-MCAT `local` provider catalog（`K-MCAT-032`
local-plane row block：`install` / `variants` / `host_requirement` / `fitness`）。
verified 资产没有独立的 catalog 真相源。

`LocalVerifiedAssetDescriptor` 是该 catalog truth 的 **投影**，不是平行 catalog：

- `LocalVerifiedAssetDescriptor` 的每个字段必须从 K-MCAT `local` catalog row
  与其 `K-MCAT-032` local-plane block 派生：
  - `asset_id` ← variant 级 `variants[].variant_id`（`K-MCAT-032` installable
    identity）
  - `logical_model_id` ← catalog row `model_id`；不得退化成 provider alias
  - `kind` ← catalog row `model_type` / capability-to-asset-kind 映射
  - `capabilities` ← catalog row `capabilities`（必须是 `K-MCAT-024` canonical
    token）
  - `repo` / `revision` / `entry` / `install_kind` / `artifact_roles` /
    `preferred_engine` ← `install` block
  - `files` / `hashes` / `total_size_bytes` ← 选定 `variants[]` 变体
- runtime 不得维护进程内硬编码的 verified 资产元数据字面量；任何这种平行真相
  必须删除。
- 缺失完整性材料（`hashes`）的投影必须 fail-close，不得产出 placeholder
  descriptor。

descriptor 是 catalog projection 这一点不放宽 `K-LOCAL-009` 的安装语义：
`InstallVerifiedAsset` 仍以 variant 级 `asset_id` 注册并持久化资产记录。

## K-LOCAL-010a Public Manifest Intake

稳定 public local asset intake 仅接受 `asset.manifest.json` 与统一 asset schema：

- 文件名必须是 `asset.manifest.json`
- manifest 顶层稳定字段必须使用 `asset_id` / `kind`；不得接受 `model_id`、`artifact_id` 或旧 dual manifest shape
- runnable asset 使用同一 schema 扩展 `logical_model_id`、`capabilities`、`artifact_roles`、`preferred_engine`、`fallback_engines`
- passive asset 也必须走同一 schema；区别仅在 `kind`、空 `capabilities`、可省略的 `logical_model_id` 与可选 runtime-native 扩展字段，而不是另一套 manifest 类型
- Desktop / renderer / bridge / runtime 的稳定输入输出面都必须 fail-close，不得继续兼容旧 manifest 名称或旧字段别名

## K-LOCAL-011 模型目录来源

模型目录来源：

- **Verified list**：K-MCAT `local` provider catalog（`K-MCAT-032` /
  `K-MCAT-033`）。`ListVerifiedAssets` 返回的是该 catalog truth 的投影
  （`K-LOCAL-010`），不是进程内硬编码列表。runtime 不得保留第二套硬编码
  verified 模型列表；任何这种平行真相必须删除。
- **HuggingFace Catalog**：通过 HF REST API 搜索社区模型（`K-LOCAL-023`）：
  - API: `https://huggingface.co/api/models`（REST GET）
  - 搜索参数: `search`（query）+ `pipeline_tag` + `library` 过滤
  - 超时: 20s
  - 结果数限制: 1–80（由 `limit` 参数控制）
  - 能力推断: 从 `pipeline_tag` + `tags` 推导 capability（映射规则见 `K-LOCAL-023`）
- **Catalog search** 结果排序: verified 置顶 + HF results（`K-LOCAL-021`）

verified list 与 HF catalog 是两个不同来源，但 verified 真相只有一个 SSOT：
K-MCAT `local` catalog。两者不得形成第二套 verified catalog。

未来扩展方向：

- 自有 registry
- 本地文件系统扫描
- 用户自定义 catalog endpoint

## K-LOCAL-012 安装计划解析

`ResolveModelInstallPlan` 在安装前执行预检：

1. 采集设备画像（`K-DEV-001`）。
2. 按 `K-DEV-007` 执行硬件-引擎兼容性检查，生成 warnings。
3. 判定 `install_available`：
   - `engine_runtime_mode=ATTACHED_ENDPOINT` 且 endpoint 显式提供且合法 → `true`。
   - `engine_runtime_mode=SUPERVISED` 且引擎二进制可达 → `true`。
   - 否则 → `false`，`reason_code` 说明原因。
4. 填充 `LocalProviderHints`（引擎特定适配信息）。
5. 返回 `LocalInstallPlanDescriptor`（含 warnings 和 reason_code）。

`InstallModelFromPlan` 只能消费 `ResolveModelInstallPlan` 产出的 `LocalInstallPlanDescriptor` 形态；`install_available=false` 必须 fail-closed。Desktop/Web/Kit 不得绕过该 RPC 自行执行 catalog/manual install。

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-contract.md -->

# Local Engine Contract

> Owner Domain: `K-LENG-*`

## K-LENG-001 引擎类型枚举

Phase 1 本地执行引擎固定为：

- `llama`：`llama.cpp` / `llama-server`，负责 `text.generate`、`text.embed`、`image.understand`、`audio.understand`
- `media`：`stable-diffusion.cpp` 主 driver，负责 `image.generate`、`image.edit`、`video.generate`、`i2v`
- `speech`：本地语音引擎族；baseline `Qwen3` family line 与 workflow 边界由 `local-engine-speech-contract.md` 的 `Speech Engine Family Line` 拥有。
- `sidecar`：外部自托管 music sidecar，使用 Nimi music canonical HTTP 协议；当前仅支持 `ATTACHED_ENDPOINT`

`media.diffusers` 仅允许作为 `media` 的 runtime 内部 backend driver；不是
public engine target。For descriptor-backed profile workflows, diffusers is
addressed through public `execution.backend=diffusers` plus `model.family`
validation (`K-AIEXEC-008`, `K-AIEXEC-012`) and mapped by Runtime registries to
runtime-private `backend_class=python_pipeline` / `backend_family=diffusers`.
It must not be silently selected as fallback when a profile declares another
backend/family. 若要把 `media.diffusers` 升格为 matrix-supported canonical
backend family，必须在同一轮 cutover 中同步修订 `K-LENG-004`、
`K-MMPROV-010`、`K-PROV-002` 的对应规则。
`LocalAI / Nexa / nimi_media` 不再属于规范引擎枚举，也不得作为新的本地执行事实源。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为唯一事实源。
Runtime code that consumes the engine taxonomy, including local routing helper
tables such as `knownProviders()`, must be generated from or mechanically
checked against this table. Adding, removing, or renaming an engine without
updating the generator/checker is a spec drift violation, not a Desktop
hard-cut target.

`engine=media` 可承载多个 `backend_class`：

- `native_binary`：原生二进制受管 backend（当前：`stablediffusion-ggml`）
- `python_pipeline`：受管 Python pipeline backend（候选：`diffusers`）

`backend_class` 与 public `engine` 正交；`backend_class` 不是 public engine target，也不是 provider alias。

## K-LENG-002 运行模式

本地引擎运行模式（`LocalEngineRuntimeMode`）固定两种：

- `ATTACHED_ENDPOINT`
- `SUPERVISED`

`sidecar` 当前只允许 `ATTACHED_ENDPOINT`；`llama`、`media` 与 `speech` 允许 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。

Speech product posture 由 `local-engine-speech-contract.md` 的 `Speech Runtime Mode Product Posture` 拥有；本文件只保留 engine runtime mode 的通用枚举与 cross-engine 约束。

## K-LENG-003 ATTACHED_ENDPOINT 约束

当 `engine_runtime_mode=ATTACHED_ENDPOINT` 时：

- `endpoint` 必须显式提供且合法；runtime 不得偷偷补回 loopback 默认值。
- runtime 不负责启动、停止或重启外部进程。
- `llama` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical API。
- `media` 的 attached endpoint 必须暴露 `GET /healthz` 与 `GET /v1/catalog`。
- `speech` 的 attached endpoint 必须暴露与 `K-LENG-006` 一致的 canonical speech API。
- `speech + ATTACHED_ENDPOINT` 不得被 runtime 或 app-facing consume 面投影成 ordinary-user 默认本地语音路径。
- 当 runtime 不能证明 attached endpoint 可执行当前 logical model 时，必须 fail-close。

## K-LENG-004 SUPERVISED 约束

当 `engine_runtime_mode=SUPERVISED` 时：

- runtime 负责 fork/exec、监控与回收引擎进程。
- Dependency materialization and repair run as Runtime-owned jobs; Desktop and renderer surfaces may request Runtime job orchestration through admitted SDK Runtime local clients, but must not mint local dependency readiness or repair truth.
- 信号处理：`SIGTERM` 优雅关闭，超时后 `SIGKILL`。
- 重启策略：指数退避（2s base + jitter），最大重试 5 次，累计失败后标记 `UNHEALTHY`。
- 二进制/运行时目录：受管引擎二进制与运行时环境必须落地在 K-CFG-018 数据面
  `environments` root（`<dataRootRef>/environments` 或 `managedRoots.environments`）
  下的 `{engine}/{version}/...`。不得使用 `~/.nimi/engines/` 等 home 目录硬编码
  根作为并行事实源。
- 注册表：`<environments-root>/registry.json`，必须原子写入。
- 当 Runtime config 未携带 `dataRootRef`（产品安装尚未记录 `nimi_data`）时，受管
  引擎物化必须 fail-close，不得回退到 home 目录根。`environments` root 对应
  `local-environment-dependencies.yaml` 中 `native-engine-package.*` /
  `python.*` 家族的 `managed_root` 绑定。
- stale pid 清理只能在 runtime 能证明该 pid 仍属于当前 supervised engine binary 时执行；缺少身份元数据或无法完成身份校验时，runtime 必须只清理跟踪文件，不得终止该进程。
- supervised engine bootstrap 下载只允许 `https -> https` redirect；同 host redirect 允许，`github.com` release 资产仅允许跳到显式 GitHub release-chain host（`github.com`、`objects.githubusercontent.com`、`release-assets.githubusercontent.com`），其它 redirect 一律 fail-close。
- `llama` supervised bootstrap 必须使用官方 `ggml-org/llama.cpp` release pack，并落地 `llama-server` 二进制。

受管引擎职责：

- `llama`：管理 `llama.cpp` / `llama-server`、GPU layers、context/batch policy、warmup。
- `media`：管理 image/video 执行 backend。`engine=media` 不能按引擎名整体决定 host support；必须结合 `asset_family`、`backend_class`、`backend_family` 与 `tables/local-image-supervised-backend-matrix.yaml` v2 matrix resolver 输出判断真实受管 backend。
- `speech`：baseline supervised families、ordinary-user readiness layers、capability materialization 懒加载与 local speech bundle download/init flow 由 `local-engine-speech-contract.md` 的 `Speech Supervised Baseline` 拥有。
- `media.diffusers`：在 descriptor-backed profile workflows 中只能作为
  runtime-private implementation selected by validated public
  `execution.backend=diffusers` / `model.family` constraints. It is not a
  replaceable fallback target for profile-declared `stablediffusion-ggml` or any
  other authored backend/family. 当前 kernel 基线仍规定 `media.diffusers` 不得作为
  public engine target，不得在未完成规范修订前直接升格为 matrix-supported
  canonical path。

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
  - `workflow_safetensors_image`：由 `model_index.json` / workflow bundle 驱动的
    pipeline bundle，`artifact_formats=[safetensors, json_config]`，
    `profile_kind=workflow_pipeline`，`backend_family=diffusers`。This topology
    is a workflow contract shape, not a product-ready label by itself; required
    profile slices still fail closed when product_state is proposed/unsupported
    or environment/materializer readiness is missing.
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
  - `windows/amd64 + nvidia driver/gpu visible` 也属于正式支持的 canonical `gguf_image` supervised host tuple；CUDA user-space runtime readiness 是 runtime shared accelerator dependency readiness，不是 host topology prerequisite。
  - runtime 不得再附加独立于 v2 matrix 之外的 Apple 代际门槛；install plan / import / registration / health 统一以 canonical matrix selection 为准，不得额外要求 `M5+` / `A19+`。
- `engine=media` 的 `video.generate` / `i2v` 等其它能力仍可继续沿用 `media` 自身的 host support 规则，直到对应 supervised backend 明确实现。
- 同一规则必须统一驱动 install plan、runtime mode 解析、startup warnings、health warnings 与 attached-endpoint-required 判定；不得在不同入口各自重新推断。

禁止事项：

- 不得以 `LocalAI / Nexa` 作为 supervised 代理层。
- 不得把 `media.diffusers` 伪装成主引擎。
- 不得把 `backend_class`、`backend_family` 暴露给 app 作为 public routing knob。
- 不得把 canonical local image path 降级为 `ATTACHED_ENDPOINT`。
- 不得把 `media.diffusers`、`stablediffusion-ggml` 等 backend 名称提升为 public engine target。

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-protocol-health-contract.md -->

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

Production engine endpoint/configuration comes from Runtime-owned supervised
engine state or an independently admitted service-owned attached-endpoint
record, followed only by spec-governed defaults where allowed. RPC request,
environment, argv, user-writable file, renderer, SDK and app inputs cannot
select or override endpoint/security configuration. Separately signed
synthetic non-product fixtures have their own explicit test posture and cannot
provide product evidence.

配置结构必须围绕 `llama` / `media` / `speech` / `sidecar` 组织，不得继续保留 `localai` / `nexa` / `nimi_media` 为 public 配置入口。

## K-LENG-009 凭据安全策略

- An attached endpoint that requires a credential stores only opaque
  `credentialRef`; Runtime resolves material inside service-principal custody.
  Inline `apiKey`, `apiKeyEnv`, request injection, and user-session vaults are
  forbidden.
- Local supervised engines normally require no API key. If an upstream engine
  requires one, only Runtime-owned custody may provide it.
- An engine declared credential-free is not treated as unconfigured merely
  because it has no credential ref.

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

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-accelerator-contract.md -->

# Local Engine Accelerator Contract

> Owner Domain: `K-LENG-*` accelerator-specific local engine readiness rules.
> Companion authority to `local-engine-contract.md`; this file owns shared
> accelerator dependency readiness for supervised local execution.

## K-LENG-022 Runtime Shared Accelerator Dependency Readiness

Runtime owns shared accelerator dependency readiness for supervised local
execution. CUDA user-space runtime readiness is not owned by image assets,
`llama.cpp`, `stable-diffusion.cpp`, diffusers, package installers, Desktop, or
SDK. Ordinary users must not be required to install CUDA Toolkit, configure
`CUDA_PATH` / `CUDA_HOME`, or have `nvcc` on PATH before using an admitted
Windows NVIDIA local execution path.

The authority layers are fixed:

- `tables/host-accelerator-profiles.yaml` owns host accelerator profile shape,
  evidence sources, staleness, refresh triggers, multi-GPU policy, degraded
  reasons, and profile states.
- `tables/shared-accelerator-dependencies.yaml` is an accelerator-specific
  projection of canonical local environment dependency authority. It may carry
  CUDA compatibility and package provenance detail, but source policy, selected
  source record schema, activation policy, repair policy, and dependency job
  lifecycle are owned by the local environment tables.
- `tables/accelerator-consumer-requirements.yaml` is an accelerator-specific
  projection of canonical local environment consumer requirements. It may carry
  CUDA consumer projection detail, but it must preserve distinct `failed`,
  `unsupported`, `repair_required`, and `cancelled` semantics and must not
  become a parallel consumer authority.
- Image topology/package tables may reference dependency ids and consumer ids,
  but they must not own CUDA source selection, installation, repair, or selected
  source records.
- Desktop, SDK, and app code may only project runtime dependency truth and
  must not probe, install, or infer CUDA readiness themselves.

Windows NVIDIA CUDA source policy is `system-first-managed-fallback`:

1. compatible system CUDA user-space runtime, if runtime can prove compatibility
   from canonicalized and allowlisted evidence
2. previously verified runtime-managed CUDA dependency under the Nimi runtime
   dependency root
3. declared managed dependency package, after explicit user confirmation for
   first network materialization

System source proof must be positive. Runtime must fail closed when it cannot
verify source identity, canonical root, required DLL/file set, version metadata
or binary version, driver compatibility, and selected source record creation.
Runtime may inspect PATH as a hint, but must never accept a source solely because
a DLL appears earlier in PATH. Runtime must reject model directories, import
directories, and arbitrary user-selected directories as CUDA DLL sources.

Managed source proof must include declared package source, archive hash,
staged extraction, required artifact set verification, version/driver
compatibility where available, atomic promotion, repair metadata, and a selected
source record before any consumer activation.

Dependency resolver states are runtime-private but must be projectable through
stable install / health / audit detail:

| state | meaning |
|---|---|
| `unknown` | dependency evidence has not been resolved |
| `ready_system` | compatible system accelerator dependency was verified and selected |
| `ready_managed` | compatible runtime-managed accelerator dependency was verified and selected |
| `materializable_requires_confirmation` | runtime can install/repair the dependency, but first network materialization needs explicit user confirmation |
| `queued` | user confirmation has been accepted and the runtime install job is queued |
| `downloading` | runtime is fetching a declared dependency package |
| `verifying` | runtime is verifying archive hash, declared files, canonical path, version metadata, and driver compatibility |
| `installing` | runtime is staging and atomically promoting the managed dependency |
| `repair_required` | previously selected dependency is missing, corrupt, or incompatible |
| `failed` | dependency download, verification, compatibility, or install failed |
| `unsupported` | no admitted source can satisfy the dependency on this host |
| `cancelled` | user cancelled before promotion; no ready state may be projected |

Selected source record invariants:

- exactly one active selected source record may exist per
  `dependency_id + host_profile_id + platform_tuple + runtime_data_root`
- all engine consumers in the same dependency environment must reference that
  record; consumers must not independently re-resolve a different CUDA source
- record invalidation is allowed only by runtime verification failure, explicit
  repair, dependency removal, host profile incompatibility, or required artifact
  loss
- failed verification cannot produce a fallback ready state without a new
  verified selected source record

Runtime job invariants:

- setup is idempotent for the same dependency/environment while a job is active
- duplicate consumer requests attach to the same active job id
- cancellation is explicit and stops before promotion
- repair locks exclude activation using the corrupt dependency
- automatic reinstall is forbidden unless the current confirmation policy allows
  it for that repair case

Windows process environment constraints:

- Runtime may prepend the selected dependency directory to a supervised engine
  process PATH only for that child process.
- Runtime must not mutate machine PATH, user PATH, shell profile, or system CUDA
  configuration.
- Runtime must canonicalize dependency paths before use.
- Runtime must record selected source and verification detail in runtime-private
  audit / health detail.

User confirmation constraints:

- Health probes, route resolution, background maintenance, and passive import
  review must not silently trigger first network download of accelerator
  dependencies.
- The first managed dependency download must be initiated by explicit user
  confirmation or by a model install/import confirmation that clearly discloses
  the dependency, approximate size when known, and Nimi data/runtime dependency
  storage location.
- A visible terminal, bash, PowerShell, Chocolatey, WSL, or external package
  manager flow is not the ordinary-user installation path. It may exist only as
  diagnostic/log export and must not be the source of truth for dependency state.

Lifecycle projection:

- A consumer with `materializable_requires_confirmation` may appear as
  installable/review-needed dependency setup, but must not become `ACTIVE` or
  health-successful.
- Activation and ready health for accelerator-backed consumers require
  `ready_system` or `ready_managed`.
- `failed`, `cancelled`, and `repair_required` must project as fail-closed
  dependency setup / repair detail, not as topology unsupported and not as
  pseudo-success.

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-resolver-contract.md -->

# Local Engine Resolver Contract

> Owner Domain: `K-LENG-*`

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
- descriptor-authored constraints（仅用于 profile workflow validation, never
  as resolver fallback）：public `execution.backend` and `model.family` from
  `K-AIEXEC-008`. Runtime maps them to admitted backend/profile/model-lineage
  registry rows before resolution. If authored constraints conflict with matrix
  resolver output, dependency family, or asset topology, Runtime must fail
  closed; it must not overwrite the authored constraint with inferred
  `backend_family`, `asset_family`, or derived `Family`.

Resolver 输出至少包含：`entry_id`、`product_state`、`backend_class`、`backend_family`、`control_plane`、`execution_plane`、`supported_capabilities`、catalog comparable identity、compatibility detail。

约束：

- canonical topology resolution 必须由 runtime-native asset facts 驱动，不得由 legacy routing hints 决定。
- `preferred_engine` 是公开摘要/展示字段，不是 topology fact。
- `engine_config.backend` 仅允许作为导入旧资产时的过渡线索；一旦 family / profile / materialization 已归一化，就必须失效。
- `execution.backend` and `model.family` are the only admitted public authored
  local backend/model-lineage inputs for profile-owned workflows. Bare public
  `family`, `asset_family`, `backend_family`, `dependency_family`, or
  `preferred_engine` fields must not be accepted as substitute authoring
  fields.
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
- 对 app / sdk 的稳定投影仍必须继续落在：`INSTALLED`、`ACTIVE`、`UNHEALTHY`、`REMOVED`。

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
- venv 路径固定在 K-CFG-018 数据面 `environments` root 下的
  `media/{version}/python/`（`python.venv` 家族 `managed_root: environments`）。不得使用 home 目录硬编码根。
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
| `profile_backend_mismatch` | descriptor-authored execution.backend conflicts with runtime registry/resolver |
| `profile_model_family_mismatch` | descriptor-authored model.family conflicts with runtime registry/resolver |
| `workflow_required_component_missing` | required workflow component or companion occurrence is absent/unready |
| `workflow_backend_unsupported` | profile workflow shape is recognized but product/runtime support is unsupported/proposed |

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
- `local-import/*` 不得进入 Hugging Face catalog details 解析，也不得作为 runtime storage repo/path truth；本地导入与 slot 依赖必须通过 manifest-owned `file://.../asset.manifest.json` 解析。
- 双平面失败时只允许一个稳定主错误码；次级平面信息只能进入 `secondary_detail`。
- `repair_required -> resolved` 每次发生时，必须写入 audit event（至少包含 `old_entry_id`、重新解析原因、触发入口与时间戳）。

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-runtime-environment-contract.md -->

# Local Engine Runtime Environment Contract

> Owner Domain: `K-LENG-*`

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
- `LocalAssetStatus.ACTIVE` 的前提仍是 runtime 已证明该 asset 可执行或可按需进入执行路径；endpoint failure、bootstrap failure、bundle failure 或最小执行 failure 不得被包装为 `ACTIVE/COLD`。
- `COLD` 只表达 non-resident residency，不表达 probe failure。若最近一次 ready 建证失败，应投影为 `FAILED` 并按 local asset 状态机进入 fail-closed availability。
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
  - `windows/amd64 + nvidia driver/gpu visible + stablediffusion-ggml`: supported via runtime-owned direct archive package + runtime wrapper launch path; CUDA user-space runtime is a shared accelerator dependency requirement resolved by runtime before activation/health success
  - `linux/amd64 + nvidia driver/gpu visible + stablediffusion-ggml`: unsupported until a published runtime-owned package exists
- A topology may remain recognized in `tables/local-image-supervised-backend-matrix.yaml` while package admission remains unsupported in `tables/managed-image-backend-packages.yaml`; runtime must fail-close rather than silently promoting the host tuple.

## K-LENG-021 Native-Binary Execution Cut

- For `backend_class=native_binary`, canonical execution must use the managed image backend gRPC contract directly (`LoadModel`, `GenerateImage`, `Free`).
- `local-media` remains the canonical app-facing HTTP surface for image execution and health projection, but native-binary success may not depend on proxy import support.
- Runtime must not treat llama `/models/import` as part of the canonical native-binary image path on any supported host tuple.

## Runtime Shared Accelerator Dependency Readiness Anchor

Shared accelerator dependency readiness for supervised local execution is owned
by `local-engine-accelerator-contract.md` under `K-LENG-022`. This file keeps
the local engine ordering anchor; CUDA source policy, selected source records,
dependency resolver states, process environment constraints, user confirmation,
and lifecycle projection live in the accelerator companion contract.

## K-LENG-023 Runtime Readiness Is Not Engine Bootstrap Readiness

Runtime daemon readiness proves that Runtime core services are available. It is
not proof that every supervised engine, model, accelerator dependency, Python
environment, or provider loopback is ready.

The daemon may remain in `STARTING` only for bounded core initialization:

- config parsed and validated
- stores opened
- gRPC/HTTP servers serving or ready to serve
- core Runtime services constructed

The daemon must not remain in `STARTING` while performing:

- llama/media/speech/native engine download
- CUDA or other accelerator dependency materialization
- Python environment creation
- Torch/diffusers dependency install
- model warmup or minimal execution
- provider loopback health probes
- repair jobs

Those tasks must run as Runtime-owned background jobs or health maintainers.
Their failure may set Runtime `DEGRADED`, provider unhealthy detail, local asset
`setup_required` / `repair_required` / `unhealthy`, or dependency
`materializable_requires_confirmation` / `failed`, but must not make
RuntimeLocalService, RuntimeAuditService, or config/status surfaces appear
unavailable.

If a startup background task fails before the daemon reaches `READY`, Runtime
must transition through `READY` before projecting `DEGRADED`, so consumers can
observe a consistent service-available state with explicit degradation detail.

## K-LENG-024 Runtime Local Environment Authority

Runtime owns local environment setup truth. The setup unit is a Runtime local environment plan, not a model row, engine installer, Desktop workflow, package-manager command, developer script, or provider health probe.

The normative table split is fixed across `host-capability-profiles`,
`local-compute-packs`, `local-environment-dependencies`,
`local-environment-consumer-requirements`, `local-environment-job-states`, and
`selected-source-record-schema`.

Local environment plans must resolve requested compute pack/capability, installed/imported assets, host profile, consumer requirements, dependency source policy, and current selected source records into dependency state, confirmation requirements, activation gates, repair requirements, and product-safe Desktop projection. Existing accelerator tables remain accelerator-specific projections only; they must not become parallel truth.

Runtime core readiness and cloud-only usage are outside local environment
setup. Cloud API setup, account/session, provider connector configuration, and
Runtime core status must not require local engines, Python, Torch, CUDA,
models, or accelerator dependency materialization.

## K-LENG-025 Managed Dependency Families And Activation

CUDA is one dependency family, not the setup model. Runtime-managed dependency
families include CUDA runtime, native engine packages, `uv`, managed Python,
venv, package sets, Torch wheels, model assets, and companion assets as defined
by `local-environment-dependencies.yaml`.

System sources require positive canonicalized proof. Managed sources must live
under Runtime-owned roots. Runtime must not mutate user PATH, machine PATH,
shell profiles, global Python, system CUDA, or package-manager global state.

## K-LENG-026 Consumer Activation Gates

Consumers declare requirements; Runtime resolves plans. Native engines and Python pipelines must consume Runtime selected source records and must not re-resolve sources, install hidden dependencies, or bypass activation gates.
Activation fails closed for missing, unconfirmed, cancelled, corrupt,
incompatible, unsupported, or repair-locked dependencies. File existence,
endpoint reachability, package directories, PATH precedence, import directory
contents, and script results never project readiness without selected source
records.

Detailed activation authority, request/response shape, environment key
derivation, process-local deltas, reason-code ownership, pack boundary, and
forbidden ready inputs are owned by
`local-environment-consumer-activation-contract.md`.

## K-LENG-027 Runtime Dependency Job Control

Dependency materialization and repair run as Runtime-owned jobs, idempotent per dependency environment. Network materialization requires explicit confirmation covering dependency family, known size, storage category, and no system mutation policy. Startup, route resolution, Desktop page load, passive import review, health probes, and SDK reads must not start heavy downloads.

Repair is first-class: repair locks block activation until Runtime verification
restores `ready_system` or `ready_managed`. Repair must not collapse into
unsupported, ready, or automatic reinstall unless the dependency family policy
admits it.

The public command target is the resolved dependency environment
(`environment_key`, `dependency_family`, `dependency_id`), except cancel/retry
which target Runtime job id. Admitted commands are
`StartLocalEnvironmentDependencyJob`, `CancelLocalEnvironmentDependencyJob`,
`RetryLocalEnvironmentDependencyJob`, and `RepairLocalEnvironmentDependency`.
Command semantics, terminal states, retryability, and forbidden shortcuts are
owned by `local-environment-job-states.yaml`.

Desktop, SDK, and engines may invoke these commands only through
RuntimeLocalService or downstream SDK projection. They must not choose sources,
create selected source records, mutate PATH, run package-manager scripts, or
project `ready` from job existence, transfer completion, endpoint reachability,
file existence, or local cache.

## Runtime Local Environment Materializers Anchor

Detailed materializer authority is owned by `K-LENG-028` in `local-environment-materializers-contract.md`. This section remains the stable Local Engine Contract anchor and delegates registry, source manifest, verification evidence, selected source record, activation, and ordinary-user boundary rules to that file.

---

<!-- source: .nimi/spec/runtime/kernel/local-engine-speech-contract.md -->

# Local Engine Speech Contract

> Owner Domain: `K-LENG-*` speech-specific local engine rules.
> Companion authority to `local-engine-contract.md`; this file owns the speech
> extracted from the former speech subsections of `local-engine-contract.md`.

## Speech Engine Family Line

`speech` 是本地语音引擎族。当前 ordinary-user admitted baseline 固定围绕 baseline `Qwen3` family line：

- `audio.transcribe` default lane: `Qwen3-ASR-0.6B`
- `audio.synthesize` default lane: `Qwen3-TTS-12Hz-0.6B-CustomVoice`
- `voice_workflow.voice_clone`、`voice_workflow.voice_design` 只有在真实本地 workflow execution plane 被显式 cutover admitted 后才能升格为 local truth
- 当前 baseline admitted local workflow family 边界固定为 `qwen3_tts`，不得被扩写成 generic local workflow truth

## Speech Runtime Mode Product Posture

Speech product posture:

- ordinary-user canonical local speech path 固定为 `engine=speech + SUPERVISED`
- ordinary-user canonical local speech path 必须按 bundle-shaped `Local Speech` setup surface 理解；desktop 不得把它投影成 generic verified model rows，或把 env/bootstrap/host 拆成独立用户安装对象
- 当 ordinary-user 缺失 local speech bundle slice 时，显式 `Download` 用户确认是唯一允许的启动信号；在用户确认前，desktop/runtime 不得因 capability 选择、route 尝试或被动探测而静默执行 env/bootstrap、host bring-up 或 capability 下载
- 用户确认后，runtime 可以复用已存在的 env/cache/host/slice；不得默认重装、重引导或重下载
- capability materialization 必须保持按 capability 懒加载；一次 `audio.synthesize` / `audio.transcribe` 请求或点击不得顺手预取全部 speech slices
- `speech + ATTACHED_ENDPOINT` 只允许作为高级/自托管路径存在，不得在产品语义上与 supervised 等价

## Speech Supervised Baseline

`speech` 管理 baseline local speech supervised families，并负责当前 admitted 语音基础能力探测。ordinary-user supervised truth 当前只承认 `audio.transcribe` / `audio.synthesize`；在 admitted local plain-speech execution plane 尚未 materialize 前，speech supervised `/healthz` 与 `/v1/catalog` 必须保持 placeholder/non-ready，plain-speech write routes 必须 fail-close。baseline supervised family line 固定为：

- `qwen3_asr`：default local `STT` family，普通用户默认 lane 为 `Qwen3-ASR-0.6B`
- `qwen3_tts`：default local synth / workflow family
  - plain synth default lane: `Qwen3-TTS-12Hz-0.6B-CustomVoice`
  - clone workflow default lane: `Qwen3-TTS-12Hz-0.6B-Base`
  - design workflow default lane: `Qwen3-TTS-12Hz-1.7B-VoiceDesign`
- baseline local `Qwen3` speech env topology 固定为 explicit split supervised envs：
  - `Qwen3-TTS` synth / workflow checkpoints 共享同一 `qwen3_tts` env line
  - `Qwen3-ASR` 使用独立 `qwen3_asr` env line
  - runtime 不得假设 `qwen-tts` 与 `qwen-asr` 可在同一 canonical supervised env 中共装
- `Qwen3-ASR-1.7B` 只作为 optional premium candidate 保留；在独立 premium admission 前不得自动 materialize 为 ordinary-user canonical default
- workflow-capable local family 只有在对应 local workflow execution plane 被显式 admitted 后才能进入 canonical local speech truth；当前 baseline admitted family 边界固定为 `qwen3_tts`
- ordinary-user supervised local speech install/readiness 语义固定分三层，且不得塌缩成单一“speech model installed” bit：
  1. `env/bootstrap readiness`：`qwen3_tts` / `qwen3_asr` env root、launcher、stable cache root 已就绪
  2. `host readiness`：受管 speech host 可提供 admitted health/catalog proof
  3. `capability materialization`：仅被请求 capability 对应的权重/工件已 materialize
- `env/bootstrap readiness` 与 `host readiness` 不是独立 ordinary-user install object；它们属于 runtime-owned local speech bundle download/init flow 的内部分层
- ordinary-user supervised path 必须先经过显式 `Download` 用户确认，才允许启动缺失的 env/bootstrap、host bring-up 或 capability materialization
- capability materialization 默认按 requested capability 懒加载：
  - `audio.transcribe` 只 materialize 当前 admitted `qwen3_asr` slice
  - `audio.synthesize` 只 materialize 当前 admitted `qwen3_tts` plain synth slice
  - future-admitted `voice_workflow.voice_clone` / `voice_workflow.voice_design` 也必须分别按自身 slice 懒加载，不得因为 plain `TTS` 已请求就自动预取
- runtime/desktop 必须复用已验证的 env/cache/materialized slice；除非 repair/remove 明确要求，否则不得默认重下载或重 bootstrap

---

<!-- source: .nimi/spec/runtime/kernel/local-environment-consumer-activation-contract.md -->

# Local Environment Consumer Activation Contract

> Owner Domain: `K-LENV-ACT-*`
> Delegated Anchors: `K-LENG-026`, `K-RPC-024`, `K-RPC-025`

RuntimeLocalService owns consumer activation for Runtime local environment
dependencies. This file defines how native engines, Python pipelines, SDK, and
Desktop consume Runtime-selected source records without creating setup truth.

Terminology boundary: `consumer_id` in this contract means Runtime local
environment activation consumer. It is not an app/module/feature capability
requirement owner, not an `AIScopeRef`, and not a Kit/Desktop UI consumer.
App/module/feature requirement declarations are owned by SDK `S-AICONF-010`;
Runtime activation consumers are downstream materialization/readiness consumers
selected after descriptor validation.

## K-LENV-ACT-001 Activation Authority

Activation is consumer-keyed and Runtime-owned. A caller may include `pack_id`
as projection context only after route resolution or setup planning has already
selected a consumer. Pack arbitration is upstream of activation unless a future
Runtime spec cut explicitly admits Runtime-side arbitration.

Consumers must not select sources, create selected source records, run
installers, repair dependencies, mutate PATH or global Python/package-manager
state, or project readiness. They may only consume activation gate responses
and selected source record projections.

Activation consumers must not be used as the identity of a live AIConfig slice
or as the required/optional requirement declaration. Mapping from
app/module/feature requirement to one or more activation consumers is explicit
projection metadata owned by the descriptor/readiness boundary
(`K-AIEXEC-008`, `K-AIEXEC-009`) and SDK requirement declaration
(`S-AICONF-010`).

## K-LENV-ACT-002 Request Contract

An activation request contains:

- `consumer_id`
- optional projection `pack_id`
- `host_profile_id`
- `platform_tuple`
- `runtime_data_root`
- `asset_id` for `model.asset`
- `companion_asset_id`, `companion_kind`, and `parent_asset_id` for
  `model.companion-asset`

`local_asset_id`, UI row ids, transfer ids, consumer ids, engine-private paths,
and route-local handles are projection only. They must not replace dependency
environment key material.

Identity vocabulary:

- `asset_id` is the semantic installable asset identity. For verified catalog
  assets it is the K-MCAT local-plane `variants[].variant_id`; for explicit
  imports it is the `asset.manifest.json` `asset_id`.
- `local_asset_id` is the Runtime local installed-asset record handle. It may
  be used by lifecycle RPCs and as a request-side lookup hint, but Runtime must
  resolve it to `asset_id` before dependency identity or selected-source truth
  is written.
- `model_id` is a catalog/route model selector. It must not replace
  `asset_id` in `model.asset` or `model.companion-asset` dependency identity.
- `selected_source_record_id` is a Runtime-private proof pointer for a
  dependency environment. It may be projected for diagnostics and audit, but it
  is not reusable model binding identity.

## K-LENV-ACT-003 Environment Key Derivation

Runtime derives one dependency environment key per required dependency family
using `tables/local-environment-dependencies.yaml`:

- `accelerator.cuda.runtime`: `dependency_id`, `host_profile_id`,
  `platform_tuple`, `runtime_data_root`
- `native-engine-package.llama`: `engine_id`, `package_variant`,
  `platform_tuple`, `runtime_data_root`
- `native-engine-package.stablediffusion-ggml`: `engine_id`,
  `backend_family`, `package_variant`, `platform_tuple`, `runtime_data_root`
- `python.tool.uv`: `tool_id`, `platform_tuple`, `runtime_data_root`
- `python.runtime`: `python_version`, `platform_tuple`, `runtime_data_root`
- `python.venv`: `engine_id`, `backend_family`, `python_version`,
  `package_lock_hash`, `platform_tuple`, `runtime_data_root`
- `python.package-set`: `engine_id`, `backend_family`, `package_lock_hash`,
  `platform_tuple`, `runtime_data_root`
- `python.torch-wheel`: `torch_version`, `accelerator_plane`, `cuda_abi`,
  `platform_tuple`, `runtime_data_root`
- `model.asset`: `asset_id`, `model_family`, `runtime_data_root`
- `model.companion-asset`: `asset_id`, `parent_asset_id`, `companion_kind`,
  `runtime_data_root`

Dependency environment identity is canonical. Consumer membership is projected
through the activation gate and selected source record `selected_consumers`.
`consumer_scope` is not key material unless a dependency family explicitly
admits consumer-scoped selected source ownership.

`model.asset` dependency identity stores the semantic `asset_id` directly.
`model.companion-asset` dependency identity stores the semantic companion
`asset_id` plus semantic `parent_asset_id`; neither family may persist
`local_asset_id`, route-local handles, or string namespaces such as local record
aliases as dependency identity.

## K-LENV-ACT-004 Response Contract

An activation response contains:

- `consumer_id` and projection `pack_id`
- `activation_state`
- ordered blocking dependencies
- dependency entries with family, dependency id, environment key, required
  flag, selected source record id, source kind, canonical root, dependency
  state, reason code, and bounded diagnostic detail
- process-local activation environment deltas
- audit metadata including host profile and platform tuple

The response is ready only when every required dependency is `ready_system` or
`ready_managed` and every referenced selected source record passes repair,
compatibility, and verification checks.

## K-LENV-ACT-005 State Mapping

Activation state priority is:

1. `unsupported`
2. `repair_required`
3. `failed`
4. `cancelled`
5. `setup_in_progress`
6. `setup_required`
7. `ready`

`queued`, `downloading`, `verifying`, and `installing` project
`setup_in_progress`. `unknown` and `needs_confirmation` project
`setup_required`. Non-ready states must never project active, degraded-ready,
best-effort-ready, endpoint-ready, or import-ready.

## K-LENV-ACT-006 Process-Local Deltas

Activation deltas are process-local and consumable only after selected source
verification succeeds. Admitted deltas are:

- PATH prepend for selected CUDA runtime artifacts in the child process only
- executable path and canonical root references for native engine packages
- `UV`, Python interpreter, venv root, package environment, and wheel refs for
  Python pipelines
- selected model and companion asset paths

Deltas are not readiness proof. They must not write user PATH, machine PATH,
shell profiles, system CUDA, global Python, package-manager global state, or
engine-private persistent setup state.

## K-LENV-ACT-007 Reason Ownership

Activation reason codes are owned by
`tables/activation-gate-reason-codes.yaml`. A reason code must declare whether
it is owned by a dependency family, selected source record state, or
host-capability projection. Implementation must not invent unregistered
activation reason codes.

`vulkan_runtime_unavailable` and `metal_runtime_unavailable` are
host-capability projection reasons. They do not admit Vulkan or Metal
dependency materializers and must not create selected source records.

Speech driver readiness is part of `python.package-set` verification evidence.
Speech consumers use `python_package_set_missing`; they must not introduce a
separate engine-local speech driver installer.

## K-LENV-ACT-008 Consumer And Pack Semantics

Consumer requirements in
`tables/local-environment-consumer-requirements.yaml`, local compute pack
consumer refs in `tables/local-compute-packs.yaml`, and this contract must stay
in lockstep. There must be no orphaned consumer ids in either direction.

Pack-level optional dependency families are Desktop/setup projection only. They
must not weaken consumer-level required dependency evaluation once a specific
consumer is selected.

Cloud-only usage has no local consumer activation request and must not resolve
local environment dependencies.

## K-LENV-ACT-009 Forbidden Ready Inputs

Runtime must not project activation ready from file existence, directory
presence, endpoint reachability, transfer completion, package directory
presence, PATH precedence, import success, import directory contents, script
exit, process liveness, warmup success, or previous health success without a
ready selected source record.

## K-LENV-ACT-010 RPC Surface

RuntimeLocalService must expose activation gates through a named logical
operation: `ResolveLocalEnvironmentConsumerActivation`.

The operation accepts the request fields in `K-LENV-ACT-002` and returns the
response fields in `K-LENV-ACT-004`. The concrete transport may be a new RPC
method or a versioned extension of the existing local environment plan surface,
but the request, response, reason ownership, fail-closed state mapping, and
ordinary-user boundary in this contract are normative.

## K-LENV-ACT-011 First-Run Runtime Baseline Readiness Evidence

RuntimeLocalService owns `runtimeBaselineRef` for product first-run ready
admission. The ref is durable evidence for the selected local first-run baseline
activation state; it is not a route probe id, file path, process health result,
or renderer-supplied string.

`runtimeBaselineRef` is valid only when it resolves to:

- selected first-run local factory `AIProfile` ref and install level
- selected `runtime_data_root` / `dataRootRef`
- all required dependency families and selected source record ids for the
  selected baseline
- activation responses for each required consumer showing every required
  dependency as `ready_system` or `ready_managed` per `K-LENV-ACT-004`
- materialization job terminal evidence or system-source verification evidence
  that produced the selected source records
- `observed_at`, Runtime verifier identity, and audit/evidence sequence

Activation and materialization relation:

- materialization jobs may produce selected source records, but materialization
  success alone is not readiness
- activation consumes selected source records and verifies repair,
  compatibility, and dependency readiness for the selected consumer set
- `runtimeBaselineRef` can be minted only after activation succeeds for the
  selected baseline; a previous materialization terminal state cannot be reused
  without fresh activation verification

`MUST NOT`: file existence, directory presence, endpoint reachability,
`runtime.route.checkHealth`, process liveness, import success, route health,
transfer completion, script exit, warmup success, or previous health success may
mint or satisfy `runtimeBaselineRef` without the activation evidence above.

---

<!-- source: .nimi/spec/runtime/kernel/local-environment-materializers-contract.md -->

# Local Environment Materializers Contract

> Owner Domain: `K-LENV-MAT-*`
> Delegated Anchors: `K-LENG-028`, `K-RPC-025`, `K-LENV-ACT-*`

This file owns the detailed runtime local environment materializer authority delegated from the Local Engine Contract and Runtime RPC Surface. It does not create a second truth owner; it keeps materializer rules in one AI-context-sized kernel spec while preserving the stable upstream anchors.

## K-LENG-028 Runtime Local Environment Materializers

Runtime materializers are the only admitted product path for materializing local
environment dependency families defined by
`tables/local-environment-dependencies.yaml`. The materializer registry is
`tables/local-environment-materializers.yaml`; source manifest schema families
are defined by `tables/local-environment-source-manifests.yaml`; verification
evidence schema families are defined by
`tables/local-environment-verification-evidence.yaml`.

The admitted materializer families are:

- `accelerator.cuda.runtime`
- `native-engine-package.llama`
- `native-engine-package.stablediffusion-ggml`
- `python.tool.uv`
- `python.runtime`
- `python.venv`
- `python.package-set`
- `python.torch-wheel`
- `model.asset`
- `model.companion-asset`

A materializer is a RuntimeLocalService-owned job executor. It consumes a
resolved dependency environment, source policy, source manifest, confirmation
disposition, and current selected source record. It stages artifacts under
Runtime-owned roots, verifies family-specific evidence, and promotes a selected
source record only after verification succeeds.

Materializers are not Desktop workflows, engine-local installers, developer
scripts, package-manager commands, PATH helpers, transfer records, endpoint
probes, or model rows. Engine startup, Python pipeline startup, route
resolution, provider health checks, passive import review, SDK reads, Desktop
page load, and background maintenance must not perform first heavy or network
materialization.

Missing `uv`, Python runtime, venv, package set, Torch wheel, native engine
package, model asset, or companion asset readiness must project Runtime local
environment setup, confirmation, failed, unsupported, cancelled, or repair
state. Ordinary users must not be instructed to install `uv`, Python, Torch,
CUDA, native packages, or model dependencies through a system package manager,
global Python environment, user PATH, machine PATH, shell profile, or
engine-private directory.

`native-engine-package.stablediffusion-ggml` source candidates are linked to
`tables/managed-image-backend-packages.yaml`, but selected source record
promotion remains owned by the local environment materializer. Runtime must not
infer a package source from engine startup branches, command-line backend
installers, or ad hoc code paths.

Explicit local imports may produce selected source records for `model.asset`
and `model.companion-asset` only. Imported paths must not become Python, `uv`,
CUDA, DLL, package-manager, Torch, or native engine package roots.

Selected source record identity is the dependency environment key. The
environment key is composed from the dependency family and family-specific key
fields in `tables/local-environment-dependencies.yaml`. `consumer_scope` is
not default key material; it is projection and activation-gate data unless a
future spec cut explicitly admits consumer-scoped selected source ownership for
a family. UI rows, transfer ids, consumer ids, model asset rows, and
engine-private paths must not replace the dependency environment key.

Runtime core readiness remains independent from materializers. Runtime may
reach core `READY` while local dependency jobs are missing, failed, cancelled,
unsupported, or repair-required; those states degrade local compute projections
without making RuntimeLocalService, RuntimeAuditService, or config/status
surfaces unavailable.

## K-RPC-025 RuntimeLocalService Materializer Projection Surface

RuntimeLocalService owns the app-facing projection and command surface for
Runtime local environment materializers. The concrete transport may be new RPC
methods or extensions to the existing local environment plan/job projection, but
the semantics are fixed:

1. Read the materializer registry for dependency families.
2. Resolve source candidates and source manifests from Runtime authority.
3. Project current selected source summaries with bounded diagnostics.
4. Project confirmation payloads before first network or storage-heavy
   materialization.
5. Start, observe, cancel, retry, and repair materializer jobs by dependency
   environment and Runtime job id.
6. Project activation gate failures without probing or installing dependencies.

Detailed consumer activation request, response, reason-code, and process-local
delta semantics are owned by
`local-environment-consumer-activation-contract.md`.

The surface must return Runtime setup or repair state for missing `uv`, Python
runtime, venv, package set, Torch wheel, native package, model asset, or
companion asset. It must not return ordinary-user instructions to install these
dependencies through a system package manager, global Python, user PATH, machine
PATH, shell profile, or engine-private directory.

Materializer projection must preserve the non-ready distinction between
`needs_confirmation`, `queued`, `downloading`, `verifying`, `installing`,
`repair_required`, `failed`, `unsupported`, and `cancelled`. Product-facing
setup-required or materializable-requires-confirmation text is a projection of
`needs_confirmation`; it is not a ready state.

Terminal dependency jobs must project typed `reason_code` and
`recovery_disposition` fields in addition to bounded diagnostic detail.
`failure_detail` remains human/debug context only; SDK, Desktop, Tester, and
other app consumers must not parse it to decide retry, auto-recovery, repair, or
setup-state transitions. Runtime owns the classification of interrupted,
manual-retry, repair-required, unsupported, and not-retryable outcomes.

Local transfer records may be included as progress or diagnostic detail only.
They must not target materializer commands, create selected source records, or
project readiness.

### K-RPC-025 Dependency-Job Download-Progress Projection

The dependency-job projection (`localEnvironmentDependencyJob`, returned by
`StartLocalEnvironmentDependencyJob` / `CancelLocalEnvironmentDependencyJob` /
`RetryLocalEnvironmentDependencyJob` / `RepairLocalEnvironmentDependency` and
listed by `ListLocalEnvironmentDependencyJobs`) carries a bounded
download-progress projection so a Desktop or SDK consumer can render a concrete
per-job percentage, transfer rate, and ETA while a job is fetching artifacts.
This is the fine-grained projection of the same byte progress the Runtime
transfer layer already tracks; it is diagnostic progress detail attached to the
job, never an alternate readiness or selection signal.

The job-progress fields are:

- `bytes_received` — bytes already fetched and on disk for the job's current
  artifact transfer, including any resumed prefix. `0` when the job has not yet
  fetched any bytes.
- `bytes_total` — the known final byte size of the job's current artifact
  transfer. `0` when the size is not yet known (no `Content-Length` /
  `Content-Range` observed yet).
- `percent` — an integer `0..100` completion projection. It is projected only
  when `bytes_total > 0`; when the total is unknown `percent` is `0` and the
  consumer must render an indeterminate progress affordance rather than a
  fabricated percentage.
- `speed_bytes_per_sec` — a bounded transfer-rate projection computed from
  observed bytes over observed elapsed time. It is projected only when a rate
  can actually be computed (elapsed time and received bytes are both positive);
  otherwise it is `0` (absent) and must not be fabricated or guessed.
- `eta_seconds` — a bounded remaining-time projection. It is projected only when
  `bytes_total > 0`, `speed_bytes_per_sec > 0`, and `bytes_received <
  bytes_total`; otherwise it is `0` (absent) and must not be fabricated.

The progress fields are meaningful only while a job is non-terminal and actively
materializing — that is, in `downloading` or `verifying`. For `unknown`,
`needs_confirmation`, `queued`, `installing`, every terminal state
(`ready_system`, `ready_managed`, `failed`, `unsupported`, `cancelled`), and
`repair_required`, the progress fields project zero/absent. They are never
back-filled, carried over, or fabricated for a state that is not actively
transferring bytes. A consumer must gate any percentage / rate / ETA display on
the `downloading` (and, where artifacts are still streaming, `verifying`) state
and must treat zero `speed_bytes_per_sec` / `eta_seconds` as "not yet known",
not as "stalled".

The progress projection does not change job lifecycle, selected-source
promotion, activation, or readiness semantics. A job is still ready only through
a verified selected source record; progress bytes never promote, never select,
and never substitute for verification evidence. The fields are a new optional
additive projection and are non-breaking.

### K-RPC-025 Install-Level Plan Resolution

`ResolveLocalEnvironmentPlan` carries an optional `install_level`
(`minimal` | `recommended` | unset) on `ResolveLocalEnvironmentPlanRequest`.
When `install_level` is set and the caller supplies no explicit `asset_id`,
RuntimeLocalService resolves the pack's `model.asset` and
`model.companion-asset` dependencies internally via the `K-MCAT-034`
deterministic resolver from the curated preset plus host posture. An explicit
`asset_id` always wins (the user-driven install/import path is unchanged); an
empty `install_level` preserves the prior explicit-identity behaviour. The
field is a new optional addition and is non-breaking.

A compute pack may host more than one preset model slot — `local-speech` hosts
both the `audio.transcribe` and `audio.synthesize` slots. The `model.asset`
dependency family per pack is therefore `1:N`, not exactly-1: under
install-level resolution the plan emits one `model.asset` dependency per
resolved preset slot whose capability the pack hosts, each carrying its own
resolver-filled `asset_id`. `model.companion-asset` follows the same pattern,
one dependency per resolved companion of those hosted slots. The N `model.asset`
rows do not collide because the `model.asset` environment key is keyed by
`asset_id` (`local-environment-dependencies.yaml`).

The `pack -> hosted capabilities` relation is explicit Runtime authority: each
compute pack declares the precise `K-MCAT-033` preset-slot capabilities it hosts
a model asset for (`local-text` -> `text.generate`; `local-speech` ->
`audio.transcribe` + `audio.synthesize`; `local-image-native` ->
`image.generate`). This is not the broad product-facing `capabilities` grouping
of `local-compute-packs.yaml`; it is the per-slot capability set used to project
resolved slots onto plan dependencies. The plan never keys this relation on
`consumer_scope`.

A resolver `FailClose` leaves the `model.asset` / `model.companion-asset`
dependency in `unsupported` state carrying the typed resolver reason code
(`K-MCAT-037`). The dependency keeps a non-empty `dependency_id` (the pack's
stable default model-family id) and is never projected as a ready or
startable dependency with an empty `dependency_id`.

---

<!-- source: .nimi/spec/runtime/kernel/local-profile-application-contract.md -->

# Local Profile Application Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-013 依赖解析模型

`LocalExecutionDeclarationDescriptor` 定义四类执行条目声明：

| 类型 | 语义 | 缺失行为 |
|---|---|---|
| `required` | 必须满足 | 解析失败，reason_code 报错 |
| `optional` | 可选增强 | 跳过，生成 warning |
| `alternatives` | 互选组（多选一） | 按 `preferred_entry_id` 优先选择；全部不可用则失败 |
| `preferred` | 全局偏好映射（`capability → entry_id`） | 仅影响 alternatives 中的选择优先级 |

解析过程：

1. 遍历 `required` → 全部必须可满足。
2. 遍历 `optional` → 尽力满足。
3. 遍历 `alternatives` → 按 preferred > 声明顺序选择。
4. 输出 `LocalExecutionPlan`，含 `selection_rationale` 与 `preflight_decisions`。

## K-LOCAL-014 Apply 管道四阶段

`ApplyProfile` 执行 profile 解析结果中的 `LocalExecutionPlan`，分四阶段：

| 阶段 | 名称 | 动作 |
|---|---|---|
| 1 | `preflight` | 设备画像重新采集，校验硬件兼容性与端口可用性 |
| 2 | `install` | 执行 `InstallVerifiedAsset` / `InstallModelFromPlan` / `ImportLocalAsset` / `InstallLocalService`，持久化状态 |
| 3 | `bootstrap` | 执行 `StartLocalService`（ATTACHED_ENDPOINT 模式为连接验证） |
| 4 | `health` | 执行健康探测（`K-LENG-007`），确认服务可用 |

每个阶段产出 `LocalExecutionStageResult{stage, ok, reason_code, detail}`。

## K-LOCAL-014a Profile 执行面

`ResolveProfile` / `ApplyProfile` 为本地 AI 推荐组合的一等执行入口：

- `ResolveProfile` 接收单个 `LocalProfileDescriptor`，并将其中的 asset entries 归一化为 `LocalExecutionPlan`。
- profile 中的每个 entry 统一为 `kind: asset`，携带 `assetKind`（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`）与可选 `engineSlot`（passive asset 必填）。
- runnable asset entries（`assetKind` 为 `chat` / `image` / `video` / `tts` / `stt`，且无 `engineSlot`）进入 execution resolver，生成 Service/Node 绑定。
- passive asset entries（携带 `engineSlot`）参与统一资产解析，由 runtime 在 workflow 执行时通过 `engineSlot` 匹配注入路径。
- `ApplyProfile` 执行统一资产安装：先安装 runnable asset，再安装 passive asset；所有 asset 使用 `InstallVerifiedAsset` / `ImportLocalAsset` 统一入口。
- daemon 不负责枚举 app manifest 中声明了哪些 profile；profile 列举职责仍属于 desktop / app host。daemon 只负责执行传入的单个 profile。
- capability filter 存在时，只执行与该 capability 匹配或未显式声明 capability 的 profile entry。

## K-LOCAL-015 Apply 失败回滚

Apply 管道任一阶段失败时：

- 逆序清理已完成阶段的副作用（已安装的 model/service 执行 remove）。
- 结果 `rollback_applied=true`。
- 回滚本身失败时，结果同时携带原始失败和回滚失败的 reason_code，不做二次回滚。
- 回滚不触发删除外部资产（如已下载的模型文件），仅清理 runtime 内部注册状态。

> **Phase 1 注释**：ATTACHED_ENDPOINT 模式下，stage 3（bootstrap）仅验证 endpoint 连接可达，stage 4（health）必须遵循 `K-LENG-007` 的 engine-specific 探测协议。对 `media`，固定为 `GET /healthz` + `GET /v1/catalog`；对 `speech`，固定为 `GET /healthz` + `GET /v1/catalog`。回滚的实际影响范围为 stage 2 的注册清理（`InstallVerifiedAsset`/`ImportLocalAsset`/`InstallLocalService` 产生的状态记录）。

## K-LOCAL-016 状态持久化规则

本地模型状态持久化到 `~/.nimi/runtime/local-state.json`：

- 写入使用原子操作：写临时文件 → rename（防止断电损坏）。
- 文件格式包含 `schemaVersion`（当前 `2`），向前兼容时忽略未知字段。
- `assets[]` / `services[]` 的本地状态必须保留内部 `engine_runtime_mode`，以避免把显式 attached loopback 与自动推荐 supervised loopback 混淆。
- 审计事件（`LocalAuditEvent`）追加存储，上限默认 5000 条（可通过 `K-DAEMON-009` 配置 `localAuditCapacity` 覆盖），超出时按 FIFO 淘汰。
- 每次状态变更（install/remove/start/stop/health）都触发持久化。

## K-LOCAL-017 适配器路由规则

Node 的 `adapter` 字段按以下规则确定（以 `tables/local-adapter-routing.yaml` 为事实源）：

| Engine | Capability | Adapter |
|---|---|---|
| `llama` | `chat` / `text.generate` | `llama_native_adapter` |
| `llama` | `embedding` / `embed` / `text.embed` | `llama_native_adapter` |
| `llama` | `image.understand` / `audio.understand` | `llama_native_adapter` |
| `media` | `image.generate` / `image.edit` | `media_native_adapter` |
| `media` | `video.generate` / `i2v` | `media_native_adapter` |
| `speech` | `audio.transcribe` | `speech_native_adapter` |
| `speech` | `audio.synthesize` | `speech_native_adapter` |
| `sidecar` | `music` / `music.generate` | `sidecar_music_adapter` |
| `*`（任意） | `*`（任意） | `openai_compat_adapter` |

匹配顺序：精确匹配优先于通配符。

## K-LOCAL-018 策略门控（Policy Gate）

策略门控用于条件性禁止特定 provider × capability 组合：

- `LocalNodeDescriptor.policy_gate` 字段描述门控规则标识（如 `media.video.unsupported`）。
- 门控触发时：Node 的 `available=false`，`reason_code` 说明原因。
- 对 host 已知但 capability 不受支持的 provider × capability 组合，runtime 必须设置 `<provider>.<capability>.unsupported` 风格的 policy gate，并且不得继续暴露 native adapter。
- 门控信息通过 `LocalProviderHints` 透传给审计与调用方。
- 类型映射：`LocalProviderHints.media.policy_gate` 可承载门控规则标识符；`LocalProviderHints.media` 承载 `family/driver/device` 等执行提示；`AppendInferenceAuditRequest.policy_gate` 为 `google.protobuf.Struct`（结构化门控上下文，含 gate/reason/detail）。两者表达不同粒度，不要求类型对齐。

## K-LOCAL-019 Node 目录生成规则

`ListNodeCatalog` 从已安装且活跃的 Service 实时生成 Node 列表：

1. 遍历所有 `status=ACTIVE` 的 Service。
2. 对每个 Service 的 `capabilities` 做笛卡尔积：每个 capability 生成一个 Node。
3. 每个 Node 填充：
   - `node_id`：`<service_id>:<capability>` 格式。
   - `provider`：仅作为兼容字段存在时，必须从 engine 投影；engine 才是本地执行真相源。
   - `adapter`：按 `K-LOCAL-017` 路由。
   - `available`：健康且未被策略门控（`K-LOCAL-018`）。
   - `llama` node 必须同时满足 bundle 可解析、主 artifact 完整、以及对应能力 probe 成功。
   - `media` node 必须通过 canonical media catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。For descriptor-backed profile workflows, selected backend/family must match the validated descriptor; runtime may expose selected runtime-private implementation detail in `provider_hints.media`, but must not silently substitute `media.diffusers` for a different authored backend/family.
   - `speech` node 必须通过 canonical speech catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。
   - `media` node 的 `provider_hints.extra` 必须暴露 runtime host 支持面（如 `runtime_support_class=supported_supervised|attached_only|unsupported`），供目录层解释为何当前 host 只能 attached；该判定必须基于实际受管 backend，而不是仅按 public engine=`media` 粗暴复用统一 host classification。对于 `image.generate` / `image.edit` 且 backend/profile 解析到 `stablediffusion-ggml` 或其它实际受管 native-binary image backend 的资产，host support 必须跟随对应 managed image supervised 支持面。
   - `provider_hints.extra.local_default_rank` 必须暴露当前 host + capability 下的默认 local engine 排序，供 Desktop/SDK 与 runtime 对齐默认路由。
   - `provider_hints`：引擎特定适配信息。
4. 支持按 `capability`/`service_id`/`provider` 过滤。

## K-LOCAL-020 model_id 前缀路由

当 AI 执行路径接收到 local model 请求时，按 `model_id` 前缀确定引擎：

| 前缀 | 引擎选择 |
|---|---|
| `llama/` | 仅匹配 `llama` 引擎的已安装模型 |
| `media/` | 仅匹配 `media` 引擎的已安装模型 |
| `speech/` | 仅匹配 `speech` 引擎的已安装模型 |
| `sidecar/` | 仅匹配 `sidecar` 引擎的已安装模型 |
| `local/` | 按 host + capability 做 engine-first 路由：`text.generate/text.embed/image.understand/audio.understand -> llama`，`image.generate/image.edit/video.generate/i2v -> media`，`audio.transcribe/audio.synthesize -> speech`。For descriptor-backed profile workflows, backend/family selection is pinned by validated `execution.backend` / `model.family` and cannot fallback to another backend. Legacy non-profile routing may expose runtime-private implementation detail, but must fail closed when no admitted implementation satisfies the current model/capability. `voice_workflow.voice_clone/voice_workflow.voice_design` 在显式 local workflow admission 前不得被 `local/*` 投影为 canonical local speech success |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`llama/qwen2.5-7b-instruct` 匹配 `model_id=qwen2.5-7b-instruct` 且 `engine=llama`；`media/flux.1-schnell` 匹配 `model_id=flux.1-schnell` 且 `engine=media`；`sidecar/musicgen` 匹配 `model_id=musicgen` 且 `engine=sidecar`）。

对 canonical local image product path，`local/*` 到 `media` 的 image 路由必须继续服从 `K-LENG-004` / `K-LENG-012` 的统一 matrix resolver 语义：

- 单文件 `*.gguf` 主模型 -> `gguf_image`
- 单文件 `*.safetensors` 主模型且不满足 workflow bundle 判据 -> `safetensors_native_image`
- `model_index.json` 或等价 workflow bundle completeness 命中 -> `workflow_safetensors_image`
- `artifact_roles` 只描述 bundle 内部角色，不得因为“任意非空”就把单文件 safetensors 升级成 workflow topology
- 命中 `safetensors_native_image` 或 `workflow_safetensors_image` 但 `product_state != supported` 时，runtime 必须保持 `SUPERVISED` 契约并以 `AI_LOCAL_MODEL_UNAVAILABLE + compatibility detail` fail-close，不得改投 `ATTACHED_ENDPOINT`

fallback 补充：

- `local/*` 默认路由不得跨 family 静默换模型；fallback 只允许在同一 logical model 的声明引擎集合内发生。
- descriptor-backed profile workflows do not admit implicit backend fallback.
  If the validated authored backend/family cannot execute, runtime must
  fail-close with profile/workflow readiness detail and no live AIConfig write
  for required slices.
- 若 `media` 路径不可执行，runtime 必须 fail-close，不得伪装 ready 或静默退回
  cloud/provider alias。

未知前缀（如 `ollama/`）视为无前缀，按 `model_id` 全文精确匹配（不剥除前缀）。

## K-LOCAL-020a Runtime Target Identity v2 Supersession

K-RTARGET-002 supersedes K-LOCAL-020 for durable local execution identity. Raw
`model_id` prefix routing may be read only as retired migration input or
catalog/display metadata. Runtime execution, health, warm, generate, lease, and
resident load must resolve a v2 local durable ref (`profile_binding_id` or
`readiness_ref`) before selecting engine/provider facts.

## K-LOCAL-020b Chat/Text 本地模型可选性

本地 chat/text 模型的选择与预热语义固定为：

- `status in {INSTALLED, ACTIVE}` 的本地 chat/text 模型可被 route 选择与 UI 展示。
- `UNHEALTHY` 与 `REMOVED` 的本地模型不得作为可选项暴露。
- 当真实 text 请求命中 `INSTALLED` 的本地模型时，runtime 必须先执行 `WarmLocalAsset`，预热成功后再继续请求。
- `ACTIVE` 表示模型已通过 runtime readiness 校验，可直接被选择；它不要求模型常驻运行或常驻占用内存。
- `INSTALLED` 表示模型已完成安装/导入与最小元数据登记，但尚未完成可执行级 readiness 验证；仅 `/v1/models` reachability 或等价进程探活成功，不足以把 chat/text 模型提升为 `ACTIVE`。
- background validation 可以补充 bundle / endpoint / probe 信息，但只有最小 text 执行或等价 warm 成功后，chat/text 模型才允许从 `INSTALLED` 迁移到 `ACTIVE`。
- `WarmLocalAsset`、真实 text 请求、或等价 runtime 维护路径若在最小执行阶段失败，模型必须保留结构化失败原因并转为 `UNHEALTHY`，不得伪装为 `ACTIVE`。
- 该放宽仅适用于 chat/text；`image.generate`、`video.generate`、`audio.synthesize`、`audio.transcribe` 等 media/speech 路径不继承本规则，除非对应 runtime contract 另行声明按需 warm 语义。

## K-LOCAL-031 Ordered Companion Occurrence Rules

Profile workflow companion binding is occurrence-based. `engineSlot` remains a
runtime-private backend injection role, not occurrence identity.

Occurrence fields:

| Field | Meaning |
|---|---|
| `occurrence_id` | Stable profile-local id or stable generated index. |
| `order` | Explicit application/load order. |
| `role` | Admitted role such as `lora`, `vae`, `clip`, `controlnet`, `encoder`, `decoder`, or backend-specific component role. |
| `engineSlot` | Runtime-private backend injection role for the occurrence. |
| `asset_binding_ref` | Portable profile asset/source binding ref. |
| `required` | Required/optional readiness policy. |
| `weight` / `options` | Backend-admitted occurrence options. |
| `applies_to` | Optional backend/model-family/capability constraint. |

Rules:

- passive asset（`kind` 为 `vae`、`clip`、`lora`、`controlnet`、`auxiliary`）must
  appear through an occurrence when used by a profile workflow. Missing
  occurrence role/slot for a required passive asset fails closed
  (`AI_LOCAL_ASSET_SLOT_MISSING`).
- runnable asset（`kind` 为 `chat`、`image`、`video`、`tts`、`stt`，即 workflow 的主执行 asset）
  must not be represented as a companion occurrence. Setting companion slot
  semantics on a runnable asset fails closed (`AI_LOCAL_ASSET_SLOT_FORBIDDEN`).
- The same `engineSlot` may appear more than once only when each use has a
  distinct `occurrence_id` and explicit `order`. This admits repeated asset use
  such as two LoRA occurrences with different weights. A slot-map keyed only by
  `engineSlot` is no longer authoritative for descriptor-backed workflows.
- `engineSlot` value domain is backend-defined and validated against the
  descriptor's `execution.backend` / `model.family`. Unsupported roles/options
  fail closed; runtime must not silently skip or default them.
- runtime 在 workflow 执行前，必须 resolve ordered occurrences into backend
  injection parameters, preserving occurrence order, duplicate use, required
  policy, weight, and options. 未安装或 `UNHEALTHY` 的 required occurrence asset
  fails workflow readiness but must not mark the shared reusable main asset
  globally unhealthy.
- passive asset 的 path 解析必须使用该 asset 的 manifest parent 与 `entry`；
  不得使用 `asset_id`、`logical_model_id` 或 `local-import/*` source repo 推导
  `resolved/` 路径。
- Legacy unordered slot-map profile entries may be consumed only as migration
  input and must be normalized into ordered occurrences before prepare,
  materialization, cache-key calculation, or execution. If normalization cannot
  preserve identity/order, runtime must fail closed.

## K-LOCAL-032 Profile Entry Override 规则

profile entry 允许通过 `overrides` 字段覆盖 asset 的非路径 profile 参数：

- `overrides` 仅允许覆盖 engine-specific 参数（如 `steps`、`cfg_scale`、`scheduler` 等），不得覆盖 `parameters.model`、`download_files`、任何 `*_path` 字段或 `engineSlot` 绑定。
- 尝试覆盖受保护字段时，`ResolveProfile` 必须 fail-close（`AI_LOCAL_PROFILE_OVERRIDE_FORBIDDEN`）。
- `overrides` 的应用时机在 runtime 完成 slot 路径注入之后，engine 请求构造之前。
- `overrides` 不得触发 asset 重新安装或 Service 重启；它们仅影响单次 workflow 执行参数。
- profile entry 不携带 `overrides` 时，使用 asset 自身的默认参数。
