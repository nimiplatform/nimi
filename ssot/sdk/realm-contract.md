---
title: Nimi SDK Realm Subpath Contract
status: ACTIVE
updated_at: 2026-02-27
parent: INDEX.md
rules:
  - `@nimiplatform/sdk/realm` 只暴露 facade，不允许调用方依赖 generated 深层路径。
  - realm 公开命名必须走规范化 alias，禁止 legacy 命名泄漏。
  - realm facade 由脚本生成，禁止手工修改生成区。
  - Realm 配置必须实例隔离，禁止写入或依赖全局 `OpenAPI` 单例状态。
  - HTTP 默认错误映射固定为 `404/409/429 -> REALM_NOT_FOUND/REALM_CONFLICT/REALM_RATE_LIMITED`（无服务端 reasonCode 时）。
---

# realm 子路径合同

## 1. 结构与来源

来源：`sdk/src/realm/index.ts`。

特点：

1. 文件由 `scripts/generate-realm-sdk.mjs` 生成。
2. 对外暴露 `Realm` class、稳定 facade、命名规范 alias、`client-types` 与 `property-enums`。
3. 底层请求能力仅通过 `new Realm(...).raw.request(...)` 暴露。

## 2. Realm 实例配置

主入口：`new Realm({ baseUrl, auth, headers, timeoutMs })`。

约束：

1. 每个 Realm 实例必须持有独立配置。
2. 调用不得依赖或写入全局 `OpenAPI` 单例状态。
3. `services` facade 必须把实例配置透传到 generated service 请求层。

## 3. 错误与取消语义

来源：`sdk/src/realm/client.ts`。

### 3.1 默认 HTTP 映射（无 reasonCode）

1. `401/403 -> AUTH_DENIED`
2. `404 -> REALM_NOT_FOUND`
3. `409 -> REALM_CONFLICT`
4. `429 -> REALM_RATE_LIMITED`
5. `400/422 -> CONFIG_INVALID`
6. `5xx -> REALM_UNAVAILABLE`

### 3.2 reasonCode/actionHint 解析优先级

1. 优先读取服务端 body/header 中的 `reasonCode/actionHint/traceId`。
2. 缺失时回退到 HTTP 默认映射。

### 3.3 timeout/abort 语义

1. timeout 触发映射为 `REALM_UNAVAILABLE`（可重试）。
2. 外部 `AbortSignal` 取消映射为 `OPERATION_ABORTED`。

## 4. 公共命名规范

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

## 5. 导入边界

允许：`@nimiplatform/sdk/realm`

禁止：`@nimiplatform/sdk/realm/core|models|services|generated/*`

## 6. 验收门禁

1. `sdk/test/realm/realm-facade-naming.test.ts`
2. `sdk/test/realm/realm-client.test.ts`
3. `pnpm check:sdk-public-naming`
4. `pnpm check:no-global-openapi-config`
5. `pnpm check:no-openapi-singleton-import`
6. `pnpm check:sdk-vnext-matrix`
7. `pnpm generate:realm-sdk`（变更后重生）
