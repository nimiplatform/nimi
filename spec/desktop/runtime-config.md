# Runtime Config Domain Spec

> Normative Imports: `spec/desktop/kernel/*`
> Status: Draft
> Date: 2026-03-01

## Scope

运行时配置功能域 — AI Runtime Tab、provider 选择、model 绑定、daemon 管理、本地引擎状态。

## Module Map

- `features/runtime-config/` — Runtime 配置面板
- `runtime/data-sync/facade.ts` — resolveChatRoute

## Kernel References

### State (D-STATE-002)

Runtime 字段映射（`RuntimeFieldMap`）：
- `provider`：AI provider 选择
- `runtimeModelType`：模型能力类型（chat/image/video/tts/stt/embedding）
- `localProviderEndpoint` / `localProviderModel` / `localOpenAiEndpoint`：本地引擎绑定
- `connectorId`：connector 引用（K-KEYSRC-001 managed 路径）
- `targetType` / `targetAccountId` / `agentId` / `worldId`：执行目标
- `mode`：对话模式（STORY / SCENE_TURN）

### IPC (D-IPC-002)

Daemon 管理命令（命令清单见 `D-IPC-002`）。

### IPC (D-IPC-003)

配置读写命令（命令清单见 `D-IPC-003`）。

### Shell (D-SHELL-001)

Runtime Tab 受 `enableRuntimeTab` feature flag 门控。

### LLM (D-LLM-001)

Provider 适配层：`provider` 字段确定执行路径（remote token API / local runtime）。

### LLM (D-LLM-002)

路由策略：通过 `resolveChatRoute` 确定目标 agent 和 provider。

### LLM (D-LLM-003)

Connector 凭据路由：AI 请求凭据通过 `connector_id` 路由（K-KEYSRC-001 managed 路径），安全策略由 `D-SEC-009` 定义。

### LLM (D-LLM-004)

本地 LLM 健康检查：`checkLocalLlmHealth` 验证本地引擎可用性。

### Security (D-SEC-001)

本地端点回环限制：仅允许 `localhost`、`127.0.0.1`、`[::1]`。

### Error (D-ERR-002)

端点校验错误码：`LOCAL_AI_ENDPOINT_NOT_LOOPBACK`、`LOCAL_AI_ENDPOINT_INVALID`。

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18 相关规则）。
