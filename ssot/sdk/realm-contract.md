---
title: Nimi SDK Realm Subpath Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - `@nimiplatform/sdk/realm` 只暴露 facade，不允许调用方依赖 generated 深层路径。
  - realm 公开命名必须走规范化 alias，禁止 legacy 命名泄漏。
  - realm facade 由脚本生成，禁止手工修改生成区。
---

# realm 子路径合同

## 1. 结构与来源

来源：`sdk/src/realm/index.ts`。

特点：

1. 文件由 `scripts/generate-realm-sdk.mjs` 生成。
2. 对外 re-export `generated/core/models/services`，并附加命名规范 alias。
3. `openApiRequest` 作为底层请求能力公开入口。

## 2. OpenAPI 全局配置

公开对象：`OpenAPI`。

常见用法：由 `createNimiClient` 写入：

1. `OpenAPI.BASE`
2. `OpenAPI.TOKEN`

说明：这是全局单例配置，属于 realm facade 当前实现。

## 3. 公共命名规范

必须公开的规范名：

1. `MeTwoFactorService`
2. `AuthTwoFactorVerifyInput`
3. `MeTwoFactorVerifyInput`
4. `MeTwoFactorPrepareOutput`
5. `SocialDefaultVisibilityService`
6. `SocialAttributesService`

不得公开 legacy 命名：

1. `Me2FaService`
2. `Auth2faVerifyDto`
3. `Me2faVerifyDto`
4. `Me2faPrepareResponseDto`
5. `SocialV1DefaultVisibilityService`
6. `SocialFourDimensionalAttributesService`

## 4. 导入边界

允许：`@nimiplatform/sdk/realm`

禁止：`@nimiplatform/sdk/realm/core|models|services|generated/*`

## 5. 验收门禁

1. `sdk/test/realm/realm-facade-naming.test.ts`
2. `pnpm check:sdk-public-naming`
3. `pnpm generate:realm-sdk`（变更后重生）
