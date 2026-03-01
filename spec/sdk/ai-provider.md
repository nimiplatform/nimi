# AI Provider SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/ai-provider` 领域增量规则（AI SDK v3 适配与 runtime 调用映射）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

依赖 runtime kernel：

- `spec/runtime/kernel/rpc-surface.md`
- `spec/runtime/kernel/media-job-lifecycle.md`
- `spec/runtime/kernel/streaming-contract.md`
- `spec/runtime/kernel/error-model.md`

## 1. 领域不变量

- `SDKAIP-001`: ai-provider 是协议适配层，不是路由决策层。
- `SDKAIP-002`: 模型类型映射（text/embedding/image/video/tts/stt）只做协议转换，不做静默降级。
- `SDKAIP-003`: 流中断后不自动重连，调用方必须显式重试（`S-TRANSPORT-003`）。
- `SDKAIP-004`: 对外子路径与方法投影必须满足 `S-SURFACE-001` / `S-SURFACE-002` / `S-SURFACE-003`。
- `SDKAIP-005`: ai-provider 不得旁路 runtime transport；metadata/body 分离与流式中断语义必须继承 `S-TRANSPORT-002` / `S-TRANSPORT-003`。导入边界遵循 `S-BOUNDARY-001`（子路径导入边界）。

## 2. 入口与配置（领域增量）

- `SDKAIP-010`: `runtime` 实例、`appId`、`subjectUserId` 缺失必须 fail-close（分别使用 `SDK_AI_PROVIDER_RUNTIME_REQUIRED` / `SDK_APP_ID_REQUIRED` / `SDK_AI_PROVIDER_SUBJECT_USER_ID_REQUIRED`）。
- `SDKAIP-011`: routePolicy/fallback 必须显式投影到 runtime 请求，不允许隐藏默认策略覆盖。
- `SDKAIP-012`: Provider 能力（inline 支持、endpoint 要求、runtime_plane）由 runtime 侧强制执行（`K-KEYSRC-009`、`provider-capabilities.yaml`）。SDK 不复制能力表。约束违反表现为标准 ReasonCode（`AI_REQUEST_CREDENTIAL_MISSING`、`AI_PROVIDER_ENDPOINT_FORBIDDEN` 等）。

## 3. MediaJob 适配（领域增量）

- `SDKAIP-020`: image/video/tts/stt 的异步交付语义遵循 runtime `K-JOB-001`（状态机）、`K-JOB-002`（终态判定）、`K-JOB-003`（幂等 key）。
- `SDKAIP-021`: 幂等冲突与取消语义遵循 runtime `K-ERR-007`（幂等冲突码）、`K-ERR-001`（双层模型）与 `K-JOB-001`（状态机）。

## 4. 错误投影（领域增量）

- `SDKAIP-030`: Runtime ReasonCode 直接投影；SDK 本地错误码只使用 sdk kernel 表（`S-ERROR-003`）。
- `SDKAIP-031`: provider metadata 仅承载可观测信息，不承载明文凭据。
- `SDKAIP-032`: 应用层可重试 ReasonCode 语义遵循 `S-ERROR-007`；ai-provider 层调用方可使用 `isRetryableReasonCode()` 判定是否显式重试。

## 5. 非目标

- 不重定义 runtime provider 业务规则
- 不重定义 runtime stream/media 状态机
