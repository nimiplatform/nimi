# Runtime SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/runtime` 的领域增量规则（构造、模块编排、与 runtime kernel 的投影关系）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

同时引用 runtime kernel（仅引用，不复述）：

- `spec/runtime/kernel/rpc-surface.md`
- `spec/runtime/kernel/key-source-routing.md`
- `spec/runtime/kernel/error-model.md`
- `spec/runtime/kernel/streaming-contract.md`

## 1. 领域不变量

- `SDKR-001`: Runtime SDK 入口固定为 `new Runtime(options)`。
- `SDKR-002`: transport 必须显式声明 `node-grpc | tauri-ipc`。
- `SDKR-003`: 运行时推理方法以 runtime kernel 的 AIService/ConnectorService 投影为权威，不再在本文件重复列全量方法正文。
- `SDKR-004`: 不暴露 token-provider legacy 对外接口名。

## 2. 初始化与连接管理（领域增量）

- `SDKR-010`: `appId` 为空必须 fail-close。
- `SDKR-011`: `node-grpc` 缺 endpoint 必须 fail-close。
- `SDKR-012`: `auto`/`manual` 连接模式只影响连接触发时机，不改变 RPC 语义。

## 3. Runtime 模块编排（领域增量）

- `SDKR-020`: 高阶模块（ai/media/workflow/auth/grant/localRuntime）只做输入归一化与错误投影，不复制 runtime 规则定义。
- `SDKR-021`: 方法分组与投影表以 `kernel/tables/runtime-method-groups.yaml` 为权威。
- `SDKR-022`: runtime 规则冲突时，以 `spec/runtime/kernel/*` 为准。

## 4. Metadata 与凭据传递（领域增量）

- `SDKR-030`: credential 分离语义遵循 `S-TRANSPORT-002` 与 runtime `K-KEYSRC-*`。
- `SDKR-031`: Connector 管理 RPC 的 `app_id` 仅通过 metadata 传递。

## 5. 错误与重试（领域增量）

- `SDKR-040`: SDK 本地错误码来源于 `kernel/tables/sdk-error-codes.yaml`。
- `SDKR-041`: Runtime ReasonCode 直接投影，不在 SDK domain 中重新定义枚举值。

## 6. 非目标

- 不定义 runtime proto 全量方法细节（见 runtime kernel）
- 不定义 provider 业务语义（见 runtime domain 与 runtime kernel）
- 不定义 realm/mod/scope 领域规则
