# Local Category & Capability Contract

> Owner Domain: `K-LOCAL-*`

## K-LOCAL-001 固定 category（Phase 1）

`LocalConnectorCategory` 固定 6 个：

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

- **Asset**（`LocalAssetRecord`）：用户与 App/Mod 可见的统一资产抽象。每条记录携带 `local_asset_id`（ULID）、`kind`（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`）、`logical_model_id`、`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements` 。passive asset（如 `vae`、`clip`、`lora`、`controlnet`）不需要独立 Service 或 Node；其 workflow 槽位由 profile entry 的 `engineSlot` 声明，不属于 asset record 自身。
- **Service**（`LocalServiceDescriptor`）：某个 runnable asset 当前绑定的执行实例。一个 Service 代表一个可访问 endpoint，可以是 `ATTACHED_ENDPOINT` 或 `SUPERVISED`。仅 runnable asset（chat/image/video/tts/stt）需要 Service 绑定。
- **Node**（`LocalNodeDescriptor`）：能力投影视图。从 Service × capabilities 生成，携带 adapter/engine/policy_gate 等运行时路由信息。Node 是能力发现入口，不是规范真相源。passive asset 不参与 Node 生成。

## K-LOCAL-008 Phase 1 绑定约束

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。

## K-LOCAL-009 Install 语义

`InstallVerifiedAsset` 与 `ImportLocalAsset` 的语义是注册 + 状态持久化（统一取代旧 `InstallVerifiedModel` / `InstallVerifiedArtifact` 与 `ImportLocalModel` / `ImportLocalArtifact`）：

- 将 asset_id/kind/capabilities/engine/source/endpoint 等字段写入本地状态存储。
- runtime 必须同时写出 runtime-native 本地资产元数据：`logical_model_id`、`family`、`artifact_roles`、`preferred_engine`、`fallback_engines`、`bundle_state`、`warm_state`、`host_requirements`、`kind`。
- runtime 内部必须同时持久化 asset 的 `engine_runtime_mode`，用于区分显式 `ATTACHED_ENDPOINT` 与自动选择的 `SUPERVISED` 生命周期语义；该内部状态当前不要求经现有 RPC 直接暴露。
- 生成唯一 `local_asset_id`（ULID 格式）。
- 初始状态为 `INSTALLED`（`K-LOCAL-005` 状态机锚点）。
- runtime 既是注册真源，也是本地资产获取、导入、orphan scaffold/adopt、transfer/progress 与生命周期的唯一执行面；desktop 仅负责 shell-native/helper 能力。
- 重复安装同一 `model_id` + `engine` + `kind` 组合时返回 `ALREADY_EXISTS` + `AI_LOCAL_ASSET_ALREADY_INSTALLED`。

## K-LOCAL-010 Verified 资产目录结构

`LocalVerifiedAssetDescriptor` 定义 verified 资产的元数据：

| 字段 | 必填 | 说明 |
|---|---|---|
| `template_id` | 是 | 唯一标识（如 `llama3.1-8b`） |
| `title` | 是 | 人类可读名称 |
| `model_id` | 是 | 安装时使用的 model_id |
| `logical_model_id` | 是 | 用户抽象 ID；不得直接退化成 provider alias |
| `kind` | 是 | 资产类型（`chat` / `image` / `video` / `tts` / `stt` / `vae` / `clip` / `lora` / `controlnet` / `auxiliary`） |
| `repo` | 条件必填 | 资产仓库地址；`install_kind=verified-hf-multi-file` 时必填 |
| `capabilities` | 是 | 能力列表（`chat`/`embedding` 等） |
| `engine` | 是 | 目标引擎（`llama`/`media`/`speech`/`sidecar`） |
| `entry` | 条件必填 | 引擎内资产入口标识；`install_kind=verified-hf-multi-file` 时必填 |
| `files` | 条件必填 | 组成文件列表；`install_kind=verified-hf-multi-file` 时必填 |
| `hashes` | 条件必填 | 文件哈希校验（`sha256:{hex}` 格式）；`install_kind=verified-hf-multi-file` 时必填 |
| `endpoint` | 否 | 默认端点（覆盖 `K-LENG-005`） |
| `install_kind` | 是 | 安装类型（`binary`/`weights`/`container`/`verified-hf-multi-file`） |
| `total_size_bytes` | 否 | 预计总下载字节数（用于进度计算与磁盘空间预检） |
| `tags` | 否 | 标签列表（搜索/过滤用，如 `["llama", "chat", "8b"]`） |
| `artifact_roles` | 是 | runtime 解析 bundle 所需的 artifact 角色集合 |
| `preferred_engine` | 是 | 首选执行引擎；值域固定为 `llama` / `media` / `speech` / `sidecar` |


## K-LOCAL-011 模型目录来源

Phase 1 模型目录来源：

- **Verified list**：进程内硬编码的可信模型列表。`ListVerifiedAssets` 直接返回。
- **HuggingFace Catalog**：通过 HF REST API 搜索社区模型（`K-LOCAL-023`）：
  - API: `https://huggingface.co/api/models`（REST GET）
  - 搜索参数: `search`（query）+ `pipeline_tag` + `library` 过滤
  - 超时: 20s
  - 结果数限制: 1–80（由 `limit` 参数控制）
  - 能力推断: 从 `pipeline_tag` + `tags` 推导 capability（映射规则见 `K-LOCAL-023`）
- **Catalog search** 结果排序: verified 置顶 + HF results（`K-LOCAL-021`）

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
| 2 | `install` | 执行 `InstallVerifiedAsset` / `ImportLocalAsset` / `InstallLocalService`，持久化状态 |
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
- daemon 不负责枚举 mod manifest 中声明了哪些 profile；profile 列举职责仍属于 desktop / mod host。daemon 只负责执行传入的单个 profile。
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
| `speech` | `voice_workflow.tts_v2v` | `speech_native_adapter` |
| `speech` | `voice_workflow.tts_t2v` | `speech_native_adapter` |
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
   - `media` node 必须通过 canonical media catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。若 runtime 内部回退到 `media.diffusers`，必须在 `provider_hints.media` 中暴露 fallback driver 与原因。
   - `speech` node 必须通过 canonical speech catalog probe；若 `/v1/catalog` 中缺失与目标 `logical_model_id` 可比对的 ready entry，则 node 必须 `available=false` + fail-close。
   - `media` node 的 `provider_hints.extra` 必须暴露 runtime host 支持面（如 `runtime_support_class=supported_supervised|attached_only|unsupported`），供目录层解释为何当前 host 只能 attached。
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
| `local/` | 按 host + capability 做 engine-first 路由：`text.generate/text.embed/image.understand/audio.understand -> llama`，`image.generate/image.edit/video.generate/i2v -> media`，`audio.transcribe/audio.synthesize/voice_workflow.tts_v2v/voice_workflow.tts_t2v -> speech`，仅当 `media` 不支持当前 family 或 artifact completeness 不满足时，才允许 runtime 内部回退到 `media.diffusers` |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`llama/qwen2.5-7b-instruct` 匹配 `model_id=qwen2.5-7b-instruct` 且 `engine=llama`；`media/flux.1-schnell` 匹配 `model_id=flux.1-schnell` 且 `engine=media`；`sidecar/musicgen` 匹配 `model_id=musicgen` 且 `engine=sidecar`）。

fallback 补充：

- `local/*` 默认路由不得跨 family 静默换模型；fallback 只允许在同一 logical model 的声明引擎集合内发生。
- 若 `media` 与其内部 `media.diffusers` fallback 都不可执行，runtime 必须 fail-close，不得伪装 ready 或静默退回 cloud/provider alias。

未知前缀（如 `ollama/`）视为无前缀，按 `model_id` 全文精确匹配（不剥除前缀）。

## K-LOCAL-020a Chat/Text 本地模型可选性

本地 chat/text 模型的选择与预热语义固定为：

- `status in {INSTALLED, ACTIVE}` 的本地 chat/text 模型可被 route 选择与 UI 展示。
- `UNHEALTHY` 与 `REMOVED` 的本地模型不得作为可选项暴露。
- 当真实 text 请求命中 `INSTALLED` 的本地模型时，runtime 必须先执行 `WarmLocalAsset`，预热成功后再继续请求。
- `ACTIVE` 表示模型已通过 runtime readiness 校验，可直接被选择；它不要求模型常驻运行或常驻占用内存。
- `INSTALLED` 表示模型已完成安装/导入与最小元数据登记，但尚未完成可执行级 readiness 验证；仅 `/v1/models` reachability 或等价进程探活成功，不足以把 chat/text 模型提升为 `ACTIVE`。
- background validation 可以补充 bundle / endpoint / probe 信息，但只有最小 text 执行或等价 warm 成功后，chat/text 模型才允许从 `INSTALLED` 迁移到 `ACTIVE`。
- `WarmLocalAsset`、真实 text 请求、或等价 runtime 维护路径若在最小执行阶段失败，模型必须保留结构化失败原因并转为 `UNHEALTHY`，不得伪装为 `ACTIVE`。
- 该放宽仅适用于 chat/text；`image.generate`、`video.generate`、`audio.synthesize`、`audio.transcribe` 等 media/speech 路径不继承本规则，除非对应 runtime contract 另行声明按需 warm 语义。

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

- Desktop 必须将共享的 `LocalDeviceProfile` 映射到 `llmfit` 所需的 system spec；不得绕过 `K-DEV` 另起一套私有硬件真相源
- v1 在无 `model-index` 前提下，允许基于 repo/title/tag、entry quant filename、以及 artifact size 对参数量 / context 做保守推断
- `fit_level` 映射固定为：
  - `Perfect -> recommended`
  - `Good -> runnable`
  - `Marginal -> tight`
  - `TooTight -> not_recommended`
- `recommended_entry` 可以指向与当前默认 entry 不同的更合适 quant 变体；其余变体进入 `fallback_entries`
- 当参数量、context 或 quant 只能从 filename/size 推断时，系统必须降低 `confidence` 或通过 reason / note 暴露推断来源

## K-LOCAL-021e Recommendation candidate feed

Runtime/desktop 允许在 catalog surface 之外新增 capability-scoped candidate feed read surface，用于 recommendation page：

- feed 的候选池可以来自 worker/index、verified corpus 或等价的 capability-first catalog，但必须输出 install-bridge-ready entry metadata
- worker/index 只负责原始候选与 install-ready metadata；最终 `tier / host_support_class / confidence` 排序必须在 Desktop/Tauri 基于本机设备画像完成
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

未匹配的 `pipeline_tag` 回退为 `chat`（默认）。

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

Desktop/Tauri 面向用户与 App/Mod 的统一资产 manifest public contract 固定为 `resolved/<local-asset-id>/asset.manifest.json`。旧 `manifest.json`、`model.manifest.json`、`artifact.manifest.json` 不再是合法 public import/install 入口，实现必须 reject。

`resolved/` 是统一资产管理根目录；裸文件 intake 不得将 `resolved/` 视作 orphan/unregistered 候选。

## K-LOCAL-026 模型 Manifest Schema

`resolved/<local-asset-id>/asset.manifest.json` 结构定义：

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
- `capabilities` 每项须为有效值（`chat` | `image` | `video` | `tts` | `stt` | `embedding`）。
- `hashes` 的所有 key 须指向存在的文件，value 非空。
- 文件路径规范化：拒绝绝对路径、拒绝 `..` 遍历、反斜杠转正斜杠。

## K-LOCAL-027 格式支持策略

- **GGUF**: 量化格式，llama 引擎首选。
- **SafeTensors**: 全精度 / 多文件格式，未来主方向。
- 不锁定单一格式：新架构模型可能仅有 SafeTensors 版本。
- Entry 选择优先级（llama 引擎）：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

## K-LOCAL-028 Runtime 获取与执行所有权

- local asset（含所有 kind：chat、image、video、tts、stt、vae、clip、lora、controlnet、auxiliary）的搜索、下载、安装、导入、orphan scaffold/adopt、health/readiness、audit 与 transfer/progress 全部由 runtime 执行并持久化。
- desktop 不得再持有并回写第二套本地资产状态，不得通过 host-local state 推断安装成功、下载完成或资产可启动。
- desktop / web / mods 对本地资产的产品访问必须经 `RuntimeLocalService` typed surface；desktop host 仅保留 picker、reveal、notification 与等价 shell-native/helper 能力。
- future CLI / Web 路径扩展时必须继续复用 runtime 作为统一本地资产控制面，不得复制第二套执行面。
- passive asset 的生命周期（install / remove / transfer）与 runnable asset 共享同一执行管道与状态机（`K-LOCAL-005`），但 passive asset 不参与 Service 绑定与 Node 生成。

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

## K-LOCAL-031 engineSlot 规则

`engineSlot` 是 passive asset 在 workflow 执行时的槽位标识，决定 runtime 将该 asset 的解析路径注入到 engine 请求的哪个参数位置：

- passive asset（`kind` 为 `vae`、`clip`、`lora`、`controlnet`、`auxiliary`）必须声明 `engineSlot`。缺失 `engineSlot` 的 passive asset 在 `ResolveProfile` / workflow profile 渲染时必须 fail-close（`AI_LOCAL_ASSET_SLOT_MISSING`）。
- runnable asset（`kind` 为 `chat`、`image`、`video`、`tts`、`stt`，即 workflow 的主执行 asset）禁止声明 `engineSlot`。设置 `engineSlot` 的 runnable asset 在 `ResolveProfile` / workflow profile 渲染时必须 fail-close（`AI_LOCAL_ASSET_SLOT_FORBIDDEN`）。
- `engineSlot` 值域由 engine 定义，典型值包括但不限于：`vae_path`、`llm_path`、`lora_path`、`controlnet_path`、`clip_path`。
- 同一 profile 内，同一 `engineSlot` 不得出现重复绑定；冲突时 `ResolveProfile` 必须 fail-close（`AI_LOCAL_PROFILE_SLOT_CONFLICT`）。
- runtime 在 workflow 执行前，必须从当前 profile 的已安装 passive asset 中按 `engineSlot` 解析路径，注入到 engine 请求参数中。未安装或 `UNHEALTHY` 的 passive asset 对应的 slot 必须 fail-close，不得静默跳过或使用默认值。

## K-LOCAL-032 Profile Entry Override 规则

profile entry 允许通过 `overrides` 字段覆盖 asset 的非路径 profile 参数：

- `overrides` 仅允许覆盖 engine-specific 参数（如 `steps`、`cfg_scale`、`scheduler` 等），不得覆盖 `parameters.model`、`download_files`、任何 `*_path` 字段或 `engineSlot` 绑定。
- 尝试覆盖受保护字段时，`ResolveProfile` 必须 fail-close（`AI_LOCAL_PROFILE_OVERRIDE_FORBIDDEN`）。
- `overrides` 的应用时机在 runtime 完成 slot 路径注入之后，engine 请求构造之前。
- `overrides` 不得触发 asset 重新安装或 Service 重启；它们仅影响单次 workflow 执行参数。
- profile entry 不携带 `overrides` 时，使用 asset 自身的默认参数。
