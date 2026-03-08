# SDK Surface Contract

> Owner Domain: `S-SURFACE-*`

## S-SURFACE-001 SDK 子路径集合

公开 SDK 子路径固定为：

- `@nimiplatform/sdk/runtime`
- `@nimiplatform/sdk/ai-provider`
- `@nimiplatform/sdk/realm`
- `@nimiplatform/sdk/scope`
- `@nimiplatform/sdk/mod`
- `@nimiplatform/sdk/types`

SDK 必须维持单一 package layout；公开子路径只允许在 `@nimiplatform/sdk` 包内投影，不得漂移为多 package 或多根布局。

执行命令：

- `pnpm check:sdk-single-package-layout`

## S-SURFACE-002 Runtime SDK 对外方法投影

Runtime SDK 对外方法投影按服务分组，方法集合必须与 `spec/runtime/kernel/tables/rpc-methods.yaml` 对应服务对齐，采用 design 名称。服务完整列表与方法集合以 `tables/runtime-method-groups.yaml` 为唯一事实源（S-SURFACE-009），每个 group 独立追踪对齐状态与 phase。

## S-SURFACE-003 Runtime SDK 禁用旧接口名

SDK 对外契约层禁止出现以下旧接口名：

- `listTokenProviderModels`
- `checkTokenProviderHealth`
- `TokenProvider*`

## S-SURFACE-004 Realm/Scope/Mod 稳定导出面

- Realm SDK 以实例化 facade 为唯一入口，不允许全局配置入口。
- Scope SDK 以 in-memory catalog + publish/revoke 语义为最小稳定面。
- Mod SDK 以 host 注入 facade + hook 客户端为最小稳定面。

## S-SURFACE-005 Realm 公开命名去 Legacy

Realm SDK 公开符号（类型名、service 名、公开方法名、property-enum 键名）必须使用规范命名，禁止暴露 legacy 命名。

- 禁止：`*2fa*` / `*2Fa*` / `*2FA*`、`Me2FaService`、`SocialV1DefaultVisibilityService`、`SocialFourDimensionalAttributesService` 等旧命名。
- 允许保留协议字面量（wire literal）用于与服务端契约对齐，例如路径 `/api/auth/2fa/*`、schema key `Auth2faVerifyDto`、枚举值 `needs_2fa`。
- 命名归一化必须在 codegen 层完成，不允许在公开 facade 层依赖 legacy → new alias 桥接。

执行命令：

- `pnpm check:sdk-realm-legacy-clean`

## S-SURFACE-009 Runtime 方法投影表治理

`tables/runtime-method-groups.yaml` 是 SDK 对外方法投影的结构化事实源，采用”显式维护 + 一致性校验”模式：

- 显式维护：表内只列当前 SDK 对外投影集合，不要求机械等于 runtime kernel 全量 proto 面。
- 一致性校验：每个 group 必须声明对应 runtime service，且方法名必须在 `spec/runtime/kernel/tables/rpc-methods.yaml` 中可解析；校验脚本负责阻断漂移。
