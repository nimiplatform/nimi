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

`local_invoke_profile_id` 是 `LocalModelRecord` 的可选 string 字段，由 `InstallLocalModel` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

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
- 迁移触发：`start/spawn`、`stop`、`health_probe_failed`、`recovery`、`remove`

任何 local 生命周期文档必须引用本 Rule ID，不得使用章节号样式来源（例如 `local-model_5.1`）。

## K-LOCAL-006 Local 不可用错误映射

当 local category 无可用模型（例如探活失败或无可执行实例）时：

- 探测路径：`ok=false` + `AI_LOCAL_MODEL_UNAVAILABLE`
- 执行路径：`FAILED_PRECONDITION` + `AI_LOCAL_MODEL_UNAVAILABLE`

## K-LOCAL-007 模型三层抽象

本地模型系统采用三层抽象：

- **Model**（`LocalModelRecord`）：权重资产与元数据（model_id/capabilities/engine/source/hashes）。Model 是安装与注册的基本单元。
- **Service**（`LocalServiceDescriptor`）：受管进程实例。一个 Service 绑定一个 Model，持有 endpoint/status，代表一个可访问的推理服务。
- **Node**（`LocalNodeDescriptor`）：能力计算视图。从 Service × capabilities 笛卡尔积生成，携带 adapter/provider/policy_gate 等路由信息。Node 是运行时能力发现的入口。

## K-LOCAL-008 Phase 1 绑定约束

- Model:Service = 1:1。一个 Model 至多关联一个 Service。
- Node 是计算态，不持久化。每次查询 `ListNodeCatalog` 时从已安装的 Service 实时生成。
- 未来可放宽为 1:N（同一 Model 多引擎实例），但当前版本不支持。

## K-LOCAL-009 Install 语义

`InstallLocalModel` 的语义是注册 + 状态持久化：

- 将 model_id/capabilities/engine/source/endpoint 等字段写入本地状态存储。
- 生成唯一 `local_model_id`（ULID 格式）。
- 初始状态为 `INSTALLED`（`K-LOCAL-005` 状态机锚点）。
- Desktop execution-plane 可在注册后触发模型获取流程（`K-LOCAL-023`/`K-LOCAL-024`）。Phase 1 模型获取由 desktop 独占执行（`K-LOCAL-028`），runtime 不主动发起下载。
- 重复安装同一 `model_id` + `engine` 组合时返回 `ALREADY_EXISTS` + `AI_LOCAL_MODEL_ALREADY_INSTALLED`。

## K-LOCAL-010 Verified 模型目录结构

`LocalVerifiedModelDescriptor` 定义 verified 模型的元数据：

| 字段 | 必填 | 说明 |
|---|---|---|
| `template_id` | 是 | 唯一标识（如 `llama3.1-8b`） |
| `title` | 是 | 人类可读名称 |
| `model_id` | 是 | 安装时使用的 model_id |
| `repo` | 条件必填 | 模型仓库地址；`install_kind=verified-hf-multi-file` 时必填 |
| `capabilities` | 是 | 能力列表（`chat`/`embedding` 等） |
| `engine` | 是 | 目标引擎（`localai`/`nexa`/`sidecar`） |
| `entry` | 条件必填 | 引擎内模型入口标识；`install_kind=verified-hf-multi-file` 时必填 |
| `files` | 条件必填 | 组成文件列表；`install_kind=verified-hf-multi-file` 时必填 |
| `hashes` | 条件必填 | 文件哈希校验（`sha256:{hex}` 格式）；`install_kind=verified-hf-multi-file` 时必填 |
| `endpoint` | 否 | 默认端点（覆盖 `K-LENG-005`） |
| `install_kind` | 是 | 安装类型（`binary`/`weights`/`container`/`verified-hf-multi-file`） |
| `total_size_bytes` | 否 | 预计总下载字节数（用于进度计算与磁盘空间预检） |
| `tags` | 否 | 标签列表（搜索/过滤用，如 `["llama", "chat", "8b"]`） |

## K-LOCAL-011 模型目录来源

Phase 1 模型目录来源：

- **Verified list**：进程内硬编码的可信模型列表。`ListVerifiedModels` 直接返回。
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
   - `engine_runtime_mode=ATTACHED_ENDPOINT` 且 endpoint 可确定 → `true`。
   - `engine_runtime_mode=SUPERVISED` 且引擎二进制可达 → `true`。
   - 否则 → `false`，`reason_code` 说明原因。
4. 填充 `LocalProviderHints`（引擎特定适配信息）。
5. 返回 `LocalInstallPlanDescriptor`（含 warnings 和 reason_code）。

## K-LOCAL-013 依赖解析模型

`LocalDependenciesDeclarationDescriptor` 定义四类依赖：

| 类型 | 语义 | 缺失行为 |
|---|---|---|
| `required` | 必须满足 | 解析失败，reason_code 报错 |
| `optional` | 可选增强 | 跳过，生成 warning |
| `alternatives` | 互选组（多选一） | 按 `preferred_dependency_id` 优先选择；全部不可用则失败 |
| `preferred` | 全局偏好映射（`capability → dependency_id`） | 仅影响 alternatives 中的选择优先级 |

解析过程：

1. 遍历 `required` → 全部必须可满足。
2. 遍历 `optional` → 尽力满足。
3. 遍历 `alternatives` → 按 preferred > 声明顺序选择。
4. 输出 `LocalDependencyResolutionPlan`，含 `selection_rationale` 与 `preflight_decisions`。

## K-LOCAL-014 Apply 管道四阶段

`ApplyDependencies` 执行解析计划，分四阶段：

| 阶段 | 名称 | 动作 |
|---|---|---|
| 1 | `preflight` | 设备画像重新采集，校验硬件兼容性与端口可用性 |
| 2 | `install` | 执行 `InstallLocalModel` / `InstallLocalService`，持久化状态 |
| 3 | `bootstrap` | 执行 `StartLocalService`（ATTACHED_ENDPOINT 模式为连接验证） |
| 4 | `health` | 执行健康探测（`K-LENG-007`），确认服务可用 |

每个阶段产出 `LocalDependencyApplyStageResult{stage, ok, reason_code, detail}`。

## K-LOCAL-015 Apply 失败回滚

Apply 管道任一阶段失败时：

- 逆序清理已完成阶段的副作用（已安装的 model/service 执行 remove）。
- 结果 `rollback_applied=true`。
- 回滚本身失败时，结果同时携带原始失败和回滚失败的 reason_code，不做二次回滚。
- 回滚不触发删除外部资产（如已下载的模型文件），仅清理 runtime 内部注册状态。

> **Phase 1 注释**：ATTACHED_ENDPOINT 模式下，stage 3（bootstrap）仅验证 endpoint 连接可达，stage 4（health）仅验证 `/v1/models` 可响应。回滚的实际影响范围为 stage 2 的注册清理（`InstallLocalModel`/`InstallLocalService` 产生的状态记录）。

## K-LOCAL-016 状态持久化规则

本地模型状态持久化到 `~/.nimi/runtime/local-state.json`：

- 写入使用原子操作：写临时文件 → rename（防止断电损坏）。
- 文件格式包含 `schemaVersion`（当前 `1`），向前兼容时忽略未知字段。
- 审计事件（`LocalAuditEvent`）追加存储，上限默认 5000 条（可通过 `K-DAEMON-009` 配置 `localAuditCapacity` 覆盖），超出时按 FIFO 淘汰。
- 每次状态变更（install/remove/start/stop/health）都触发持久化。

## K-LOCAL-017 适配器路由规则

Node 的 `adapter` 字段按以下规则确定（以 `tables/local-adapter-routing.yaml` 为事实源）：

| Provider | Capability | Adapter |
|---|---|---|
| `nexa` | `*`（任意） | `nexa_native_adapter` |
| `localai` | `image` | `localai_native_adapter` |
| `localai` | `video` | `localai_native_adapter` |
| `localai` | `tts` | `localai_native_adapter` |
| `localai` | `stt` | `localai_native_adapter` |
| `localai` | `music` / `music.generate` | `localai_music_adapter` |
| `sidecar` | `music` / `music.generate` | `sidecar_music_adapter` |
| `*`（任意） | `*`（任意） | `openai_compat_adapter` |

匹配顺序：精确匹配优先于通配符。

## K-LOCAL-018 策略门控（Policy Gate）

策略门控用于条件性禁止特定 provider × capability 组合：

- `LocalNodeDescriptor.policy_gate` 字段描述门控规则标识（如 `nexa.video.unsupported`）。
- 门控触发时：Node 的 `available=false`，`reason_code` 说明原因。
- Nexa NPU 门控判定规则：
  - `host_npu_ready=false` → `npu_usable=false`
  - `model_probe_has_npu_candidate=false` → `npu_usable=false`
  - `policy_gate_allows_npu=false` → `npu_usable=false`
  - 三者均为 `true` → `npu_usable=true`
- 门控信息通过 `LocalProviderHints` 透传给审计与调用方。
- 类型映射：`LocalProviderHintsNexa.policy_gate` 为 string（门控规则标识符）；`AppendInferenceAuditRequest.policy_gate` 为 `google.protobuf.Struct`（结构化门控上下文，含 gate/reason/detail）。两者表达不同粒度，不要求类型对齐。

## K-LOCAL-019 Node 目录生成规则

`ListNodeCatalog` 从已安装且活跃的 Service 实时生成 Node 列表：

1. 遍历所有 `status=ACTIVE` 的 Service。
2. 对每个 Service 的 `capabilities` 做笛卡尔积：每个 capability 生成一个 Node。
3. 每个 Node 填充：
   - `node_id`：`<service_id>:<capability>` 格式。
   - `provider`：从 engine 推导（`localai` → `localai`，`nexa` → `nexa`，`sidecar` → `sidecar`）。
   - `adapter`：按 `K-LOCAL-017` 路由。
   - `available`：健康且未被策略门控（`K-LOCAL-018`）。
   - `provider_hints`：引擎特定适配信息。
4. 支持按 `capability`/`service_id`/`provider` 过滤。

## K-LOCAL-020 model_id 前缀路由

当 AI 执行路径接收到 local model 请求时，按 `model_id` 前缀确定引擎：

| 前缀 | 引擎选择 |
|---|---|
| `localai/` | 仅匹配 `localai` 引擎的已安装模型 |
| `nexa/` | 仅匹配 `nexa` 引擎的已安装模型 |
| `sidecar/` / `localsidecar/` | 仅匹配 `sidecar` 引擎的已安装模型 |
| `local/` | 优先匹配 `localai`，未命中则回退 `sidecar`，再回退 `nexa` |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`localai/llama3.1` 匹配 `model_id=llama3.1` 且 `engine=localai`；`sidecar/musicgen` 匹配 `model_id=musicgen` 且 `engine=sidecar`）。

未知前缀（如 `ollama/`）视为无前缀，按 `model_id` 全文精确匹配（不剥除前缀）。

## K-LOCAL-021 SearchCatalogModels 结果排序

`SearchCatalogModels` 结果固定排序：

1. `verified=true` 在前，`verified=false` 在后。
2. 同组内按 `title ASC`（大小写不敏感）。

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
- **重启恢复策略**: 进程重启后，残留 `running/queued` 会话必须转为 `paused` 且 reason code = `LOCAL_AI_HF_DOWNLOAD_INTERRUPTED`；系统不得自动续传，必须由用户手动 `resume`。
- **逐文件 SHA256 校验**: hash 格式 `sha256:{hex}`，`sha256:` 前缀可选（兼容纯 hex 输入）。校验失败返回 `LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH`。
- **原子提交**: staging → backup → commit（rename），失败 rollback：
  - staging 目录: `{models_dir}/{local_model_id}-staging/`
  - 全部文件下载 + 校验通过后，原子 rename 为最终目录
  - 失败时 rollback：删除 staging，恢复 backup（如有）
- **进度上报**: 通过事件通道推送，结构包含 `install_session_id`/`phase`/`bytes_received`/`bytes_total`/`speed`/`eta`/`message`/`state`/`reason_code?`/`retryable?`/`done`/`success` 字段。
- **失败分级**:
  - 网络/超时/磁盘不足：`failed + retryable=true`，保留 partial staging，允许 `resume`。
  - hash mismatch：`failed + retryable=false`，清理 staging，禁止 `resume`。
  - cancel：`cancelled`，清理 staging。

## K-LOCAL-025 模型存储布局

- 模型根目录: `~/.nimi/models/`
- 每模型子目录: `{models_dir}/{local_model_id_slug}/`
  - `local_model_id_slug` 转换规则: colon → dash（`hf:org-model` → `hf-org-model`）
- **保留原始文件名**（非 content-addressable hash），理由：调试可读、生态工具兼容（vLLM/SGLang 等可直接引用）。
- 必含 `model.manifest.json`（nimi 自有元数据，schema 见 `K-LOCAL-026`）。
- 嵌套目录保留原始结构（如 `speech_tokenizer/model.safetensors`）。

`~/.nimi/` 统一数据根布局：

```
~/.nimi/
├── runtime/
│   └── local-state.json  # 中央状态文件（K-LOCAL-016）
└── models/
    ├── hf-org-model-name/
    │   ├── model.manifest.json   # nimi 元数据（K-LOCAL-026）
    │   ├── model.safetensors     # 原始文件名
    │   └── config.json
    └── hf-another-model/
```

## K-LOCAL-026 模型 Manifest Schema

`model.manifest.json` 结构定义：

```yaml
schema_version: "1.0.0"      # 必填
model_id: "org/model-name"    # 必填
capabilities: ["chat"]        # 必填，1+ 有效值
engine: "localai"             # 必填
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

- **GGUF**: 量化格式，llama.cpp 引擎首选。
- **SafeTensors**: 全精度 / 多文件格式，未来主方向。
- 不锁定单一格式：新架构模型可能仅有 SafeTensors 版本。
- Entry 选择优先级（localai 引擎）：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

## K-LOCAL-028 Desktop 获取所有权

- Phase 1: 所有模型生命周期**写操作**（搜索、下载、安装、删除）由 desktop execution-plane 独占。
- Runtime 仅消费已安装模型的元数据，不主动发起下载。
- 未来可扩展为 CLI / Web 获取路径，但当前版本 desktop 是唯一获取执行面。

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

- `ListLocalModels`
- `ListVerifiedModels`
- `SearchCatalogModels`
- `ListLocalServices`
- `ListNodeCatalog`
- `ListLocalAudits`

统一约束：

- 默认 `page_size=50`；
- 最大 `page_size=200`；
- `page_size>200` 必须裁剪为 `200`，不得回退为默认值；
- `page_token` 为空表示首页；
- 非法 `page_token` 返回 `INVALID_ARGUMENT` + `PAGE_TOKEN_INVALID`。
