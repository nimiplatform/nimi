# Realm SDK Domain Spec

> Status: Draft
> Date: 2026-02-28
> Scope: `@nimiplatform/sdk/realm` 领域增量规则（实例化 facade、HTTP/WS 请求引擎、命名规范化）。
> Normative Imports: `spec/sdk/kernel/*`

## 0. 权威导入

- Surface：`kernel/surface-contract.md`（`S-SURFACE-*`）
- Transport：`kernel/transport-contract.md`（`S-TRANSPORT-*`）
- Error projection：`kernel/error-projection.md`（`S-ERROR-*`）
- Boundary：`kernel/boundary-contract.md`（`S-BOUNDARY-*`）

## 1. 领域不变量

- `SDKREALM-001`: 入口固定为 `new Realm(options)` 实例模式。
- `SDKREALM-002`: endpoint/token/header 必须实例级隔离，不允许全局 OpenAPI 运行态写入。
- `SDKREALM-003`: 生成 facade 是唯一权威调用面，禁止手工旁路契约。
- `SDKREALM-004`: 传输与边界规则必须满足 `S-TRANSPORT-004` / `S-BOUNDARY-004`。

## 2. 请求引擎（领域增量）

- `SDKREALM-010`: 默认超时、重试和 abort 语义由实例配置控制。
- `SDKREALM-011`: Header 合并遵循调用参数优先，不破坏实例默认安全头。

## 3. 错误语义（领域增量）

- `SDKREALM-020`: HTTP status 与 reasonCode 投影遵循 `S-ERROR-*`。
- `SDKREALM-021`: 401/403/429/5xx 语义不得伪装为成功响应。

## 4. 非目标

- 不定义 runtime gRPC 规则
- 不定义 scope/mod 领域规则
