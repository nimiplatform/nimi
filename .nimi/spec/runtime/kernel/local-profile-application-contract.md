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
