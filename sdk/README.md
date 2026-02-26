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
- `@nimiplatform/sdk/mod/ai`
- `@nimiplatform/sdk/mod/hook`
- `@nimiplatform/sdk/mod/types`
- `@nimiplatform/sdk/mod/ui`
- `@nimiplatform/sdk/mod/logging`
- `@nimiplatform/sdk/mod/i18n`
- `@nimiplatform/sdk/mod/settings`
- `@nimiplatform/sdk/mod/utils`
- `@nimiplatform/sdk/mod/model-options`
- `@nimiplatform/sdk/mod/runtime-route`
- `@nimiplatform/sdk/mod/host`

## Guardrails

- 禁止 legacy 包导入（`sdk-realm/sdk-runtime/sdk-types/mod-sdk/ai-provider`）
- 禁止 `@nimiplatform/sdk/realm/core|models|services|generated` 深层导入
- `reasonCode` 必须使用 `ReasonCode` 常量
- TypeScript 统一 `strict + noImplicitAny`
