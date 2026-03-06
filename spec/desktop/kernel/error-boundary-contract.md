# Error Boundary Contract

> Authority: Desktop Kernel

## Scope

Desktop 错误边界契约。定义 bridge 错误归一化、错误码映射、用户可读消息转换、重试策略。

## D-ERR-001 — Local AI 错误码

本地 AI 模型管理相关错误（参考 `tables/error-codes.yaml`）：

- `LOCAL_AI_IMPORT_*`：导入路径、清单、哈希校验错误。
- `LOCAL_AI_MODEL_*`：模型不存在、哈希为空、能力无效。
- `LOCAL_AI_HF_DOWNLOAD_*`：下载中断/暂停/取消、磁盘不足、不可恢复失败。
- 所有错误通过 `BRIDGE_ERROR_CODE_MAP` 映射为中文用户消息。

## D-ERR-002 — Endpoint 安全错误码

- `LOCAL_AI_ENDPOINT_NOT_LOOPBACK`：端点非回环地址。
- `LOCAL_AI_ENDPOINT_INVALID`：端点格式无效。

安全要求：本地运行时端点仅支持 `localhost` / `127.0.0.1` / `[::1]`。

## D-ERR-003 — Qwen TTS 环境错误码

Qwen TTS 引擎依赖检查错误：

- `LOCAL_AI_QWEN_GPU_REQUIRED`：无可用 NVIDIA GPU。
- `LOCAL_AI_QWEN_PYTHON_REQUIRED`：缺少 Python 3.10+。
- `LOCAL_AI_QWEN_PYTHON_VERSION_UNSUPPORTED`：Python 版本过低。
- `LOCAL_AI_QWEN_BOOTSTRAP_FAILED`：运行时依赖安装失败。

## D-ERR-004 — Runtime 路由错误码

- `LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED`：source type 无权执行生命周期写操作。
- `RUNTIME_ROUTE_CAPABILITY_MISMATCH`：路由绑定的模型能力不匹配。

## D-ERR-012 — HuggingFace 下载错误动作提示

下载会话控制与容错错误必须映射为明确动作提示：

| ReasonCode | 用户提示 | 后续动作 |
|---|---|---|
| `LOCAL_AI_HF_DOWNLOAD_DISK_FULL` | "磁盘空间不足，请释放空间后继续下载" | 保留 partial，用户清理空间后 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_INTERRUPTED` | "下载已中断，重启后请手动恢复任务" | 会话保留 `paused`，用户手动 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_PAUSED` | "下载已暂停，可稍后继续" | 保留 partial，用户手动 `resume` |
| `LOCAL_AI_HF_DOWNLOAD_CANCELLED` | "下载已取消" | 清理 staging，需重新安装 |
| `LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH` | "模型文件校验失败，请重新下载" | 清理 staging，禁止 `resume`，需重新安装 |
| `LOCAL_AI_HF_DOWNLOAD_NOT_RESUMABLE` | "当前下载会话不可恢复，请重新安装模型" | 明确阻断 `resume`，引导重新安装 |

## D-ERR-005 — Bridge 错误归一化

`toBridgeUserError(error)` 作为 `toBridgeNimiError(error)` 的别名，必须抛出结构化 `NimiError`，并遵循固定优先级：

1. 输入已是 `NimiError`：保持结构化字段不变。
2. 可解析 JSON payload：提取 `reasonCode/actionHint/traceId/retryable/message`。
3. `CODE:` 前缀：提取前缀作为 `reasonCode`。
4. 正则模式映射：仅用于用户展示文案推断。
5. 兜底：`RUNTIME_CALL_FAILED`。

显示层规则：

- 中文提示仅写入 `details.userMessage`。
- `message` 与 `reasonCode` 必须保留上游原值，不可被 UI 文案覆盖。
- `details.rawMessage` 必须保留原始失败文本，便于排障。

## D-ERR-006 — Bootstrap 错误边界

`bootstrapRuntime()` 的 `.catch()` 处理：

- 设置 `bootstrapError = message`。
- 设置 `bootstrapReady = false`。
- 清除 auth session。
- 记录 `phase:bootstrap:failed` error 日志。
- 重新抛出错误。

## D-ERR-007 — Runtime ReasonCode 投影链

Runtime 错误通过三层投影到 Desktop UI：

**投影路径**：Runtime K-ERR ReasonCode → SDK S-ERROR 投影 → Desktop `toBridgeNimiError` 映射（`toBridgeUserError` 仅保留兼容别名）。

**关键 ReasonCode UI 映射**：

| Runtime ReasonCode | SDK 投影 | Desktop UI 消息 |
|---|---|---|
| `AI_PROVIDER_TIMEOUT` | `S-ERROR-007` retryable | "AI 服务超时，请稍后重试" |
| `AI_PROVIDER_UNAVAILABLE` | `S-ERROR-007` retryable | 上下文感知映射（见下文 D-ERR-007a） |
| `AI_PROVIDER_RATE_LIMITED` | `S-ERROR-007` retryable | "AI 服务繁忙，请稍后重试" |
| `AI_PROVIDER_INTERNAL` | `S-ERROR-001` 上游错误 | "AI 服务内部错误，请稍后重试" |
| `AI_PROVIDER_ENDPOINT_FORBIDDEN` | `S-ERROR-001` 上游错误 | "AI 服务端点被安全策略拒绝" |
| `AI_STREAM_BROKEN` | `S-ERROR-004` 不自动重连 | "流式响应中断，请重新发送" |
| `AI_CONNECTOR_CREDENTIAL_MISSING` | `S-ERROR-001` 上游错误 | "缺少 AI 服务凭证，请检查配置" |
| `AI_CONNECTOR_DISABLED` | `S-ERROR-001` 上游错误 | "AI 连接器已禁用" |
| `AI_CONNECTOR_NOT_FOUND` | `S-ERROR-001` 上游错误 | "AI 连接器未找到" |
| `AI_MODEL_NOT_FOUND` | `S-ERROR-001` 上游错误 | "AI 模型未找到，请检查模型配置" |
| `AI_MODALITY_NOT_SUPPORTED` | `S-ERROR-001` 上游错误 | "当前模型不支持此功能类型" |
| `AI_LOCAL_MODEL_UNAVAILABLE` | `S-ERROR-001` 上游错误 | "本地模型未运行，请先启动模型" |
| `AI_FINISH_LENGTH` | gRPC OK（非错误） | 消息气泡底部标注"输出已达最大长度"（非 toast，不阻断交互） |
| `AI_FINISH_CONTENT_FILTER` | gRPC OK（非错误） | 消息气泡底部标注"内容因安全策略被截断"（非 toast，不阻断交互） |
| `AI_MEDIA_IDEMPOTENCY_CONFLICT` | `S-ERROR-001` 上游错误 | "请求重复，请勿重复提交"（K-ERR-007 **强制显式处理**，不允许走通用兜底） |
| `AI_MEDIA_JOB_NOT_FOUND` | `S-ERROR-001` 上游错误 | "媒体任务未找到" |
| `AI_PROVIDER_AUTH_FAILED` | `S-ERROR-001` 上游错误 | "AI 服务凭证已失效，请重新配置" |
| `AI_MODEL_PROVIDER_MISMATCH` | `S-ERROR-001` 上游错误 | "模型与引擎类型不匹配，请检查模型配置" |
| `AI_MEDIA_SPEC_INVALID` | `S-ERROR-001` 上游错误 | "媒体生成参数无效，请检查输入" |
| `AI_MEDIA_OPTION_UNSUPPORTED` | `S-ERROR-001` 上游错误 | "当前不支持此媒体生成选项" |
| `AI_MEDIA_JOB_NOT_CANCELLABLE` | `S-ERROR-001` 上游错误 | "任务已完成，无法取消" |
| `AI_LOCAL_MODEL_PROFILE_MISSING` | `S-ERROR-001` 上游错误 | "本地模型缺少推理配置文件" |
| `AI_LOCAL_MODEL_ALREADY_INSTALLED` | `S-ERROR-001` 上游错误 | "模型已安装，无需重复安装" |
| `AI_LOCAL_ENDPOINT_REQUIRED` | `S-ERROR-001` 上游错误 | "本地引擎需要配置端点地址" |
| `AI_LOCAL_TEMPLATE_NOT_FOUND` | `S-ERROR-001` 上游错误 | "模型模板未找到" |
| `AI_LOCAL_MANIFEST_INVALID` | `S-ERROR-001` 上游错误 | "模型清单格式无效，请检查文件" |
| `AI_CONNECTOR_INVALID` | `S-ERROR-001` 上游错误 | "连接器配置无效，请检查输入" |
| `AI_CONNECTOR_IMMUTABLE` | `S-ERROR-001` 上游错误 | "该连接器字段不可修改" |
| `AI_CONNECTOR_LIMIT_EXCEEDED` | `S-ERROR-001` 上游错误 | "连接器数量已达上限" |
| `AUTH_TOKEN_INVALID` | `S-ERROR-001` 上游错误（**不可重试**） | "认证令牌无效，请重新登录" |
| `SESSION_EXPIRED` | `S-ERROR-007` retryable | "会话已过期，请重新登录" |
| `APP_MODE_DOMAIN_FORBIDDEN` | `S-ERROR-001` 上游错误（**不可重试**） | "应用权限不足，请检查应用模式配置" |
| `APP_MODE_SCOPE_FORBIDDEN` | `S-ERROR-001` 上游错误（**不可重试**） | "应用权限不足，请检查应用模式配置" |
| `APP_MODE_MANIFEST_INVALID` | `S-ERROR-001` 上游错误（**不可重试**） | "应用模式配置无效" |
| `RUNTIME_UNAVAILABLE` | SDK 合成码 | "本地运行时不可用，请检查 daemon 状态" |
| `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE` | SDK 合成码 | "无法连接到运行时服务" |

**D-ERR-007a `AI_PROVIDER_UNAVAILABLE` 上下文感知映射**：

Runtime K-PROV-003a 指出 provider 健康探测将 `401`/`403` 视为 healthy（server 可达）。因此 provider 显示 healthy 但 consume 持续返回 `AI_PROVIDER_UNAVAILABLE` 时，根因是凭据问题而非网络问题。Desktop 应结合 provider 健康状态（D-IPC-002 可获取）差异化引导用户：

| Provider 健康状态 | UI 消息 | 引导方向 |
|---|---|---|
| `healthy` | "AI 服务凭证可能已失效，请检查 API key 配置" | 凭据配置诊断 |
| `unhealthy` 或 `unknown` | "AI 服务暂时不可用" | 网络连通性诊断 |
| Phase 1 简化（provider 健康细粒度不可用时） | "AI 服务暂时不可用"（通用兜底） | — |

Phase 1 provider 健康细粒度展示为 Phase 2（D-IPC-002），因此 Phase 1 使用通用兜底消息。Phase 2 实现 provider 级健康指示器后，必须启用上下文感知映射。

注：`ListConnectorModels` 失败也复用此 ReasonCode（K-ERR-005），此场景无 provider 健康上下文，走通用兜底。

**跨层引用**：K-PROV-003a（健康探测设计取舍）、D-IPC-002（provider 健康 UI 映射）。

**非错误终态说明**：`AI_FINISH_LENGTH` 和 `AI_FINISH_CONTENT_FILTER` 通过 gRPC OK + `reason_code` 返回（参考 SDK S-ERROR-009），投影为 `finishReason` 而非异常。UI 不触发错误边界（D-ERR-006），仅在消息元信息区域展示提示标注。

**兜底规则**：未映射的 ReasonCode 走 D-ERR-005 多阶段归一化兜底路径，最终返回通用错误消息。

**未覆盖 ReasonCode 族群声明**：以下 ReasonCode 族群当前走通用兜底路径（"操作失败，请稍后重试"），对用户无诊断价值。Phase 2 服务消费契约就绪时应补充专用映射：

| ReasonCode 族群 | Runtime 来源 | 补充映射优先级 | 推荐消息方向 |
|---|---|---|---|
| `GRANT_*` 族 | K-GRANT-013 | 中（Phase 2 Grant UI 启动时） | 按具体 GRANT 错误分别映射 |
| `PAGE_TOKEN_INVALID` | K-PAGE-002 | 低（分页错误罕见） | "分页参数无效，请刷新重试" |
| `WORKFLOW_*` 族 | Phase 2 | 中（Workflow UI 启动时） | 待 K-WF-012 消费契约定义 |
| `APP_MESSAGE_*` 族 | K-APP-005 | 中（AppMessage UI 启动时） | 待 K-APP-006a 消费契约定义 |
| `SCRIPT_*` 族 | K-SCRIPT-004 | 低（Phase 2 后期） | 待 ScriptWorker 消费契约定义 |

**映射治理规则**：

- 当 `spec/runtime/kernel/tables/reason-codes.yaml` 新增 ReasonCode 且 `surface` 包含 `consume` 或 `connector` 时，必须评估是否需要添加 D-ERR-007 映射条目。
- 评估标准：该 ReasonCode 是否可能在 Desktop 用户操作流中触达。可通过 UI 触达的码必须添加中文映射；仅内部使用的码（如 management RPC 专用码）可跳过。
- 此评估应作为 reason-codes.yaml 变更 PR 的 review checklist 项。

**跨层引用**：Runtime `K-ERR-001~010`、SDK `S-ERROR-001~014`。

## D-ERR-008 — 本地模型生命周期 NOT_FOUND 映射

Runtime K-ERR-008 规定 `StartLocalModel`、`StopLocalModel`、`RemoveLocalModel` 对不存在的 `local_model_id` 返回 `NOT_FOUND`。Desktop D-IPC-011 调用这些命令时需处理此错误。

**映射规则**：

| IPC 命令 | gRPC 状态 | UI 行为 |
|---|---|---|
| `local_ai_start_model` | `NOT_FOUND` | toast "模型未找到，可能已被移除"，刷新模型列表 |
| `local_ai_stop_model` | `NOT_FOUND` | 静默处理（模型已不存在等价于已停止），刷新模型列表 |
| `local_ai_remove_model` | `NOT_FOUND` | 静默处理（幂等语义），刷新模型列表 |

**跨层引用**：Runtime K-ERR-008、K-LOCAL-009。

## D-ERR-009 — runtime-config Fail-Fast 约束

runtime-config 关键链路（connector discovery、provider/model 列表、route capabilities）必须 Fail-Fast：

- 禁止静默吞错：不允许 `.catch(() => [])`、`.catch(() => {})`、空 `catch {}`
- 失败必须抛 `NimiError`，UI 必须显示错误 banner
- banner 至少包含 `reasonCode` 与 `traceId`（若存在）
- 不允许以本地目录（`VENDOR_CATALOGS_V11`）作为 runtime 不可用时的模型事实源回退

Runtime 不可用时，用户操作必须显式失败，不允许伪成功。

## D-ERR-010 — Desktop Runtime Invoke Bridge 主码规则

Desktop runtime invoke bridge（保留中的 `invoke-text` 私有 kernel turn 入口，以及 `runtime-bootstrap-host-capabilities.ts` 注册的 mod/runtime host 能力桥）错误处理必须遵循：

- 统一抛出 `NimiError`，禁止 `throw new Error(normalizedError)` 降维
- 主判定码使用 Runtime `reasonCode`
- `LOCAL_AI_*` 仅作为诊断别名记录在审计字段 `extra.localReasonCode`，不参与主流程分支
- 每次 runtime 调用 metadata 必须携带 `traceId`，保证 renderer 日志、runtime 审计与异常对象可对齐

## D-ERR-011 — Bridge 日志可观测字段

Bridge invoke 失败日志必须输出结构化诊断字段：

- `reasonCode`
- `actionHint`
- `traceId`
- `retryable`
- `rawMessage`

## Fact Sources

- `tables/error-codes.yaml` — Desktop 错误码
