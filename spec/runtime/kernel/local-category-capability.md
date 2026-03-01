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

## K-LOCAL-003 CUSTOM 可用性门槛

`local_invoke_profile_id` 是 `LocalModelRecord` 的可选 string 字段，由 `InstallLocalModel` 请求设置并持久化到本地状态（`K-LOCAL-016`）。该字段标识 CUSTOM 模型的调用配置文件，用于运行时确定请求格式与参数映射。

`CUSTOM` 模型缺失 `local_invoke_profile_id` 时：

- 必须标记 `available=false`
- 调用返回 `FAILED_PRECONDITION` + `AI_LOCAL_MODEL_PROFILE_MISSING`

## K-LOCAL-004 category 与路由解耦

connector 层是薄描述，不承载用户路由策略。具体执行路由由模型级元数据与执行模块决定。

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
- Phase 1 不包含实际模型权重下载。下载由外部工具或用户手动完成。
- 重复安装同一 `model_id` + `engine` 组合时返回 `ALREADY_EXISTS` + `AI_LOCAL_MODEL_ALREADY_INSTALLED`。

## K-LOCAL-010 Verified 模型目录结构

`LocalVerifiedModelDescriptor` 定义 verified 模型的元数据：

| 字段 | 必填 | 说明 |
|---|---|---|
| `template_id` | 是 | 唯一标识（如 `llama3.1-8b`） |
| `title` | 是 | 人类可读名称 |
| `model_id` | 是 | 安装时使用的 model_id |
| `repo` | 否 | 模型仓库地址 |
| `capabilities` | 是 | 能力列表（`chat`/`embedding` 等） |
| `engine` | 是 | 目标引擎（`localai`/`nexa`） |
| `entry` | 否 | 引擎内模型入口标识 |
| `files` | 否 | 组成文件列表 |
| `hashes` | 否 | 文件哈希校验 |
| `endpoint` | 否 | 默认端点（覆盖 `K-LENG-005`） |
| `install_kind` | 是 | 安装类型（`binary`/`weights`/`container`） |

## K-LOCAL-011 模型目录来源

Phase 1 模型目录来源：

- **Verified list**：进程内硬编码的可信模型列表。`ListVerifiedModels` 直接返回。
- **Catalog search**：`SearchCatalogModels` 在 Phase 1 仅搜索 verified list（按 query/capability 过滤）。

未来扩展方向：

- 远程 catalog API（HuggingFace Hub、自有 registry）
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

本地模型状态持久化到 `~/.nimi/runtime/local-runtime-state.json`：

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
   - `provider`：从 engine 推导（`localai` → `localai`，`nexa` → `nexa`）。
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
| `local/` | 优先匹配 `localai`，未命中则回退 `nexa` |
| 无前缀 | 按已安装模型的 `model_id` 精确匹配 |

前缀在匹配时剥除（`localai/llama3.1` 匹配 `model_id=llama3.1` 且 `engine=localai`）。

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
  - 连续失败持续 24h → 探活间隔降级至 5min。
  - 任一探活成功 → 重置至默认 8s 间隔。
- **探活失败**：重置连续成功计数，继续按间隔重试。
