---
title: Nimi SDK Client Init Contract
status: ACTIVE
updated_at: 2026-02-26
parent: INDEX.md
rules:
  - `createNimiClient` 是 SDK 的统一初始化入口。
  - 初始化失败必须返回结构化 `NimiError`，不得暴露裸字符串错误给调用方。
  - SDK scope 模块必须与 runtime appAuth 授权流程保持一致。
---

# createNimiClient 接入合同

## 1. 输入与输出（事实）

来源：`sdk/src/client.ts`。

输入：

1. `appId: string`（必填）
2. `protocolVersion?: string`
3. `realm?: { baseUrl: string; accessToken?: string }`
4. `runtime?: Omit<RuntimeClientConfig, 'appId'>`

输出：

1. `appId`
2. `realm?`：realm facade（已注入 `OpenAPI.BASE/TOKEN`）
3. `runtime?`：runtime client（appId 已补齐）
4. `scope`：`createScopeModule({ appId })` 结果

## 2. 初始化约束

1. `appId` 为空时抛 `SDK_APP_ID_REQUIRED`。
2. `realm` 与 `runtime` 同时缺失时抛 `SDK_TARGET_REQUIRED`。
3. 传 `realm` 但 `baseUrl` 为空时抛 `SDK_REALM_BASE_URL_REQUIRED`。
4. 若指定 `protocolVersion` 且不等于 SDK 当前协议版本（`1`），抛 `PROTOCOL_VERSION_MISMATCH`。

## 3. realm 注入行为

当传入 `realm` 配置时：

1. 写入 `realm.OpenAPI.BASE`
2. 写入 `realm.OpenAPI.TOKEN`

说明：这是全局可变配置（OpenAPI 单例），属于当前实现事实。

## 4. runtime + scope 绑定行为

`createNimiClient` 会包装 `runtime.appAuth.authorizeExternalPrincipal`：

1. 调用前通过 `scope.resolvePublishedCatalogVersion(...)` 解析版本。
2. 强制把请求里的 `scopeCatalogVersion` 替换为已发布版本。
3. 若 runtime 回包里的 `issuedScopeCatalogVersion` 与请求版本不一致，会 `console.warn` 提示。

## 5. 验收门禁

测试文件：`sdk/test/client.test.ts`。

覆盖点：

1. realm/runtime 初始化路径
2. appId/target/baseUrl 校验错误
3. scope 注册/发布/撤销链路
4. scope 与 appAuth 授权绑定行为
