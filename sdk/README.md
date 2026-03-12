# sdk

SDK 已完成单包收敛：

- 物理包仅保留 `sdk`
- 对外仅发布 `@nimiplatform/sdk`
- 能力通过稳定子路径暴露：`@nimiplatform/sdk/*`

## Public Subpaths

- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/types`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/mod`
- `@nimiplatform/sdk/mod/shell`
- `@nimiplatform/sdk/mod/lifecycle`

## Guardrails

- 禁止 legacy 包导入（`sdk-realm/sdk-runtime/sdk-types/mod-sdk/ai-provider`）
- 禁止 `@nimiplatform/sdk/realm/core|models|services|generated` 深层导入
- `reasonCode` 必须使用 `ReasonCode` 常量
- TypeScript 统一 `strict + noImplicitAny`
