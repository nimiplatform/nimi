---
title: Nimi SDK Scope Subpath Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - scope 模块必须绑定 appId，并强制 `app.<appId>.*` 命名空间约束。
  - scope catalog 只允许 `draft/published/revoked` 状态流转。
  - appAuth 授权必须依赖已发布且未撤销的 scopeCatalogVersion。
---

# scope 子路径合同

## 1. 模块能力（事实）

来源：`sdk/src/scope/index.ts`。

`createScopeModule({ appId })` 提供：

1. `listCatalog`
2. `registerAppScopes`
3. `publishCatalog`
4. `revokeAppScopes`
5. `resolvePublishedCatalogVersion`

## 2. 内置 catalog 基线

来源：`sdk/src/scope/generated/catalog.ts`。

1. `GENERATED_REALM_SCOPES`: 32 项
2. `GENERATED_RUNTIME_SCOPES`: 77 项

## 3. 状态与校验

### 3.1 register

1. `manifestVersion` 必填
2. `scopes` 至少 1 项
3. 每个 scope 必须满足 `app.<appId>.*`

### 3.2 publish

1. 无 draft 时拒绝
2. 同版本不同内容时拒绝 `APP_SCOPE_CONFLICT`
3. 发布成功返回 `publishedAt`

### 3.3 revoke

1. 未发布 catalog 时拒绝
2. 撤销 scope 必须存在于最新发布版本
3. 撤销后会生成新 draft 版本（`-rN`）
4. 含撤销 scope 的历史版本进入 revoked 集合

### 3.4 resolve

1. 无发布版本时拒绝 `APP_SCOPE_CATALOG_UNPUBLISHED`
2. 指定版本未发布时拒绝
3. 版本已 revoked 时拒绝 `APP_SCOPE_REVOKED`

## 4. 与 client/runtime 联动

`createNimiClient` 会在 `runtime.appAuth.authorizeExternalPrincipal` 前调用 `scope.resolvePublishedCatalogVersion`，确保授权请求不会使用未发布版本。

## 5. 验收门禁

1. `sdk/test/scope/module.test.ts`
2. `sdk/test/client.test.ts`（scope + appAuth 绑定路径）
3. `pnpm check:scope-catalog-drift`
