# Error Boundary Contract

> Authority: Desktop Kernel
> Status: Draft
> Date: 2026-03-01

## Scope

Desktop 错误边界契约。定义 bridge 错误归一化、错误码映射、用户可读消息转换、重试策略。

## D-ERR-001 — Local AI 错误码

本地 AI 模型管理相关错误（参考 `tables/error-codes.yaml`）：

- `LOCAL_AI_IMPORT_*`：导入路径、清单、哈希校验错误。
- `LOCAL_AI_MODEL_*`：模型不存在、哈希为空、能力无效。
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

## D-ERR-005 — Bridge 错误归一化

`toBridgeUserError(error)` 两阶段错误转换：

1. **精确码匹配**：`extractBridgeErrorCode` 提取 `CODE:` 前缀 → `BRIDGE_ERROR_CODE_MAP` 查表。
2. **模式匹配**：`BRIDGE_ERROR_MAP` 正则数组依次匹配错误消息。
3. **兜底**：返回通用 `'操作失败，请稍后重试'`。

## D-ERR-006 — Bootstrap 错误边界

`bootstrapRuntime()` 的 `.catch()` 处理：

- 设置 `bootstrapError = message`。
- 设置 `bootstrapReady = false`。
- 清除 auth session。
- 记录 `phase:bootstrap:failed` error 日志。
- 重新抛出错误。

## D-ERR-007 — Runtime ReasonCode 投影链

Runtime 错误通过三层投影到 Desktop UI：

**投影路径**：Runtime K-ERR ReasonCode → SDK S-ERROR 投影 → Desktop `toBridgeUserError` 映射。

**关键 ReasonCode UI 映射**：

| Runtime ReasonCode | SDK 投影 | Desktop UI 消息 |
|---|---|---|
| `AI_PROVIDER_TIMEOUT` | `S-ERROR-007` retryable | "AI 服务超时，请稍后重试" |
| `AI_PROVIDER_UNAVAILABLE` | `S-ERROR-007` retryable | "AI 服务暂时不可用" |
| `AI_STREAM_BROKEN` | `S-ERROR-004` 不自动重连 | "流式响应中断，请重新发送" |
| `AI_CONNECTOR_CREDENTIAL_MISSING` | `S-ERROR-001` 上游错误 | "缺少 AI 服务凭证，请检查配置" |
| `AI_CONNECTOR_DISABLED` | `S-ERROR-001` 上游错误 | "AI 连接器已禁用" |
| `AI_CONNECTOR_NOT_FOUND` | `S-ERROR-001` 上游错误 | "AI 连接器未找到" |
| `SESSION_EXPIRED` | `S-ERROR-007` retryable | "会话已过期，请重新登录" |
| `RUNTIME_UNAVAILABLE` | SDK 合成码 | "本地运行时不可用，请检查 daemon 状态" |
| `RUNTIME_BRIDGE_DAEMON_UNAVAILABLE` | SDK 合成码 | "无法连接到运行时服务" |

**兜底规则**：未映射的 ReasonCode 走 D-ERR-005 两阶段归一化兜底路径，最终返回通用错误消息。

**跨层引用**：Runtime `K-ERR-001~008`、SDK `S-ERROR-001~010`。

## Fact Sources

- `tables/error-codes.yaml` — Desktop 错误码
