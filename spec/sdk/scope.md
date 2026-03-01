# Scope SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/scope` 领域增量规则（catalog 生命周期与授权前置联动）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

## 1. 领域不变量

- `SDKSCOPE-001`: Scope catalog 以 in-memory 结构为基线。
- `SDKSCOPE-002`: `register/publish/revoke` 构成最小闭环，不引入并行状态机。
- `SDKSCOPE-003`: 与 runtime 授权调用的联动仅通过公开 runtime SDK 接口。
- `SDKSCOPE-004`: 子路径与边界规则必须满足 `S-SURFACE-001` / `S-BOUNDARY-001`。
- `SDKSCOPE-005`: 当前 Scope SDK 不定义 transport-level stream API；若未来引入订阅流，必须遵循 `S-TRANSPORT-003`。

## 2. 错误语义（领域增量）

- `SDKSCOPE-010`: 目录输入非法必须 fail-close（`SDK_SCOPE_CATALOG_INVALID`），错误码来源遵循 `S-ERROR-003`（SDK 本地错误码事实源）。
- `SDKSCOPE-011`: catalog 版本冲突必须显式报错（`SDK_SCOPE_CATALOG_VERSION_CONFLICT`），不做静默覆盖。

## 3. 非目标

- 不定义 realm/runtime/mod 的业务规则
- 不定义服务端授权策略语义
