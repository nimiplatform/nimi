# Local Model Execution Spec

> Status: Draft
> Date: 2026-03-01
> Scope: runtime 内部 local model 子系统（LocalAI/Nexa）的三层抽象、引擎管理、模型获取、依赖解析、生命周期编排、设备画像、执行行为、持久化与审计契约。
> Normative Imports: `spec/runtime/kernel/*`

## 0. 权威导入

本文件不重复定义通用契约，统一引用 kernel：

- RPC 权威面：`kernel/rpc-surface.md` (`K-RPC-*`)
- local category/capability：`kernel/local-category-capability.md` (`K-LOCAL-*`)
- 引擎契约：`kernel/local-engine-contract.md` (`K-LENG-*`)
- 设备画像：`kernel/device-profile-contract.md` (`K-DEV-*`)
- 流式契约：`kernel/streaming-contract.md` (`K-STREAM-*`)
- 错误模型：`kernel/error-model.md` (`K-ERR-*`)
- 分页语义：`kernel/pagination-filtering.md` (`K-PAGE-*`)
- 审计字段：`kernel/audit-contract.md` (`K-AUDIT-*`)
- 引擎目录：`kernel/tables/local-engine-catalog.yaml`
- 适配器路由：`kernel/tables/local-adapter-routing.yaml`

## 1. 模块定位

- `LOCAL-001`: local 子系统只处理 `connector.kind=LOCAL_MODEL` 的执行路径。
- `LOCAL-002`: remote 执行统一由 `nimillm` 处理。
- `LOCAL-003`: 入口分流由上游（`services/ai`）执行，local 子系统不实现第二套路由判定。

## 2. 三层抽象 — Model / Service / Node

### 2.1 层定义

按 `K-LOCAL-007`（三层抽象）：

- **Model**（`LocalModelRecord`）：本地模型资产与元数据（weights/config/hash/capabilities）。Model 是安装与注册的基本单元。
- **Service**（`LocalServiceDescriptor`）：受管进程实例（启动、停止、健康探测）。
- **Node**（`LocalNodeDescriptor`）：能力计算视图（运行时动态生成，不持久化）。

### 2.2 不变量

- `LOCAL-010`: Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service，`K-LOCAL-008`）。
- `LOCAL-011`: Node 是计算视图，不作为持久化对象（`K-LOCAL-008`）。
- `LOCAL-012`: 并发状态变更必须串行（同 `local_model_id` 或 `service_id`）。

## 3. Category 与能力对齐

按 `K-LOCAL-001`（固定 category）与 `K-LOCAL-002`（capability 映射）：

- `LLM`: `CHAT` + `EMBEDDING`（可带 `VISION` 标记）
- `VISION`: 能力标记，不是独立执行模态
- `IMAGE`/`TTS`/`STT`: 同名模态
- `CUSTOM`: 需 invoke profile（缺失则不可用，`K-LOCAL-003`）

- `LOCAL-020`: local connector 固定由系统预设，执行路径按 `model_id` 与能力映射决定。
- `LOCAL-021`: category 与执行路由解耦（`K-LOCAL-004`），connector 层只做薄描述。

## 4. 引擎与 Provider

### 4.1 Phase 1 引擎

按 `K-LENG-001`（引擎类型枚举）：

- `localai`：LocalAI，OpenAI-compatible HTTP 服务，默认端点 `http://127.0.0.1:1234/v1`。
- `nexa`：Nexa，OpenAI-compatible HTTP 服务，需显式提供 endpoint。

引擎类型值域以 `tables/local-engine-catalog.yaml` 为事实源。

### 4.2 引擎运行模式

- `LOCAL-030`: Phase 1 同时支持 `ATTACHED_ENDPOINT` 和 `SUPERVISED` 两种模式（`K-LENG-002`/`K-LENG-003`/`K-LENG-004`）。
  - `ATTACHED_ENDPOINT`：连接外部已运行的引擎进程，runtime 不管理其生命周期。
  - `SUPERVISED`：runtime 管理引擎进程的完整生命周期（二进制下载/安装、启动、健康监控、重启、停止）。
- `LOCAL-031`: `SUPERVISED` 模式通过 `engine.Manager` 子系统实现，详见 `K-LENG-004`。引擎启动失败不阻塞 daemon，标记 `DEGRADED` 直到就绪。

### 4.3 适配器路由

- `LOCAL-032`: adapter 决策必须在 runtime 内闭环完成，不依赖 Desktop 侧私有路由逻辑。
- `LOCAL-033`: adapter 路由规则以 `tables/local-adapter-routing.yaml` 为事实源（`K-LOCAL-017`）。

### 4.4 策略门控

- `LOCAL-034`: 策略门控按 `K-LOCAL-018` 条件性禁止特定 provider × capability 组合。
- `LOCAL-035`: 门控信息（`policy_gate`/`gate_reason`/`gate_detail`）通过 `LocalProviderHints` 透传给审计与调用方。`LocalProviderHintsNexa.policy_gate` 为 string 门控标识符；`AppendInferenceAuditRequest.policy_gate` 为 `Struct` 结构化上下文（见 `K-LOCAL-018`）。

## 5. 模型获取

### 5.1 Verified 目录

- `LOCAL-040`: `ListVerifiedModels` 返回进程内硬编码的可信模型列表（`K-LOCAL-010`/`K-LOCAL-011`）。
- `LOCAL-041`: `SearchCatalogModels` 搜索 verified list 与 HuggingFace Catalog（`K-LOCAL-011`），支持按 `query`（title/description 模糊匹配）和 `capability` 过滤，`limit` 控制返回上限（默认 50，最大 200，语义同 `K-PAGE-001`）。结果排序按 `K-LOCAL-021`（verified 置顶）。

### 5.2 HuggingFace 搜索

- `LOCAL-150`: `SearchHuggingFaceModels` 调用 HF REST API（`https://huggingface.co/api/models`），返回匹配结果。搜索参数包含 `search`（query）、`pipeline_tag`、`library` 过滤，超时 20s，结果数 1–80（`K-LOCAL-011`）。
- `LOCAL-151`: 搜索结果与 verified list 合并时，verified 条目置顶，HF 结果在后（`K-LOCAL-021`）。同一 `model_id` 在两个来源均存在时，以 verified 版本为准。
- `LOCAL-152`: 能力推断规则 — 从 HF `pipeline_tag` + `tags` 推导 capability，映射表见 `K-LOCAL-023`。未匹配的 `pipeline_tag` 回退为 `chat`。HF 搜索失败（网络超时/API 错误）返回 `AI_LOCAL_HF_SEARCH_FAILED`，但不阻塞 verified list 返回。

### 5.3 下载管线

- `LOCAL-153`: `DownloadModel` 按 `K-LOCAL-024` 执行完整下载流程：文件列表组装 → 逐文件下载（断点续传） → SHA256 校验 → 原子提交。HF repo 标识规范化按 `K-LOCAL-023`（接受三种格式）。repo 格式无效返回 `AI_LOCAL_HF_REPO_INVALID`。
- `LOCAL-154`: 进度事件通过事件通道推送，结构包含 `install_session_id`（ULID）/ `phase`（`downloading` | `verifying` | `committing`）/ `bytes_received` / `bytes_total` / `speed`（bytes/s）/ `eta`（seconds）/ `message` / `done` / `success`。
- `LOCAL-155`: 下载失败不影响已安装模型状态（隔离）。staging 目录在失败或取消时清理，不留残余。下载失败返回 `AI_LOCAL_DOWNLOAD_FAILED`，hash 校验失败返回 `AI_LOCAL_DOWNLOAD_HASH_MISMATCH`。

### 5.4 存储布局

- `LOCAL-156`: 模型目录结构按 `K-LOCAL-025`。模型根目录 `~/.nimi/models/`，每模型子目录 `{models_dir}/{local_model_id_slug}/`。嵌套目录保留原始结构。
- `LOCAL-157`: Manifest 文件按 `K-LOCAL-026` schema 生成并持久化为 `model.manifest.json`，位于模型子目录根。manifest 校验失败返回 `AI_LOCAL_MANIFEST_SCHEMA_INVALID`。

### 5.5 格式支持

- `LOCAL-158`: 支持 GGUF + SafeTensors 格式（`K-LOCAL-027`）。不锁定单一格式。entry 选择优先级（localai 引擎）：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

### 5.6 手动安装

- `LOCAL-042`: `InstallLocalModel` 接受完整模型元数据（model_id/repo/capabilities/engine/endpoint），执行注册 + 状态持久化（`K-LOCAL-009`）。
- `LOCAL-043`: 重复安装同一 `model_id` + `engine` 组合返回 `ALREADY_EXISTS` + `AI_LOCAL_MODEL_ALREADY_INSTALLED`。

### 5.7 Verified 安装

- `LOCAL-044`: `InstallVerifiedModel` 接受 `template_id`，从 verified list 查找模板，展开为完整 `InstallLocalModel` 参数后执行安装。
- `LOCAL-045`: `template_id` 不存在时返回 `NOT_FOUND` + `AI_LOCAL_TEMPLATE_NOT_FOUND`。

### 5.8 Manifest 导入

- `LOCAL-046`: `ImportLocalModel` 接受 `manifest_path`，从本地文件系统读取模型清单文件，解析后执行安装。
- `LOCAL-047`: manifest 文件不存在或解析失败返回 `INVALID_ARGUMENT` + `AI_LOCAL_MANIFEST_INVALID`。

### 5.9 安装计划解析

- `LOCAL-048`: `ResolveModelInstallPlan` 在安装前执行预检（`K-LOCAL-012`），返回 `LocalInstallPlanDescriptor`。
- `LOCAL-049`: 预检包含设备画像采集（`K-DEV-001`）、硬件兼容性检查（`K-DEV-007`）、`install_available` 判定与 `LocalProviderHints` 填充。

## 6. 依赖解析

### 6.1 声明模型

- `LOCAL-050`: 依赖声明使用 `LocalDependenciesDeclarationDescriptor`（`K-LOCAL-013`），分为 `required`/`optional`/`alternatives`/`preferred` 四类。`LocalDependencyKind` 中 `WORKFLOW`（4）为预留值，当前未启用。

### 6.2 解析算法

- `LOCAL-051`: `ResolveDependencies` 按 `K-LOCAL-013` 的优先级遍历依赖，输出 `LocalDependencyResolutionPlan`（含 `selection_rationale` 与 `preflight_decisions`）。

### 6.3 Apply 管道

- `LOCAL-052`: `ApplyDependencies` 执行四阶段管道（`K-LOCAL-014`）：preflight → install → bootstrap → health。每阶段产出 `LocalDependencyApplyStageResult`。

### 6.4 回滚

- `LOCAL-053`: 管道任一阶段失败触发逆序回滚（`K-LOCAL-015`），清理已完成阶段的 runtime 内部注册状态，不删除外部资产。

## 7. 生命周期与编排

### 7.1 状态机

按 `K-LOCAL-005`（生命周期状态机锚点），`tables/state-transitions.yaml` 定义：

**Model 生命周期：**

```
           start              health_probe_failed
INSTALLED ──→ ACTIVE ──────────→ UNHEALTHY
  │  ↑         │  ↑                │  │
  │  │  stop   │  │   recovery     │  │ stop
  │  │  ←──────┘  └────────────────┘  │
  │  └───────────────────────────────┘
  │            remove                  │
  └──→ REMOVED ←── ACTIVE/UNHEALTHY ─┘
```

**Service 生命周期：**

```
           spawn              health_probe_failed
INSTALLED ──→ ACTIVE ──────────→ UNHEALTHY
  │  ↑         │  ↑                │  │
  │  │  stop   │  │   restart      │  │ stop
  │  │  ←──────┘  └────────────────┘  │
  │  └───────────────────────────────┘
  │            remove                  │
  └──→ REMOVED ←── ACTIVE/UNHEALTHY ─┘
```

### 7.2 启动 / 停止 / 健康

- `LOCAL-060`: `StartLocalModel` 将 model 状态从 `INSTALLED` 迁移到 `ACTIVE`。在 `ATTACHED_ENDPOINT` 模式下，执行连接验证（健康探测 `K-LENG-007`），成功后更新状态。
- `LOCAL-061`: `StopLocalModel` 将状态从 `ACTIVE`/`UNHEALTHY` 迁移到 `INSTALLED`。在 `ATTACHED_ENDPOINT` 模式下仅更新内部状态，不发送停止信号。
- `LOCAL-062`: `CheckLocalModelHealth` 对指定模型（或全部）执行健康探测。探测失败时迁移到 `UNHEALTHY`，恢复时迁移回 `ACTIVE`。
- `LOCAL-063`: `RemoveLocalModel` 将状态迁移到 `REMOVED`，清理注册信息，级联清理关联 Service。

### 7.3 Service 编排

- `LOCAL-064`: `InstallLocalService` 创建 Service 记录，绑定到指定 Model，初始状态 `INSTALLED`。
- `LOCAL-065`: `StartLocalService`/`StopLocalService`/`CheckLocalServiceHealth`/`RemoveLocalService` 的状态迁移语义与 Model 层镜像，但操作对象为 Service。

### 7.4 编排步骤（安装到可用的完整流程）

1. `ResolveModelInstallPlan` — 预检与计划生成
2. `InstallLocalModel` 或 `InstallVerifiedModel` — 注册 Model
3. `InstallLocalService` — 创建 Service（Phase 1 由安装流程自动执行）
4. `StartLocalModel` — 健康探测 + 状态激活
5. `ListNodeCatalog`（`K-LOCAL-019`）— 确认 Node 可用，支持按 `capability`/`service_id`/`provider` 过滤

## 8. 设备画像

### 8.1 采集

- `LOCAL-070`: `CollectDeviceProfile` 实时采集设备画像（`K-DEV-001`），包含 os/arch/gpu/python/npu/disk/ports。
- `LOCAL-071`: GPU 检测仅覆盖 NVIDIA（`K-DEV-002`/`K-DEV-003`），NPU 纯 ENV 驱动（`K-DEV-004`）。

### 8.2 适配评估

- `LOCAL-072`: `ResolveModelInstallPlan` 与 `ResolveDependencies` 调用时自动采集设备画像，按 `K-DEV-007` 执行硬件-引擎兼容性判定，不满足项输出为 warnings。

## 9. 执行行为

### 9.1 文本 / 嵌入 / 媒体 / 语音

- `LOCAL-080`: 本地执行所有请求必须经由 `RuntimeAiService` 的标准 RPC（`K-RPC-002`），不引入 local 专属对外推理 RPC。
- `LOCAL-081`: 本地引擎通过 OpenAI-compatible HTTP API 调用（`K-LENG-006`），HTTP 错误按 `K-LENG-010` 映射到 gRPC 状态码。

### 9.2 流式降级（local 专属）

- `LOCAL-082`: 当本地 provider 明确不支持流式时，降级为非流式生成并分片模拟推送。`K-LENG-011` 定义的三类不支持信号：(1) HTTP 404/405/501，(2) Content-Type 非 `text/event-stream`，(3) 响应体含 `error` 且状态码指示不支持。

约束：

- 审计必须标记 `stream_fallback_simulated`
- 终帧 metadata 必须标识 `stream_simulated=true`
- 其余事件语义仍需满足 `K-STREAM-002`（阶段边界）与 `K-STREAM-003`（文本流）

### 9.3 model_id 前缀路由

- `LOCAL-083`: AI 执行路径接收到 local model 请求时，按 `K-LOCAL-020` 的前缀规则确定引擎：
  - `localai/` → localai 引擎
  - `nexa/` → nexa 引擎
  - `local/` → 优先 localai，回退 nexa
  - 无前缀 → 精确匹配

## 10. 健康与诊断

### 10.1 对外探测接口

local 健康与模型可见性通过 `ConnectorService.TestConnector(local)` 与 `ConnectorService.ListConnectorModels(local)` 暴露（见 `K-RPC-003`）。

### 10.2 语义

- `LOCAL-090`: `TestConnector(local)` 的 `ok=true` 表示该 category 至少一个可用模型。
- `LOCAL-091`: 无可用模型时 `ok=false` + 本地原因码（`AI_LOCAL_MODEL_UNAVAILABLE`（`K-LOCAL-006`）或 `AI_LOCAL_MODEL_PROFILE_MISSING`）。
- `LOCAL-092`: 内部健康探测使用 `K-LENG-007`（`GET /v1/models`），探测频率由 daemon 控制（默认 8 秒）。

## 11. 存储与持久化

- `LOCAL-100`: 本地状态持久化到 `~/.nimi/state.json`（`K-LOCAL-016`）。
- `LOCAL-101`: 写入使用原子操作（写临时文件 → rename），防止断电损坏。
- `LOCAL-102`: 文件格式包含 `schemaVersion`（当前 `1`），读取时忽略未知字段以保证向前兼容。
- `LOCAL-103`: 每次状态变更（install/remove/start/stop/health）都触发持久化写入。
- `LOCAL-104`: 模型文件存储根目录为 `~/.nimi/models/`（`K-LOCAL-025`），与 `state.json` 同层形成 `~/.nimi/` 统一数据根。

## 12. 审计

- `LOCAL-110`: 本地推理与生命周期操作必须写审计。推理审计字段遵循 `K-AUDIT-001`（通用底线）+ `K-AUDIT-018`（AI 执行扩展）与 `K-AUDIT-002`（事件覆盖面）；生命周期审计仅需遵循 `K-AUDIT-001`（通用底线）与 `K-AUDIT-002`（事件覆盖面）。
- `LOCAL-111`: 审计事件追加存储（`K-LOCAL-016`），上限 5000 条，超出时按 FIFO 淘汰。
- `LOCAL-112`: `AppendInferenceAudit` 记录推理调用（含 provider/adapter/modality/policy_gate）。
- `LOCAL-113`: `AppendRuntimeAudit` 记录生命周期事件（install/remove/start/stop/health）。`payload`（`google.protobuf.Struct`）承载事件专属字段：`install` 含 model_id/engine/endpoint；`remove` 含 model_id/reason；`start/stop` 含 model_id/endpoint；`health` 含 model_id/status/detail。
- `LOCAL-114`: `ListLocalAudits` 支持按 `event_type`（单值）/ `event_types`（多值 repeated，与 `event_type` 做 OR 合并）/ `source` / `modality` / `local_model_id` / `mod_id` / `reason_code` / `time_range` 过滤（过滤语义遵循 `K-PAGE-004`）。

## 13. 错误码使用边界

- 通用跨域错误：使用 `K-ERR-002`（ReasonCode 事实源）中的全局码（`AI_PROVIDER_*`, `AI_MEDIA_*` 等）。
- 本地专属错误：仅用于本地执行域，前缀为 `AI_LOCAL_*`：
  - `AI_LOCAL_MODEL_UNAVAILABLE` — 无可用本地模型
  - `AI_LOCAL_MODEL_PROFILE_MISSING` — CUSTOM 模型缺 profile
  - `AI_LOCAL_MODEL_ALREADY_INSTALLED` — 重复安装
  - `AI_LOCAL_ENDPOINT_REQUIRED` — nexa 引擎缺 endpoint
  - `AI_LOCAL_TEMPLATE_NOT_FOUND` — verified template 不存在
  - `AI_LOCAL_MANIFEST_INVALID` — manifest 文件无效
  - `AI_LOCAL_DOWNLOAD_FAILED` — 模型下载失败（网络/IO 错误）
  - `AI_LOCAL_DOWNLOAD_HASH_MISMATCH` — 下载文件 SHA256 校验不匹配
  - `AI_LOCAL_HF_REPO_INVALID` — HuggingFace repo 标识无效
  - `AI_LOCAL_HF_SEARCH_FAILED` — HuggingFace 搜索 API 调用失败
  - `AI_LOCAL_MANIFEST_SCHEMA_INVALID` — manifest schema 校验失败（字段缺失/无效）
- 不允许在本文件重新分配全局 ReasonCode 编号。

## 14. 非目标

- 不定义 remote provider 执行逻辑
- 不定义 connector CRUD
- 不定义 JWT/JWKS
- 不定义 SDK 层输入体验
- 不定义 SUPERVISED 模式的模型文件管理（HuggingFace 搜索/下载/存储由 Desktop Tauri 层负责）

## 15. 验收门

- `LOCAL-120`: local 子系统单元测试必须覆盖以下场景：
  1. 三层抽象（Model/Service/Node）生命周期状态迁移（Section 7.1）
  2. 安装/移除/启动/停止全路径（LOCAL-060~063）
  3. 设备画像采集与硬件兼容性检查（LOCAL-070~072）
  4. 流式降级模拟（LOCAL-082）含 `stream_fallback_simulated` 审计标记
  5. model_id 前缀路由（LOCAL-083）
  6. verified 安装与 manifest 导入（LOCAL-044~047）
  7. 依赖解析 Apply 管道四阶段与回滚（LOCAL-050~053）
  8. HuggingFace 搜索与结果合并（LOCAL-150~152）
  9. 下载管线：断点续传、重试、SHA256 校验、原子提交（LOCAL-153~155）
  10. 存储布局与 manifest 生成（LOCAL-156~157）
  11. 格式选择与 entry 优先级（LOCAL-158）
- `LOCAL-121`: CI 命令 `pnpm check:runtime-spec-kernel-consistency` 必须通过。
- `LOCAL-122`: `go test ./internal/services/localruntime/...` 与 `go vet ./internal/services/localruntime/...` 必须零错误。

## 16. 变更规则

若变更触及以下跨域主题，必须先改 kernel 再改本文件：

- Local category/capability 语义（`K-LOCAL-*`）
- 引擎类型或运行模式（`K-LENG-*`）
- 设备画像结构或检测策略（`K-DEV-*`）
- 统一流式 done 规则（`K-STREAM-*`）
- 错误码分层与传递（`K-ERR-*`）
- 分页排序与过滤（`K-PAGE-*`）
- 审计最小字段（`K-AUDIT-*`）
