# Local AI Domain Spec

> Normative Imports: `spec/desktop/kernel/*`

## Scope

本地 AI 功能域 — 本地模型管理（安装/导入/启动/停止/移除）、companion artifact 管理、健康检查、推理审计、下载进度。

## Module Map

- `runtime/local-ai-runtime/` — Local AI runtime 管理
- `bridge/runtime-bridge/local-ai.ts` — Local AI IPC 桥接（懒加载）
- `features/runtime-config/` — Runtime 配置面板中的本地 AI 管理 UI

## Kernel References

### IPC (D-IPC-010, D-IPC-011)

Local AI 桥接通过 `loadLocalAiBridge()` 懒加载（`D-IPC-010`），命令清单见 `D-IPC-011`。

companion artifact、`engineConfig` 与 LocalAI 动态图片工作流（`profile_overrides` / `components`）通过同一 bridge facade 暴露；Desktop 只负责选择和透传，不负责写绝对路径。

### LLM (D-LLM-004)

`checkLocalLlmHealth` — 验证本地引擎可用性。

### Hook Capability (D-HOOK-008)

mod 如需枚举 companion assets，必须显式声明 `runtime.local.artifacts.list`。

### LLM (D-LLM-006)

推理审计记录：`LocalAiInferenceAuditPayload`（eventType、source、modality、adapter、policyGate）。

### Error (D-ERR-001 — D-ERR-003)

本地 AI 错误码：
- 导入错误：`LOCAL_AI_IMPORT_*`
- 模型错误：`LOCAL_AI_MODEL_*`
- 端点错误：`LOCAL_AI_ENDPOINT_*`
- Qwen TTS 环境错误：`LOCAL_AI_QWEN_*`

### Security (D-SEC-001)

端点回环限制：本地端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

### Security (D-SEC-006)

模型完整性校验：`hashes` 非空、导入时哈希验证。

### Telemetry (D-TEL-005)

日志区域 `local-ai`。

## 模型获取管线

### 获取所有权（K-LOCAL-028）

主模型 acquisition 固定为 download / detect / import 三条路径；Desktop execution-plane 负责主模型下载、orphan detect/scaffold 和 `model.manifest.json` import。

companion artifact 的状态真相与安装落盘由 runtime local service 统一维护。Desktop 负责触发 verified install、`artifact.manifest.json` import 和状态渲染，不复制第二套 artifact store。

### HuggingFace 搜索

Desktop 通过 Rust/reqwest 直接调用 HF REST API（`K-LOCAL-023`），不引入 `hf-hub` crate。搜索结果与 verified list 合并后返回前端，verified 置顶（`K-LOCAL-021`）。

### 下载管线

Desktop Rust 层实现完整下载管线（`K-LOCAL-024`）：

- 断点续传（HTTP Range headers）
- 指数退避重试（最多 8 次）
- 逐文件 SHA256 校验
- 原子提交（staging → rename，失败 rollback）
- 进度通过 Tauri event channel 推送至前端

### 存储布局

模型文件存储在 `~/.nimi/models/`（`K-LOCAL-025`），保留原始文件名。每模型子目录包含 `model.manifest.json`（`K-LOCAL-026`）。

companion artifact manifest 也必须位于 `~/.nimi/models/` 根下的某个子目录，并固定命名为 `artifact.manifest.json`。Desktop 本轮不支持外部路径自动复制 artifact manifest。

### 格式支持

支持 GGUF + SafeTensors（`K-LOCAL-027`），entry 选择按优先级：`.gguf` → `model.safetensors` → 任意 `.safetensors`。

### IPC Commands

| Command | 方向 | 说明 |
|---|---|---|
| `local_ai_download_model` | Frontend → Rust | 触发模型下载，参数含 repo/files/hashes/entry |
| `local_ai_cancel_download` | Frontend → Rust | 取消进行中的下载，清理 staging |
| `local_ai_search_hf_models` | Frontend → Rust | 搜索 HuggingFace 模型 |

### Error（下载相关）

下载错误码族 `LOCAL_AI_HF_DOWNLOAD_*`：

- `AI_LOCAL_DOWNLOAD_FAILED` — 下载失败（网络/IO 错误）
- `AI_LOCAL_DOWNLOAD_HASH_MISMATCH` — SHA256 校验不匹配
- `AI_LOCAL_HF_REPO_INVALID` — HF repo 标识无效
- `AI_LOCAL_HF_SEARCH_FAILED` — HF 搜索 API 调用失败
- `AI_LOCAL_MANIFEST_SCHEMA_INVALID` — manifest schema 校验失败

## 文件导入管线（主模型）

### 概述

用户可直接选择本地任意位置的主模型文件（`.gguf`、`.safetensors`、`.bin`、`.pt`、`.onnx`、`.pth`），系统自动复制到 `~/.nimi/models/<slug>/`、单遍计算 SHA256、生成 `model.manifest.json`、注册到 `state.json`。

### 流程

1. **文件选择** — `local_ai_pick_model_file` 通过原生文件对话框选取模型文件（不限于 `~/.nimi/models/`）
2. **校验阶段**（同步，返回前）:
   - 源文件存在且是文件（`LOCAL_AI_FILE_IMPORT_NOT_FOUND`）
   - capabilities 非空（`LOCAL_AI_FILE_IMPORT_CAPABILITIES_EMPTY`）
   - endpoint 回环限制校验（`LOCAL_AI_ENDPOINT_*`）
3. **同步返回** — 返回 `LocalAiInstallAcceptedResponse`（installSessionId, modelId, localModelId）
4. **后台复制**（`std::thread::spawn`）:
   - 创建 `~/.nimi/models/<slug>/` 目录
   - `copy_and_hash_file()` 单遍复制 + SHA256（64KB 缓冲区），每 200ms 通过 `local-ai://download-progress` 事件报告进度
   - 生成并写入 `model.manifest.json`
   - `upsert_model()` 注册到 `state.json`
   - 发出完成 progress event（`done: true, success: true`）
   - 审计事件: `model_file_import_started` + `model_import_validated`
5. **错误回滚** — 任何阶段失败清理已创建的目标目录，发出 `done: true, success: false` progress event

### IPC Commands

| Command | 方向 | 说明 |
|---|---|---|
| `local_ai_pick_model_file` | Frontend → Rust | 原生对话框选择模型文件 |
| `local_ai_models_import_file` | Frontend → Rust | 触发文件导入（复制+hash+manifest+注册） |

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

`Import Artifact Manifest` 通过独立 picker 选取 `~/.nimi/models/**/artifact.manifest.json`。该 picker 不得复用主模型 `model.manifest.json` picker。

artifact import 的类型来源固定为 manifest 中的 `kind`，允许值由 runtime local service schema 约束为 `vae / llm / clip / controlnet / lora / auxiliary`。

### Companion Orphan Detect / Scaffold

Desktop 在 `Companion Assets` 区域内提供独立的 `Unregistered Companion Assets` lane。该 lane：

- 扫描 `~/.nimi/models/` 下未被 `model.manifest.json` 或 `artifact.manifest.json` 纳管的二进制模型文件
- 允许与主模型 orphan lane 同时展示同一裸文件；Desktop 不自动推断其用途
- 只让用户选择 `kind`，不暴露 engine 选择器
- scaffold 固定生成 `engine=localai` 的 `artifact.manifest.json`
- scaffold 完成后必须再调用 runtime local facade 的 `importLocalArtifact`

scaffold manifest 固定写入：

- `artifactId = local-import/<artifact-slug>`
- `kind =` 用户选定的 artifact kind
- `engine = localai`
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
