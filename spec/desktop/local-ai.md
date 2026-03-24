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

## 阅读路径

### Runtime 获取与 recommendation（K-LOCAL-021~028）

- 搜索排序、候选 feed、HuggingFace 获取、下载管线、存储布局、manifest schema、格式支持与 Desktop 获取所有权全部以 `spec/runtime/kernel/local-category-capability.md` 为准。
- 先读 `spec/runtime/local-model.md`，再按需跳到 `K-LOCAL-021~028` 对应章节；本 domain 文档只保留 Desktop 投影入口，不复述 runtime 规则正文。

### Desktop bridge 投影（D-IPC-010, D-IPC-011）

- Desktop renderer 通过 `runtime_local_*` bridge surface 消费本地模型、artifact、profile、device profile 与 recommendation feed。
- 命令名、事件名与执行边界以 `spec/desktop/kernel/bridge-ipc-contract.md` 为准；本域只关心这些 surface 被 Runtime Config / local-ai UI 消费。

### Desktop UI 关注点

- Runtime Config `recommend` page、catalog、variant picker、install-plan preview、installed detail 共享同一 recommendation payload；具体字段定义回指 Runtime `K-LOCAL-021a~021e`。
- profile-centric install UX、artifact intake、file import 与 download progress 都通过 Desktop host bridge 承载，不绕经 runtime SDK 私有执行路径。
- 离线/降级行为遵循 `D-OFFLINE-001~005`；Realm 离线不阻断本地模型管理，Runtime 不可达时 local runtime commands fail-close。

## 关键 Surface Map

| Surface Group | Authority | Notes |
|---|---|---|
| catalog / variants / install plan / recommendation feed | `spec/runtime/kernel/local-category-capability.md` + `spec/desktop/kernel/bridge-ipc-contract.md` | recommendation 字段、排序与 feed 语义由 Runtime kernel 定义，Desktop 只消费 |
| model file import / artifact import / orphan intake | `spec/desktop/kernel/bridge-ipc-contract.md` | Desktop Tauri host 负责 picker、progress event、import/adopt/scaffold surface |
| error families | `spec/desktop/kernel/tables/error-codes.yaml` | 本域引用 `LOCAL_AI_IMPORT_*`、`LOCAL_AI_MODEL_*`、`LOCAL_AI_ENDPOINT_*`、`LOCAL_AI_SPEECH_*`、`LOCAL_AI_HF_DOWNLOAD_*`、`LOCAL_AI_FILE_IMPORT_*` |

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18~19 相关规则）。

## Offline / Degradation

当 Realm 或 Runtime 不可达时，本域的可用性降级遵循 `kernel/offline-degradation-contract.md`（D-OFFLINE-001~005）。Local AI 相关命令只在 Runtime 可达时可执行；Realm 离线不阻断本地模型管理。
