# Local AI Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

本地 AI 功能域 — 本地模型管理（安装/导入/启动/停止/移除）、companion artifact 管理、健康检查、推理审计、下载进度，以及 Runtime Config 内的 recommendation feed 页面。

## Module Map

- `runtime/local-ai-runtime/` — Local AI runtime 管理
- `bridge/runtime-bridge/local-ai.ts` — Local AI IPC 桥接（懒加载）
- `features/runtime-config/` — Runtime 配置面板中的本地 AI 管理 UI
- `features/runtime-config/runtime-config-page-recommend*` — model-index 驱动的推荐页

## Kernel References

### IPC (D-IPC-010, D-IPC-011)

Local AI 桥接通过 local runtime bridge loader 懒加载（`D-IPC-010`），命令清单见 `D-IPC-011`。

companion artifact、`engineConfig` 与 local image workflow（`profile_overrides` / `components`）通过同一 bridge facade 暴露；Desktop 只负责选择和透传，不负责写绝对路径。

### LLM (D-LLM-004)

`checkLocalLlmHealth` — 验证本地引擎可用性。

### Hook Capability (D-HOOK-009)

mod 如需枚举 companion assets，必须显式声明 `runtime.local.artifacts.list`。如需读取推荐组合或发起一键安装，请显式声明：

- `runtime.local.profiles.list`
- `runtime.local.profiles.install.request`

### LLM (D-LLM-006)

推理审计记录：`LocalRuntimeInferenceAuditPayload`（eventType、source、modality、adapter、policyGate）。

### Error (D-ERR-001 — D-ERR-003)

本地 AI 错误码：
- 导入错误：`LOCAL_AI_IMPORT_*`
- 模型错误：`LOCAL_AI_MODEL_*`
- 端点错误：`LOCAL_AI_ENDPOINT_*`
- Speech 引擎环境错误：`LOCAL_AI_SPEECH_*`

### Security (D-SEC-001)

端点回环限制：本地端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

### Security (D-SEC-006)

模型完整性校验：`hashes` 非空、导入时哈希验证。

### Telemetry (D-TEL-005)

日志区域 `local-ai`。

## 模型获取管线

### 获取所有权（K-LOCAL-028）

主模型 acquisition 固定为 download / detect / import 三条路径；Desktop execution-plane 负责主模型下载、orphan detect/scaffold 和 resolved manifest import。

companion artifact 的状态真相与安装落盘由 Desktop Tauri `local_runtime` 统一维护。Desktop 不再经 runtime SDK `RuntimeLocalService` 维护第二条 artifact 管理路径。

### HuggingFace 搜索

Desktop 通过 Rust/reqwest 直接调用 HF REST API（`K-LOCAL-023`），不引入 `hf-hub` crate。搜索结果与 verified list 合并后返回前端，verified 置顶（`K-LOCAL-021`）。

catalog、variant picker、install plan preview、installed detail 与 model orphan detect lane 统一复用同一 `recommendation` 结构；Desktop 不新增独立 recommendation 命令面。

### 下载管线

Desktop Rust 层实现完整下载管线（`K-LOCAL-024`）：

- 断点续传（HTTP Range headers）
- 指数退避重试（最多 8 次）
- 逐文件 SHA256 校验
- 原子提交（staging → rename，失败 rollback）
- 进度通过 Tauri event channel 推送至前端

### Mod Profile 安装流

面向 mod 与 Runtime Config 的推荐安装 UX 必须围绕 `manifest.ai.profiles` 展开，而不是直接暴露底层 dependency list：

- Desktop 只在选中某个 mod 时展示该 mod 声明的 profiles。
- profile 是用户可理解的安装组合，可包含主模型、companion artifact、service 与 node。
- host 在执行前必须弹出确认。
- Tauri bridge 必须提供 `runtime_local_profiles_resolve` / `runtime_local_profiles_apply` 作为 profile 执行入口；内部允许继续复用 dependency resolver / apply。
- companion artifact 安装与移除通过 `runtime_local_artifacts_*` command surface 执行；用户入口仍可被 profile/install UX 聚合，但执行面不得绕经 runtime SDK。

### 存储布局

模型文件存储在 `~/.nimi/models/`（`K-LOCAL-025`），按 `objects/`、`sources/`、`recipes/`、`resolved/`、`cache/` 结构组织（`K-LOCAL-026`）。

companion artifact manifest 也必须位于 `~/.nimi/models/` 根下的结构化目录中。Desktop 本轮不支持外部路径自动复制 artifact manifest。

### 格式支持

支持 GGUF + SafeTensors（`K-LOCAL-027`），entry 选择按优先级：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

本轮 recommendation v1 的边界：

- `chat / vision-LLM` 走 `llmfit`
- `image + video` 走 `media-fit`
- GGUF 强支持，SafeTensors 保守支持
- `tier` 只表示主模型适配度
- `hostSupportClass` 与 `confidence` 是正式契约字段，不是 UI 私有派生值
- hard prerequisites 会进入估算与提示，但不会把主 tier 直接降为 `not_recommended`
- orphan scan 允许按当前 UI 选择的 capability 做基础 recommendation；scaffold 默认引擎必须与该 recommendation 使用同一套 media 默认规则

### Recommendation Feed Page

Runtime Config 允许新增独立 `recommend` page，用于消费 capability-scoped candidate feed，而不改变 catalog/install-plan 的现有命令面语义：

- feed 数据源来自 `model-index` worker，经 Desktop/Tauri 本地缓存后暴露给 renderer；renderer 不得直连 worker
- feed item 必须同时携带：
  - worker candidate 基础信息
  - 统一 `recommendation` payload
  - `installedState`
  - `actionState`
  - 可直接桥接现有 install-plan 的 payload
- feed 页面只开放 `chat / image / video` 三个 capability
- 排序由 Desktop/Tauri 在本机 recommendation 结果上完成；worker 只输出 capability-scoped 原始候选，不做 device-specific ranking
- 离线行为固定：
  - 有缓存时渲染上次成功快照并标记 stale
  - 无缓存时显示 empty/offline state
  - renderer 不得自行做远程 fallback
- 页面 CTA 语义固定：
  - `Review Install Plan` 继续走现有 `resolve_install_plan`
  - `Open Variants` 继续走现有 `list_variants`
  - `Open in Local Models` 只做 Runtime Config 页面跳转，不新增安装协议

### IPC Commands

| Command | 方向 | 说明 |
|---|---|---|
| `runtime_local_models_install` / `runtime_local_models_install_verified` | Frontend → Rust | 创建模型安装会话并入队 |
| `runtime_local_artifacts_list` / `runtime_local_artifacts_verified_list` | Frontend → Rust | 查询 companion artifact 已安装项与 verified catalog |
| `runtime_local_artifacts_install_verified` | Frontend → Rust | 安装 verified companion artifact |
| `runtime_local_artifacts_import` / `runtime_local_artifacts_remove` | Frontend → Rust | 导入或移除 companion artifact |
| `runtime_local_downloads_cancel` | Frontend → Rust | 取消进行中的下载，清理 staging |
| `runtime_local_models_catalog_search` | Frontend → Rust | 搜索 HuggingFace/catalog 模型 |

### Recommendation 审计

Desktop/Tauri local runtime 在 recommendation 解析时必须补充运行时审计事件：

- recommendation 审计仅覆盖 request-driven resolve 面：`catalog search`、`list variants`、`resolve install plan`、`scan orphans`、`recommendation feed get`
- `installed detail` / 被动列表刷新不得单独刷 recommendation 审计
- `recommendation_resolve_invoked`
- `recommendation_resolve_completed`
- `recommendation_resolve_failed`

payload 至少包含 `itemId/modelId/capability/source/format/tier/hostSupportClass/confidence/reasonCodes`。

`recommendation feed get` 使用 feed-scoped 聚合 payload：

- `itemId = recommend-feed:<capability>`
- `modelId = null`
- `source = model-index-feed`
- 允许追加 `itemCount`、`cacheState`

### Error（下载相关）

下载错误码族 `LOCAL_AI_HF_DOWNLOAD_*`：

- `AI_LOCAL_DOWNLOAD_FAILED` — 下载失败（网络/IO 错误）
- `AI_LOCAL_DOWNLOAD_HASH_MISMATCH` — SHA256 校验不匹配
- `AI_LOCAL_HF_REPO_INVALID` — HF repo 标识无效
- `AI_LOCAL_HF_SEARCH_FAILED` — HF 搜索 API 调用失败
- `AI_LOCAL_MANIFEST_SCHEMA_INVALID` — manifest schema 校验失败

## 文件导入管线（主模型）

### 概述

用户可直接选择本地任意位置的主模型文件（`.gguf`、`.safetensors`、`.bin`、`.pt`、`.onnx`、`.pth`），系统自动复制到 `~/.nimi/models/objects/` 与对应 source 目录、单遍计算 SHA256、生成 `resolved/<logical-model-id>/manifest.json`、注册到 `state.json`。

### 流程

1. **文件选择** — `runtime_local_pick_model_file` 通过原生文件对话框选取模型文件（不限于 `~/.nimi/models/`）
2. **校验阶段**（同步，返回前）:
   - 源文件存在且是文件（`LOCAL_AI_FILE_IMPORT_NOT_FOUND`）
   - capabilities 非空（`LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY`）
   - endpoint 回环限制校验（`LOCAL_AI_ENDPOINT_*`）
3. **同步返回** — 返回 local install accepted response（installSessionId, modelId, localModelId）
4. **后台复制**（`std::thread::spawn`）:
   - 创建 resolved bundle 所需目录（至少 `objects/`、`sources/`、`resolved/<logical-model-id>/`）
   - `copy_and_hash_file()` 单遍复制 + SHA256（64KB 缓冲区），每 200ms 通过 `local-ai://download-progress` 事件报告进度
   - 生成并写入 `resolved/<logical-model-id>/manifest.json`
   - `upsert_model()` 注册到 `state.json`
   - 发出完成 progress event（`done: true, success: true`）
   - 审计事件: `model_file_import_started` + `model_import_validated`
5. **错误回滚** — 任何阶段失败清理已创建的目标目录，发出 `done: true, success: false` progress event

### IPC Commands

| Command | 方向 | 说明 |
|---|---|---|
| `runtime_local_pick_model_file` | Frontend → Rust | 原生对话框选择模型文件 |
| `runtime_local_models_import_file` | Frontend → Rust | 触发文件导入（复制+hash+manifest+注册） |

### Error（文件导入相关）

文件导入错误码族 `LOCAL_AI_FILE_IMPORT_*`：

- `LOCAL_AI_FILE_IMPORT_NOT_FOUND` — 源文件不存在或非文件
- `LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY` — 至少需要一个 capability
- `LOCAL_AI_FILE_IMPORT_READ_FAILED` — 无法读取源文件
- `LOCAL_AI_FILE_IMPORT_WRITE_FAILED` — 无法写入目标文件
- `LOCAL_AI_FILE_IMPORT_DIR_FAILED` — 无法创建模型子目录
- `LOCAL_AI_FILE_IMPORT_FLUSH_FAILED` — flush 失败
- `LOCAL_AI_FILE_IMPORT_SYNC_FAILED` — sync 落盘失败
- `LOCAL_AI_FILE_IMPORT_MANIFEST_SERIALIZE_FAILED` — manifest JSON 序列化失败
- `LOCAL_AI_FILE_IMPORT_MANIFEST_WRITE_FAILED` — manifest 写盘失败

## Companion Artifact 导入

### 获取边界

companion artifact 支持三条路径：

1. verified artifact install
2. `artifact.manifest.json` import
3. orphan detect/scaffold（独立 companion lane）

Desktop 不复用主模型 orphan detect/scaffold，也不复用主模型 capability 选择入口。

### Import Artifact Manifest

`Import Artifact Manifest` 通过独立 picker 选取 `~/.nimi/models/**/artifact.manifest.json`。该 picker 不得复用主模型 resolved manifest picker。

artifact import 的类型来源固定为 manifest 中的 `kind`，允许值由 runtime local service schema 约束为 `vae / llm / clip / controlnet / lora / auxiliary`。

### Companion Orphan Detect / Scaffold

Desktop 在 `Companion Assets` 区域内提供独立的 `Unregistered Companion Assets` lane。该 lane：

- 扫描 `~/.nimi/models/` 下未被 resolved `manifest.json` 或 `artifact.manifest.json` 纳管的二进制模型文件
- 允许与主模型 orphan lane 同时展示同一裸文件；Desktop 不自动推断其用途
- 只让用户选择 `kind`，不暴露 engine 选择器
- scaffold 固定生成 canonical local engine 的 `artifact.manifest.json`
- scaffold 完成后必须再调用 runtime local facade 的 `importLocalArtifact`

scaffold manifest 固定写入：

- `artifactId = local-import/<artifact-slug>`
- `kind =` 用户选定的 artifact kind
- `engine = media`
- `entry/files =` 原始文件名
- `license = unknown`
- `source.repo = local-import/<artifact-slug>`
- `source.revision = local`
- `hashes = { <filename>: sha256:<digest> }`

verified companion install 失败时，Desktop 必须在 `Artifact Tasks` 中提供 task-local `Retry`，按原 `templateId` 重跑 verified install。该任务流不是 download session。

### Error（artifact import 相关）

- `LOCAL_AI_IMPORT_ARTIFACT_MANIFEST_FILE_NAME_INVALID` — 仅允许导入 `artifact.manifest.json`
- `LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT` — artifact manifest 必须位于 `~/.nimi/models/` 下

### Error（artifact orphan 相关）

- `LOCAL_AI_ARTIFACT_ORPHAN_NOT_FOUND` — companion orphan 文件不存在
- `LOCAL_AI_ARTIFACT_ORPHAN_KIND_INVALID` — companion kind 非法
- `LOCAL_AI_ARTIFACT_ORPHAN_TARGET_EXISTS` — 目标 artifact 目录或文件已存在
- `LOCAL_AI_ARTIFACT_ORPHAN_DIR_FAILED` — companion 目录创建失败
- `LOCAL_AI_ARTIFACT_ORPHAN_MOVE_FAILED` — companion 文件整理失败
- `LOCAL_AI_ARTIFACT_ORPHAN_SOURCE_CLEANUP_FAILED` — copy 成功后源文件清理失败
- `LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_SERIALIZE_FAILED` — companion manifest 序列化失败
- `LOCAL_AI_ARTIFACT_ORPHAN_MANIFEST_WRITE_FAILED` — companion manifest 写盘失败

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18~19 相关规则）。

## Offline / Degradation

当 Realm 或 Runtime 不可达时，本域的可用性降级遵循 `kernel/offline-degradation-contract.md`（D-OFFLINE-001~005）。Local AI 相关命令只在 Runtime 可达时可执行；Realm 离线不阻断本地模型管理。
