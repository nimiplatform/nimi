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
