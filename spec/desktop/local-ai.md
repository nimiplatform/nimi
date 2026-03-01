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

## CI 门禁引用

本域涉及的 CI 门禁：`pnpm check:desktop-spec-kernel-consistency`（Check 1, 11, 13~14, 18~19 相关规则）。
