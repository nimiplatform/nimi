# sdk

SDK 已完成单包收敛：

- 物理包仅保留 `sdk`
- 对外仅发布 `@nimiplatform/sdk`
- 根入口 `@nimiplatform/sdk` 作为 app 级组合面
- 能力通过稳定子路径暴露：`@nimiplatform/sdk/*`

## Public Subpaths

- `@nimiplatform/sdk`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/types`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/mod`
- `@nimiplatform/sdk/mod/shell`
- `@nimiplatform/sdk/mod/lifecycle`
- `@nimiplatform/sdk/mod/storage`

## Guardrails

- 禁止 legacy 包导入（`sdk-realm/sdk-runtime/sdk-types/mod-sdk/ai-provider`）
- 禁止 `@nimiplatform/sdk/realm/core|models|services|generated` 深层导入
- 第一方 app/docs/examples 默认使用 `createPlatformClient()`，子路径仅在 low-level escape hatch 或 domain-specific 语境下直接使用
- `reasonCode` 必须使用 `ReasonCode` 常量
- TypeScript 统一 `strict + noImplicitAny`
