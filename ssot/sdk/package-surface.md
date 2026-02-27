---
title: Nimi SDK Package Surface Contract
status: ACTIVE
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - 对外导入面仅允许 `@nimiplatform/sdk` 及稳定子路径。
  - `createNimiClient` 视为已删除 legacy 入口，禁止恢复。
  - 禁止发布或导入 `internal/*`、`generated/*` 私有路径。
  - 子路径是 SDK 的稳定语义边界，不得跨边界泄漏私有实现。
---

# SDK 包导出面合同

## 1. 当前导出清单（事实）

来源：`sdk/package.json#exports`。

| 子路径 | 角色 |
|---|---|
| `@nimiplatform/sdk` | 聚合入口，导出 Runtime + Realm + runtime + realm + scope + types |
| `@nimiplatform/sdk/realm` | realm HTTP client facade（生成代码外包一层规范命名） |
| `@nimiplatform/sdk/runtime` | runtime gRPC/IPC 客户端与协议类型 |
| `@nimiplatform/sdk/types` | 跨域共享类型与 `ReasonCode` |
| `@nimiplatform/sdk/scope` | scope catalog 管理能力 |
| `@nimiplatform/sdk/ai-provider` | AI SDK Provider v6 映射层 |
| `@nimiplatform/sdk/mod/*` | mod 运行时接入能力集合 |

## 2. 聚合入口语义

`sdk/src/index.ts` 当前导出：

1. `realm` 全量导出（含 `Realm`）
2. `runtime` 全量导出（含 `Runtime`）
3. `scope` 全量导出
4. `types` 全量导出

约束：聚合入口与子路径导出语义必须一致，不允许同名能力出现行为差异。

## 3. 导入边界规则

允许：

1. `@nimiplatform/sdk`
2. `@nimiplatform/sdk/<stable-subpath>`

禁止：

1. `@nimiplatform/sdk/internal/*`
2. `@nimiplatform/sdk/generated/*`
3. `@nimiplatform/sdk/realm/core|models|services|generated/*`

## 4. 命名与发布约束

1. SDK 仅保留 `@nimiplatform/sdk` 单包，不允许恢复 legacy split 包。
2. realm 公开符号命名要求“规范名优先”（例如 `MeTwoFactor*`）。
3. 对外 reason code 使用 `ReasonCode` 常量，不使用字面量字符串。
4. 禁止全局 `OpenAPI` 单例配置路径（含 BASE/TOKEN 赋值与 singleton import）。

## 5. 验收门禁

1. `pnpm check:sdk-single-package-layout`
2. `pnpm check:sdk-import-boundary`
3. `pnpm check:sdk-public-naming`
4. `pnpm check:sdk-consumer-smoke`
5. `pnpm check:sdk-version-matrix`
6. `pnpm check:no-create-nimi-client`
7. `pnpm check:no-global-openapi-config`
8. `pnpm check:no-openapi-singleton-import`
