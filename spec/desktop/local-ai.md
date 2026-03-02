# Local AI Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

本地 AI 功能域 — 本地模型管理（安装/导入/启动/停止/移除）、健康检查、推理审计、下载进度。

## Module Map

- `runtime/local-ai-runtime/` — Local AI runtime 管理
- `bridge/runtime-bridge/local-ai.ts` — Local AI IPC 桥接（懒加载）
- `features/runtime-config/` — Runtime 配置面板中的本地 AI 管理 UI

## Kernel References

### IPC (D-IPC-010, D-IPC-011)

Local AI 桥接通过 `loadLocalAiBridge()` 懒加载（`D-IPC-010`），命令清单见 `D-IPC-011`。

### LLM (D-LLM-004)

`checkLocalLlmHealth` — 验证本地引擎可用性。

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

Phase 1 所有模型生命周期写操作（搜索、下载、安装、删除）由 desktop execution-plane 独占。Runtime 仅消费已安装模型的元数据，不主动发起下载。

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

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18~19 相关规则）。
