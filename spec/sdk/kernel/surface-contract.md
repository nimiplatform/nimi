# SDK Surface Contract

> Owner Domain: `S-SURFACE-*`

## S-SURFACE-001 SDK 子路径集合

公开 SDK 子路径固定为：

- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/mod`

## S-SURFACE-002 Runtime SDK 对外方法投影

Runtime SDK 对 `RuntimeAiService` 的对外方法投影采用 design 名称，方法集合必须与 `spec/runtime/kernel/tables/rpc-methods.yaml` 的 `AIService` 对齐。

## S-SURFACE-003 Runtime SDK 禁用旧接口名

SDK 对外契约层禁止出现以下旧接口名：

- `listTokenProviderModels`
- `checkTokenProviderHealth`
- `TokenProvider*`

## S-SURFACE-004 Realm/Scope/Mod 稳定导出面

- Realm SDK 以实例化 facade 为唯一入口，不允许全局单例配置入口。
- Scope SDK 以 in-memory catalog + publish/revoke 语义为最小稳定面。
- Mod SDK 以 host 注入 facade + hook 客户端为最小稳定面。
